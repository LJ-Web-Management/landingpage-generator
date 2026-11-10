import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { CourseFactsSchema, type CourseFacts } from "./schema";
import type { CoursePage } from "./course";
import type { ImageForClaude } from "./assets";
import {
  EXTRACTION_SYSTEM,
  GENERATION_SYSTEM,
  WEB_FETCH_SYSTEM,
  extractionUserText,
  webFetchUserText,
} from "./prompts";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ClaudeModelInfo {
  id: string;
  label: string;
  /** USD per million input / output tokens (standard rates, used for the cost estimate). */
  inputPrice: number;
  outputPrice: number;
  /** Whether the model supports server-side refusal fallbacks. */
  fallbacks: boolean;
}

export const CLAUDE_MODELS: ClaudeModelInfo[] = [
  { id: "claude-opus-5-5", label: "Opus 5.5 (best)", inputPrice: 4, outputPrice: 20, fallbacks: true },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5 (faster)", inputPrice: 2, outputPrice: 10, fallbacks: true },
  { id: "claude-haiku-5-5", label: "Haiku 5.5 (cheapest)", inputPrice: 0.1, outputPrice: 0.5, fallbacks: false },
  { id: "claude-fable-5-2", label: "Fable 5.2 (most capable)", inputPrice: 8, outputPrice: 40, fallbacks: true },
];

export const DEFAULT_MODEL = "claude-opus-5-5";

export interface CallUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export class ClaudeRefusalError extends Error {
  constructor(public category: string | null, explanation: string | null | undefined) {
    super(
      `Claude declined this request${category ? ` (category: ${category})` : ""}.` +
        (explanation ? ` ${explanation}` : "") +
        " Try rephrasing your instructions or choosing a different model.",
    );
    this.name = "ClaudeRefusalError";
  }
}

function makeClient(apiKey: string): Anthropic {
  if (!apiKey.trim()) throw new Error("Add your Claude API key in Settings first.");
  // The key is entered by the user and only ever sent from their browser to api.anthropic.com.
  return new Anthropic({ apiKey: apiKey.trim(), dangerouslyAllowBrowser: true, maxRetries: 2 });
}

function modelInfo(model: string): ClaudeModelInfo | undefined {
  return CLAUDE_MODELS.find((m) => m.id === model);
}

/**
 * Server-side refusal fallback: if the model's safety classifiers decline the request,
 * the API retries it on Anthropic's recommended fallback model within the same call.
 */
function fallbackParams(model: string): { betas?: Anthropic.Beta.AnthropicBeta[]; fallbacks?: "default" } {
  return modelInfo(model)?.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {};
}

function usageOf(model: string, usage: Anthropic.Beta.BetaUsage): CallUsage {
  const info = modelInfo(model);
  const inputTokens =
    usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  const outputTokens = usage.output_tokens;
  const costUsd = info ? (inputTokens * info.inputPrice + outputTokens * info.outputPrice) / 1_000_000 : 0;
  return { model, inputTokens, outputTokens, costUsd };
}

function ensureCompleted(message: Anthropic.Beta.BetaMessage): void {
  if (message.stop_reason === "refusal") {
    throw new ClaudeRefusalError(message.stop_details?.category ?? null, message.stop_details?.explanation);
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("Claude ran out of output tokens before finishing. Try a lower effort level or shorter instructions.");
  }
}

function textOf(message: Anthropic.Beta.BetaMessage): string {
  // After a mid-stream fallback the partial text and the continuation are separate text blocks,
  // so join every text block in order.
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// ---------------------------------------------------------------------------
// 1. Course facts
// ---------------------------------------------------------------------------

export async function extractCourseFacts(opts: {
  apiKey: string;
  model: string;
  page: CoursePage;
  signal?: AbortSignal;
}): Promise<{ facts: CourseFacts; usage: CallUsage }> {
  const response = await makeClient(opts.apiKey).beta.messages.parse(
    {
      model: opts.model,
      max_tokens: 16000,
      system: EXTRACTION_SYSTEM,
      output_config: { effort: "low", format: betaZodOutputFormat(CourseFactsSchema) },
      messages: [{ role: "user", content: extractionUserText(opts.page.content, opts.page.url) }],
      ...fallbackParams(opts.model),
    },
    { signal: opts.signal },
  );
  ensureCompleted(response);
  if (!response.parsed_output) throw new Error("Claude did not return valid course details. Please try again.");
  return { facts: response.parsed_output, usage: usageOf(opts.model, response.usage) };
}

/**
 * Fallback when the browser can't download the page itself (e.g. CORS): Claude fetches
 * it server-side with the web fetch tool and transcribes the course content.
 */
export async function fetchPageWithClaude(opts: {
  apiKey: string;
  model: string;
  url: string;
  signal?: AbortSignal;
}): Promise<{ text: string; usage: CallUsage }> {
  const client = makeClient(opts.apiKey);
  const host = new URL(opts.url).hostname.replace(/^www\./, "");
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3, allowed_domains: [host], max_content_tokens: 60000 },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: webFetchUserText(opts.url) }];
  const total: CallUsage = { model: opts.model, inputTokens: 0, outputTokens: 0, costUsd: 0 };

  for (let turn = 0; turn < 4; turn++) {
    const stream = client.beta.messages.stream(
      {
        model: opts.model,
        max_tokens: 32000,
        system: WEB_FETCH_SYSTEM,
        tools,
        messages,
        output_config: { effort: "low" },
        ...fallbackParams(opts.model),
      },
      { signal: opts.signal },
    );
    const message = await stream.finalMessage();
    const u = usageOf(opts.model, message.usage);
    total.inputTokens += u.inputTokens;
    total.outputTokens += u.outputTokens;
    total.costUsd += u.costUsd;

    if (message.stop_reason === "pause_turn") {
      // The server-side tool loop paused; send the turn back unchanged so it resumes.
      messages.push({ role: "assistant", content: message.content as Anthropic.Beta.BetaContentBlockParam[] });
      continue;
    }
    ensureCompleted(message);

    let fetchError = "";
    for (const block of message.content) {
      if (block.type === "web_fetch_tool_result" && block.content.type === "web_fetch_tool_result_error") {
        fetchError = block.content.error_code;
      }
    }
    const text = textOf(message).trim();
    if (text.length < 200) {
      throw new Error(
        fetchError
          ? `Claude's web fetch could not read the page (${fetchError}).`
          : "Claude could not read the course page.",
      );
    }
    return { text, usage: total };
  }
  throw new Error("Claude's web fetch did not finish. Try pasting the page content manually.");
}

// ---------------------------------------------------------------------------
// 2. Landing page HTML (generation + revisions)
// ---------------------------------------------------------------------------

export interface LabeledImage {
  label: string;
  image: ImageForClaude;
}

export interface HtmlStreamCallbacks {
  onThinking?: (snapshot: string) => void;
  onText?: (total: string) => void;
}

export async function streamLandingPage(opts: {
  apiKey: string;
  model: string;
  effort: Effort;
  userText: string;
  images?: LabeledImage[];
  signal?: AbortSignal;
  callbacks?: HtmlStreamCallbacks;
}): Promise<{ html: string; usage: CallUsage; servedBy: string }> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const { label, image } of opts.images ?? []) {
    content.push({ type: "text", text: label });
    content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } });
  }
  content.push({ type: "text", text: opts.userText });

  const stream = makeClient(opts.apiKey).beta.messages.stream(
    {
      model: opts.model,
      max_tokens: 64000,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: opts.effort },
      system: GENERATION_SYSTEM,
      messages: [{ role: "user", content }],
      ...fallbackParams(opts.model),
    },
    { signal: opts.signal },
  );

  let total = "";
  stream.on("text", (delta) => {
    total += delta;
    opts.callbacks?.onText?.(total);
  });
  stream.on("thinking", (_delta, snapshot) => opts.callbacks?.onThinking?.(snapshot));

  const message = await stream.finalMessage();
  ensureCompleted(message);
  return { html: extractHtmlDocument(textOf(message)), usage: usageOf(opts.model, message.usage), servedBy: message.model };
}

export function extractHtmlDocument(text: string): string {
  let t = text.trim();
  if (!/^<!doctype html|^<html[\s>]/i.test(t)) {
    const fence = /```(?:html)?\s*([\s\S]*?)```/i.exec(t);
    if (fence?.[1]) t = fence[1].trim();
  }
  const start = t.search(/<!doctype html|<html[\s>]/i);
  if (start === -1) throw new Error("Claude's response did not contain an HTML document. Please try again.");
  const end = t.toLowerCase().lastIndexOf("</html>");
  return end === -1 ? t.slice(start) : t.slice(start, end + "</html>".length);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export function describeClaudeError(err: unknown): string | null {
  if (err instanceof Anthropic.APIUserAbortError) return "Cancelled.";
  if (err instanceof Anthropic.AuthenticationError) return "Claude rejected the API key (401). Check it in Settings.";
  if (err instanceof Anthropic.PermissionDeniedError) return `Claude API permission error: ${err.message}`;
  if (err instanceof Anthropic.NotFoundError) return `Claude API: model or endpoint not found. ${err.message}`;
  if (err instanceof Anthropic.RateLimitError) return "Claude API rate limit reached. Wait a minute and try again.";
  if (err instanceof Anthropic.BadRequestError) return `Claude API rejected the request: ${err.message}`;
  if (err instanceof Anthropic.InternalServerError) return `Claude API is having trouble (${err.status}). Try again shortly.`;
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the Claude API. Check your connection.";
  if (err instanceof Anthropic.APIError) return `Claude API error${err.status ? ` ${err.status}` : ""}: ${err.message}`;
  return null;
}
