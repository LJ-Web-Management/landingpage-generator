/**
 * ChatGPT (OpenAI) branding: a brand kit from a GPT model plus images from a GPT Image model.
 * The OpenAI SDK is loaded lazily so it only downloads when this mode is used.
 */
import type OpenAI from "openai";
import type { CourseFacts } from "./schema";
import { base64ToBlob, makeAsset, type Asset } from "./assets";

export interface BrandKit {
  campaign_name: string;
  tagline: string;
  voice: string;
  palette: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    muted_text: string;
  };
  fonts: { heading: string; body: string };
  design_notes: string;
  image_prompts: { hero: string; badge: string; feature_1: string; feature_2: string };
}

export type ImageSlot = "hero" | "badge" | "feature_1" | "feature_2";

export const IMAGE_SLOTS: Record<ImageSlot, { label: string; size: string; transparent: boolean; role: Asset["role"]; description: string }> = {
  hero: { label: "Hero image", size: "1536x1024", transparent: false, role: "hero", description: "Hero image for the top of the page" },
  badge: { label: "Course badge / emblem", size: "1024x1024", transparent: true, role: "badge", description: "Course emblem/badge with a transparent background" },
  feature_1: { label: "Feature image 1", size: "1536x1024", transparent: false, role: "feature", description: "Supporting image for a content section" },
  feature_2: { label: "Feature image 2", size: "1536x1024", transparent: false, role: "feature", description: "Supporting image for a content section" },
};

const hex = { type: "string", description: "Hex color like #1A2B3C" } as const;

const BRAND_KIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["campaign_name", "tagline", "voice", "palette", "fonts", "design_notes", "image_prompts"],
  properties: {
    campaign_name: { type: "string", description: "Short internal name for this landing-page campaign" },
    tagline: { type: "string", description: "Punchy tagline (max 10 words), no invented facts" },
    voice: { type: "string", description: "Tone of voice guidance in one or two sentences" },
    palette: {
      type: "object",
      additionalProperties: false,
      required: ["primary", "secondary", "accent", "background", "surface", "text", "muted_text"],
      properties: { primary: hex, secondary: hex, accent: hex, background: hex, surface: hex, text: hex, muted_text: hex },
    },
    fonts: {
      type: "object",
      additionalProperties: false,
      required: ["heading", "body"],
      properties: {
        heading: { type: "string", description: "Google Fonts family name for headings" },
        body: { type: "string", description: "Google Fonts family name for body text" },
      },
    },
    design_notes: { type: "string", description: "Layout and visual style guidance for the web designer" },
    image_prompts: {
      type: "object",
      additionalProperties: false,
      required: ["hero", "badge", "feature_1", "feature_2"],
      properties: {
        hero: { type: "string", description: "Prompt for a wide hero image" },
        badge: { type: "string", description: "Prompt for a square course emblem on a transparent background" },
        feature_1: { type: "string", description: "Prompt for a supporting image" },
        feature_2: { type: "string", description: "Prompt for a different supporting image" },
      },
    },
  },
} as const;

const BRAND_KIT_INSTRUCTIONS = `You are a senior brand designer creating the visual identity for a single landing page that sells an online workplace-safety training course.

- The palette must have WCAG AA contrast between text and background, and the accent must work for call-to-action buttons.
- Choose fonts that exist on Google Fonts.
- Image prompts are for a GPT Image model. Describe photorealistic or clean editorial scenes that fit the course topic, with diverse workers using correct, compliant safety practices and properly worn PPE. Never include text, letters, numbers, logos, watermarks or trademarks in any image. Keep a consistent lighting and color treatment across all images that matches the palette.
- The badge prompt should describe a simple, modern emblem or icon (no words) on a transparent background.
- Do not invent facts about the course; only use what is provided.`;

let openaiModule: typeof import("openai") | null = null;

async function loadOpenAI(): Promise<typeof import("openai")> {
  openaiModule ??= await import("openai");
  return openaiModule;
}

async function makeClient(apiKey: string): Promise<OpenAI> {
  if (!apiKey.trim()) throw new Error("Add your OpenAI API key in Settings to use ChatGPT branding.");
  const { default: OpenAIClient } = await loadOpenAI();
  // The key is entered by the user and only ever sent from their browser to api.openai.com.
  return new OpenAIClient({ apiKey: apiKey.trim(), dangerouslyAllowBrowser: true, maxRetries: 2 });
}

export async function generateBrandKit(opts: {
  apiKey: string;
  model: string;
  facts: CourseFacts;
  brandName: string;
  styleDirection: string;
  notes: string;
  signal?: AbortSignal;
}): Promise<BrandKit> {
  const client = await makeClient(opts.apiKey);
  const brief = {
    brand_name: opts.brandName,
    course: {
      title: opts.facts.title,
      tagline: opts.facts.tagline,
      summary: opts.facts.summary,
      audience: opts.facts.audience,
      regulations: opts.facts.regulations,
      benefits: opts.facts.benefits.slice(0, 6),
    },
    style_direction: opts.styleDirection,
    client_notes: opts.notes,
  };
  const response = await client.responses.create(
    {
      model: opts.model,
      instructions: BRAND_KIT_INSTRUCTIONS,
      input: `Create the brand kit for this landing page brief:\n${JSON.stringify(brief, null, 2)}`,
      text: { format: { type: "json_schema", name: "brand_kit", strict: true, schema: BRAND_KIT_SCHEMA } },
    },
    { signal: opts.signal },
  );
  try {
    return JSON.parse(response.output_text) as BrandKit;
  } catch {
    throw new Error("ChatGPT returned an unreadable brand kit. Please try again.");
  }
}

export async function generateBrandImage(opts: {
  apiKey: string;
  model: string;
  quality: "low" | "medium" | "high" | "auto";
  slot: ImageSlot;
  prompt: string;
  signal?: AbortSignal;
}): Promise<Asset> {
  const client = await makeClient(opts.apiKey);
  const slot = IMAGE_SLOTS[opts.slot];
  const params: OpenAI.Images.ImageGenerateParamsNonStreaming = {
    model: opts.model,
    prompt: `${opts.prompt}\n\nNo text, letters, numbers, logos or watermarks anywhere in the image.`,
    size: slot.size,
    quality: opts.quality,
    n: 1,
    output_format: slot.transparent ? "png" : "webp",
    ...(slot.transparent ? { background: "transparent" as const } : { output_compression: 85 }),
  };

  let result: OpenAI.Images.ImagesResponse;
  try {
    result = await client.images.generate(params, { signal: opts.signal });
  } catch (err) {
    // Some image models don't support transparent backgrounds; retry once with an opaque one.
    const { default: OpenAIClient } = await loadOpenAI();
    if (slot.transparent && err instanceof OpenAIClient.BadRequestError) {
      const { background: _ignored, ...rest } = params;
      result = await client.images.generate({ ...rest, prompt: `${params.prompt}\nUse a plain white background.` }, { signal: opts.signal });
    } else {
      throw err;
    }
  }

  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${slot.label}: the image model returned no image data (use a GPT Image model such as gpt-image-2).`);
  const mime = slot.transparent ? "image/png" : "image/webp";
  const blob = base64ToBlob(b64, mime);
  return makeAsset(blob, opts.slot.replace("_", "-"), slot.role, `${slot.description}. Depicts: ${opts.prompt}`);
}

/** Friendly message for OpenAI SDK errors (null if the error didn't come from the OpenAI SDK). */
export function describeOpenAIError(err: unknown): string | null {
  if (!openaiModule) return null;
  const OpenAIClient = openaiModule.default;
  if (err instanceof OpenAIClient.APIUserAbortError) return "Cancelled.";
  if (err instanceof OpenAIClient.AuthenticationError) return "OpenAI rejected the API key (401). Check it in Settings.";
  if (err instanceof OpenAIClient.PermissionDeniedError)
    return `OpenAI permission error: ${err.message} (GPT Image models may require organization verification).`;
  if (err instanceof OpenAIClient.NotFoundError) return `OpenAI: model not found. ${err.message}`;
  if (err instanceof OpenAIClient.RateLimitError) return "OpenAI rate limit or quota reached. Check your OpenAI billing and try again.";
  if (err instanceof OpenAIClient.BadRequestError) return `OpenAI rejected the request: ${err.message}`;
  if (err instanceof OpenAIClient.APIConnectionError) return "Couldn't reach the OpenAI API. Check your connection.";
  if (err instanceof OpenAIClient.APIError) return `OpenAI API error${err.status ? ` ${err.status}` : ""}: ${err.message}`;
  return null;
}
