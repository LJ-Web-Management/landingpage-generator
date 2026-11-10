import "./styles.css";
import {
  CLAUDE_MODELS,
  describeClaudeError,
  extractCourseFacts,
  fetchPageWithClaude,
  streamLandingPage,
  type CallUsage,
  type Effort,
  type LabeledImage,
} from "./claude";
import {
  condenseCourseHtml,
  courseSlug,
  fetchCourseHtml,
  isHazwoperOshaUrl,
  normalizeCourseUrl,
  type CoursePage,
} from "./course";
import { parseCourseFactsJson, type CourseFacts } from "./schema";
import {
  STYLE_PRESETS,
  generationUserText,
  revisionUserText,
  type BrandingContext,
  type BrandingMode,
} from "./prompts";
import {
  IMAGE_SLOTS,
  describeOpenAIError,
  generateBrandImage,
  generateBrandKit,
  type BrandKit,
  type ImageSlot,
} from "./branding";
import { imageForClaude, makeAsset, type Asset } from "./assets";
import { buildPreviewHtml, exportZip } from "./export";
import { forgetKeys, loadSettings, saveSettings, type Settings } from "./settings";

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

const ui = {
  settingsDetails: $<HTMLDetailsElement>("settings-details"),
  keyStatus: $("key-status"),
  claudeKey: $<HTMLInputElement>("claude-key"),
  model: $<HTMLSelectElement>("model"),
  effort: $<HTMLSelectElement>("effort"),
  openaiKey: $<HTMLInputElement>("openai-key"),
  openaiTextModel: $<HTMLInputElement>("openai-text-model"),
  openaiImageModel: $<HTMLInputElement>("openai-image-model"),
  imageQuality: $<HTMLSelectElement>("image-quality"),
  rememberKeys: $<HTMLInputElement>("remember-keys"),
  forgetKeys: $<HTMLButtonElement>("forget-keys"),

  courseUrl: $<HTMLInputElement>("course-url"),
  analyzeBtn: $<HTMLButtonElement>("analyze-btn"),
  urlHint: $("url-hint"),
  factsCard: $("facts-card"),
  factsSummary: $("facts-summary"),
  factsJson: $<HTMLTextAreaElement>("facts-json"),
  factsSave: $<HTMLButtonElement>("facts-save"),
  manualDetails: $<HTMLDetailsElement>("manual-details"),
  manualText: $<HTMLTextAreaElement>("manual-text"),
  manualAnalyze: $<HTMLButtonElement>("manual-analyze"),

  modePanels: {
    chatgpt: $("mode-chatgpt"),
    upload: $("mode-upload"),
  },
  chatgptReset: $<HTMLButtonElement>("chatgpt-reset"),
  uploadLogo: $<HTMLInputElement>("upload-logo"),
  uploadHero: $<HTMLInputElement>("upload-hero"),
  uploadOthers: $<HTMLInputElement>("upload-others"),
  colorPrimary: $<HTMLInputElement>("color-primary"),
  colorPrimaryOn: $<HTMLInputElement>("color-primary-on"),
  colorAccent: $<HTMLInputElement>("color-accent"),
  colorAccentOn: $<HTMLInputElement>("color-accent-on"),
  uploadFonts: $<HTMLInputElement>("upload-fonts"),
  gallery: $("asset-gallery"),
  stylePreset: $<HTMLSelectElement>("style-preset"),
  brandName: $<HTMLInputElement>("brand-name"),
  brandNotes: $<HTMLTextAreaElement>("brand-notes"),
  useSiteImages: $<HTMLInputElement>("use-site-images"),

  ctaUrl: $<HTMLInputElement>("cta-url"),
  ctaText: $<HTMLInputElement>("cta-text"),
  extraInstructions: $<HTMLTextAreaElement>("extra-instructions"),

  generateBtn: $<HTMLButtonElement>("generate-btn"),
  cancelBtn: $<HTMLButtonElement>("cancel-btn"),
  progress: $<HTMLOListElement>("progress"),
  thinkingDetails: $<HTMLDetailsElement>("thinking-details"),
  thinkingBox: $("thinking-box"),
  usageLine: $("usage-line"),

  reviseCard: $("revise-card"),
  reviseText: $<HTMLTextAreaElement>("revise-text"),
  reviseBtn: $<HTMLButtonElement>("revise-btn"),
  undoBtn: $<HTMLButtonElement>("undo-btn"),

  htmlSize: $("html-size"),
  copyBtn: $<HTMLButtonElement>("copy-btn"),
  fullscreenBtn: $<HTMLButtonElement>("fullscreen-btn"),
  downloadBtn: $<HTMLButtonElement>("download-btn"),
  emptyState: $("empty-state"),
  frameWrap: $("frame-wrap"),
  preview: $<HTMLIFrameElement>("preview"),
  codeView: $<HTMLPreElement>("code-view"),
  toast: $("toast"),
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  settings: loadSettings() as Settings,
  page: null as CoursePage | null,
  facts: null as CourseFacts | null,
  factsUrl: "",
  chatgpt: { kit: null as BrandKit | null, images: new Map<ImageSlot, Asset>() },
  upload: { logo: null as Asset | null, hero: null as Asset | null, others: [] as Asset[] },
  html: "",
  history: [] as { html: string; branding: BrandingContext | null }[],
  /** Branding used for the current HTML (needed for revisions and the ZIP). */
  lastBranding: null as BrandingContext | null,
  busy: false,
  abort: null as AbortController | null,
  usage: { input: 0, output: 0, cost: 0 },
  view: "preview" as "preview" | "code",
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function initSettingsForm(): void {
  for (const m of CLAUDE_MODELS) ui.model.append(h("option", { value: m.id }, m.label));
  for (const [id, p] of Object.entries(STYLE_PRESETS)) ui.stylePreset.append(h("option", { value: id }, p.label));

  const s = state.settings;
  ui.claudeKey.value = s.claudeKey;
  ui.openaiKey.value = s.openaiKey;
  ui.model.value = CLAUDE_MODELS.some((m) => m.id === s.model) ? s.model : CLAUDE_MODELS[0]!.id;
  ui.effort.value = s.effort;
  ui.openaiTextModel.value = s.openaiTextModel;
  ui.openaiImageModel.value = s.openaiImageModel;
  ui.imageQuality.value = s.imageQuality;
  ui.rememberKeys.checked = s.rememberKeys;
  ui.settingsDetails.open = !s.claudeKey;
  updateKeyStatus();

  const onChange = () => {
    readSettings();
    saveSettings(state.settings);
    updateKeyStatus();
  };
  for (const el of [ui.claudeKey, ui.openaiKey, ui.openaiTextModel, ui.openaiImageModel]) el.addEventListener("input", onChange);
  for (const el of [ui.model, ui.effort, ui.imageQuality, ui.rememberKeys]) el.addEventListener("change", onChange);

  ui.forgetKeys.addEventListener("click", () => {
    forgetKeys();
    ui.claudeKey.value = "";
    ui.openaiKey.value = "";
    ui.rememberKeys.checked = false;
    readSettings();
    saveSettings(state.settings);
    updateKeyStatus();
    toast("Saved API keys removed from this browser.");
  });

  document.querySelectorAll<HTMLButtonElement>("[data-reveal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = $<HTMLInputElement>(btn.dataset.reveal!);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? "Hide" : "Show";
    });
  });
}

function readSettings(): void {
  state.settings = {
    claudeKey: ui.claudeKey.value.trim(),
    openaiKey: ui.openaiKey.value.trim(),
    rememberKeys: ui.rememberKeys.checked,
    model: ui.model.value,
    effort: ui.effort.value as Effort,
    openaiTextModel: ui.openaiTextModel.value.trim() || "gpt-5.5",
    openaiImageModel: ui.openaiImageModel.value.trim() || "gpt-image-2",
    imageQuality: ui.imageQuality.value as Settings["imageQuality"],
  };
}

function updateKeyStatus(): void {
  const ok = !!ui.claudeKey.value.trim();
  ui.keyStatus.textContent = ok ? "Claude key set" : "No Claude key";
  ui.keyStatus.classList.toggle("ok", ok);
}

function requireClaudeKey(): void {
  readSettings();
  if (!state.settings.claudeKey) {
    ui.settingsDetails.open = true;
    ui.claudeKey.focus();
    throw new Error("Add your Claude API key in step 1 first.");
  }
}

// ---------------------------------------------------------------------------
// Progress log
// ---------------------------------------------------------------------------

interface Step {
  update(detail: string): void;
  done(detail?: string): void;
  warn(detail: string): void;
  fail(detail: string): void;
}

let activeStep: Step | null = null;

function step(label: string): Step {
  const detail = h("span", { class: "detail" });
  const li = h("li", { class: "active" }, h("span", { class: "icon", "aria-hidden": "true" }), h("span", {}, label, detail));
  ui.progress.append(li);
  const set = (cls: string, text?: string) => {
    li.className = cls;
    if (text !== undefined) detail.textContent = text;
  };
  const s: Step = {
    update: (t) => set("active", t),
    done: (t) => {
      set("done", t);
      if (activeStep === s) activeStep = null;
    },
    warn: (t) => {
      set("warn", t);
      if (activeStep === s) activeStep = null;
    },
    fail: (t) => {
      set("error", t);
      if (activeStep === s) activeStep = null;
    },
  };
  activeStep = s;
  return s;
}

function addUsage(u: CallUsage): void {
  state.usage.input += u.inputTokens;
  state.usage.output += u.outputTokens;
  state.usage.cost += u.costUsd;
  ui.usageLine.hidden = false;
  ui.usageLine.textContent =
    `Claude usage this session: ${state.usage.input.toLocaleString()} input · ` +
    `${state.usage.output.toLocaleString()} output tokens · ≈ $${state.usage.cost.toFixed(2)} (estimate)`;
}

function describeError(err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") return "Cancelled.";
  return describeClaudeError(err) ?? describeOpenAIError(err) ?? (err instanceof Error ? err.message : String(err));
}

function toast(message: string, isError = false): void {
  ui.toast.textContent = message;
  ui.toast.classList.toggle("error", isError);
  ui.toast.hidden = false;
  clearTimeout((toast as unknown as { t?: number }).t);
  (toast as unknown as { t?: number }).t = window.setTimeout(() => (ui.toast.hidden = true), isError ? 7000 : 3500);
}

// ---------------------------------------------------------------------------
// Busy state
// ---------------------------------------------------------------------------

function beginTask(): AbortSignal {
  state.busy = true;
  state.abort = new AbortController();
  ui.progress.replaceChildren();
  ui.thinkingDetails.hidden = true;
  ui.thinkingBox.textContent = "";
  ui.cancelBtn.hidden = false;
  syncButtons();
  return state.abort.signal;
}

function endTask(): void {
  state.busy = false;
  state.abort = null;
  ui.cancelBtn.hidden = true;
  syncButtons();
}

async function runTask(task: (signal: AbortSignal) => Promise<void>): Promise<void> {
  if (state.busy) return;
  const signal = beginTask();
  try {
    await task(signal);
  } catch (err) {
    const message = signal.aborted ? "Cancelled." : describeError(err);
    if (activeStep) activeStep.fail(message);
    else step("Error").fail(message);
    if (!signal.aborted) toast(message, true);
    console.error(err);
  } finally {
    endTask();
  }
}

function syncButtons(): void {
  const has = !!state.html;
  ui.generateBtn.disabled = state.busy;
  ui.analyzeBtn.disabled = state.busy;
  ui.manualAnalyze.disabled = state.busy;
  ui.reviseBtn.disabled = state.busy || !has;
  ui.undoBtn.disabled = state.busy || state.history.length === 0;
  ui.downloadBtn.disabled = state.busy || !has;
  ui.copyBtn.disabled = !has;
  ui.generateBtn.textContent = state.busy ? "Working…" : has ? "Regenerate landing page" : "Generate landing page";
}

// ---------------------------------------------------------------------------
// Course facts
// ---------------------------------------------------------------------------

function currentCourseUrl(): string {
  return normalizeCourseUrl(ui.courseUrl.value).href;
}

function updateUrlHint(): void {
  let message = "";
  let warn = false;
  try {
    if (ui.courseUrl.value.trim()) {
      const url = normalizeCourseUrl(ui.courseUrl.value);
      if (!isHazwoperOshaUrl(url)) {
        message = "Tuned for hazwoper-osha.com course pages, but other course pages usually work too.";
      }
      if (state.facts && state.factsUrl && url.href !== state.factsUrl) {
        message = "The details below are for a different URL. They'll be refreshed when you analyze or generate.";
        warn = true;
      }
    }
  } catch (err) {
    message = (err as Error).message;
    warn = true;
  }
  ui.urlHint.textContent = message;
  ui.urlHint.classList.toggle("warn", warn);
  ui.urlHint.hidden = !message;
}

async function loadFacts(signal: AbortSignal, force: boolean): Promise<CourseFacts> {
  const url = currentCourseUrl();
  if (!force && state.facts && state.factsUrl === url) {
    step("Course details").done(`Using the details already loaded for “${state.facts.title}”.`);
    return state.facts;
  }

  const fetchStep = step("Fetching the course page");
  let page: CoursePage;
  try {
    const html = await fetchCourseHtml(url, signal);
    page = condenseCourseHtml(html, url);
    fetchStep.done(page.title || url);
  } catch (err) {
    if (signal.aborted) throw err;
    fetchStep.update("The browser couldn't download it directly, so Claude is fetching it…");
    try {
      const { text, usage } = await fetchPageWithClaude({
        apiKey: state.settings.claudeKey,
        model: state.settings.model,
        url,
        signal,
      });
      addUsage(usage);
      page = { url, source: "claude-web-fetch", title: "", content: text, images: [] };
      fetchStep.done("Fetched with Claude's web fetch tool.");
    } catch (fallbackErr) {
      if (signal.aborted) throw fallbackErr;
      ui.manualDetails.open = true;
      throw new Error(
        `Couldn't load the course page (${describeError(fallbackErr)}). Paste the page content under “Can't fetch the page?” instead.`,
      );
    }
  }
  return analyzePage(page, signal);
}

async function analyzePage(page: CoursePage, signal: AbortSignal): Promise<CourseFacts> {
  const s = step("Claude is reading the course details");
  const { facts, usage } = await extractCourseFacts({
    apiKey: state.settings.claudeKey,
    model: state.settings.model,
    page,
    signal,
  });
  addUsage(usage);
  setFacts(facts, page.url, page);
  s.done(facts.title);
  return facts;
}

function setFacts(facts: CourseFacts, url: string, page: CoursePage | null): void {
  state.facts = facts;
  state.factsUrl = url;
  if (page) state.page = page;
  renderFacts();
  updateUrlHint();
}

function renderFacts(): void {
  const f = state.facts;
  ui.factsCard.hidden = !f;
  if (!f) return;
  const chips = [
    f.price && `Price ${f.price}`,
    f.duration && `Duration ${f.duration}`,
    f.provider.rating && `Rating ${f.provider.rating}${f.provider.review_count ? ` (${f.provider.review_count} reviews)` : ""}`,
    f.languages.length && f.languages.join(" / "),
    f.bulk_pricing.length && `${f.bulk_pricing.length} bulk price tiers`,
    f.learning_objectives.length && `${f.learning_objectives.length} objectives`,
    f.syllabus.length && `${f.syllabus.length} modules`,
    f.faqs.length && `${f.faqs.length} FAQs`,
    f.regulations.length && f.regulations.slice(0, 3).join(", "),
  ].filter((c): c is string => typeof c === "string" && c.length > 0);
  ui.factsSummary.replaceChildren(
    h("h3", {}, f.title || "Untitled course"),
    h("p", {}, f.summary),
    h("div", { class: "chips" }, ...chips.map((c) => h("span", { class: "chip" }, c))),
  );
  ui.factsJson.value = JSON.stringify(f, null, 2);
  ui.brandName.placeholder = f.provider.name || "Brand name";
  ui.ctaUrl.placeholder = f.enroll_url || state.factsUrl || "Defaults to the course page";
}

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

function currentMode(): BrandingMode {
  return (document.querySelector<HTMLInputElement>('input[name="brand-mode"]:checked')?.value ?? "claude") as BrandingMode;
}

function selectedSlots(): ImageSlot[] {
  return [...document.querySelectorAll<HTMLInputElement>('input[name="img-slot"]:checked')].map((i) => i.value as ImageSlot);
}

function onModeChange(): void {
  const mode = currentMode();
  ui.modePanels.chatgpt.hidden = mode !== "chatgpt";
  ui.modePanels.upload.hidden = mode !== "upload";
  if (mode === "chatgpt" && !ui.openaiKey.value.trim()) {
    ui.settingsDetails.open = true;
    toast("ChatGPT branding needs an OpenAI API key (step 1).");
  }
  renderGallery();
}

let galleryUrls: string[] = [];

function renderGallery(): void {
  galleryUrls.forEach((u) => URL.revokeObjectURL(u));
  galleryUrls = [];
  const mode = currentMode();
  const assets = mode === "chatgpt" ? [...state.chatgpt.images.values()] : mode === "upload" ? uploadAssets() : [];
  const nodes: Node[] = assets.map((a) => {
    const url = URL.createObjectURL(a.blob);
    galleryUrls.push(url);
    return h("figure", {}, h("img", { src: url, alt: a.description }), h("figcaption", { title: a.path }, a.path.replace("assets/", "")));
  });
  const kit = mode === "chatgpt" ? state.chatgpt.kit : null;
  if (kit) {
    const swatches = Object.entries(kit.palette).map(([name, color]) =>
      h("span", { class: "swatch", title: `${name}: ${color}`, style: `background:${/^#[0-9a-f]{3,8}$/i.test(color) ? color : "transparent"}` }),
    );
    nodes.unshift(h("div", { class: "swatches" }, ...swatches, `${kit.fonts.heading} / ${kit.fonts.body}`));
  }
  ui.gallery.replaceChildren(...nodes);
  ui.gallery.hidden = nodes.length === 0;
}

function uploadAssets(): Asset[] {
  return [state.upload.logo, state.upload.hero, ...state.upload.others].filter((a): a is Asset => !!a);
}

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function checkImageFile(file: File): boolean {
  if (!file.type.startsWith("image/")) {
    toast(`${file.name} is not an image.`, true);
    return false;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    toast(`${file.name} is larger than 15 MB.`, true);
    return false;
  }
  return true;
}

function initUploads(): void {
  ui.uploadLogo.addEventListener("change", async () => {
    const file = ui.uploadLogo.files?.[0];
    state.upload.logo = file && checkImageFile(file) ? await makeAsset(file, "logo", "logo", `Client logo (${file.name})`) : null;
    renderGallery();
  });
  ui.uploadHero.addEventListener("change", async () => {
    const file = ui.uploadHero.files?.[0];
    state.upload.hero = file && checkImageFile(file) ? await makeAsset(file, "hero", "hero", `Client hero image (${file.name})`) : null;
    renderGallery();
  });
  ui.uploadOthers.addEventListener("change", async () => {
    const files = [...(ui.uploadOthers.files ?? [])].filter(checkImageFile).slice(0, 8);
    state.upload.others = await Promise.all(
      files.map((file, i) => makeAsset(file, `image-${i + 1}`, "other", `Client image (${file.name})`)),
    );
    renderGallery();
  });
}

function siteImages(facts: CourseFacts): BrandingContext["remoteImages"] {
  const out: BrandingContext["remoteImages"] = [];
  const ok = (u: string) => /^https?:\/\//i.test(u);
  if (ok(facts.course_image_url)) out.push({ url: facts.course_image_url, description: "Official course image (hosted on the provider's site)" });
  if (ok(facts.provider.logo_url)) out.push({ url: facts.provider.logo_url, description: "Provider logo (hosted on the provider's site)" });
  return out;
}

async function prepareBranding(facts: CourseFacts, signal: AbortSignal): Promise<BrandingContext> {
  const mode = currentMode();
  const preset = STYLE_PRESETS[ui.stylePreset.value] ?? STYLE_PRESETS.auto!;
  const brandName = ui.brandName.value.trim() || facts.provider.name || "the course provider";
  const base: BrandingContext = {
    mode,
    brandName,
    styleDirection: preset.prompt,
    notes: ui.brandNotes.value,
    assets: [],
    remoteImages: ui.useSiteImages.checked ? siteImages(facts) : [],
  };

  if (mode === "claude") {
    step("Branding").done("Claude will design the look with typography, color and CSS.");
    return base;
  }

  if (mode === "upload") {
    const assets = uploadAssets();
    const colors = {
      primary: ui.colorPrimaryOn.checked ? ui.colorPrimary.value : undefined,
      accent: ui.colorAccentOn.checked ? ui.colorAccent.value : undefined,
    };
    const s = step("Branding");
    if (assets.length) s.done(`Using ${assets.length} uploaded image${assets.length === 1 ? "" : "s"}.`);
    else s.warn("No images uploaded. Claude will style the page from your colors and notes.");
    return { ...base, assets, colors, fonts: ui.uploadFonts.value };
  }

  // ChatGPT
  if (!state.settings.openaiKey) {
    ui.settingsDetails.open = true;
    throw new Error("ChatGPT branding needs an OpenAI API key (step 1).");
  }
  if (!state.chatgpt.kit) {
    const s = step(`ChatGPT (${state.settings.openaiTextModel}) is creating the brand kit`);
    state.chatgpt.kit = await generateBrandKit({
      apiKey: state.settings.openaiKey,
      model: state.settings.openaiTextModel,
      facts,
      brandName,
      styleDirection: preset.prompt,
      notes: ui.brandNotes.value,
      signal,
    });
    s.done(`${state.chatgpt.kit.campaign_name}: ${state.chatgpt.kit.fonts.heading} / ${state.chatgpt.kit.fonts.body}`);
    renderGallery();
  } else {
    step("Brand kit").done(`Reusing “${state.chatgpt.kit.campaign_name}”.`);
  }
  const kit = state.chatgpt.kit;

  const wanted = selectedSlots();
  const missing = wanted.filter((slot) => !state.chatgpt.images.has(slot));
  if (missing.length) {
    const s = step(`Generating ${missing.length} image${missing.length === 1 ? "" : "s"} with ${state.settings.openaiImageModel}`);
    s.update("This usually takes 30–90 seconds.");
    const results = await Promise.allSettled(
      missing.map((slot) =>
        generateBrandImage({
          apiKey: state.settings.openaiKey,
          model: state.settings.openaiImageModel,
          quality: state.settings.imageQuality,
          slot,
          prompt: kit.image_prompts[slot],
          signal,
        }).then((asset) => {
          state.chatgpt.images.set(slot, asset);
          renderGallery();
          return asset;
        }),
      ),
    );
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failures.length === 0) s.done(`Created ${missing.map((m) => IMAGE_SLOTS[m].label.toLowerCase()).join(", ")}.`);
    else if (failures.length < missing.length) s.warn(`${failures.length} image(s) failed: ${describeError(failures[0]!.reason)}`);
    else s.warn(`Image generation failed, continuing without images: ${describeError(failures[0]!.reason)}`);
  }
  const assets = wanted.map((slot) => state.chatgpt.images.get(slot)).filter((a): a is Asset => !!a);
  return { ...base, brandKit: kit, assets };
}

async function imagesForClaude(assets: Asset[]): Promise<LabeledImage[]> {
  const out: LabeledImage[] = [];
  for (const asset of assets.slice(0, 8)) {
    const image = await imageForClaude(asset.blob);
    if (image) out.push({ label: `Attached image for ${asset.path} (${asset.role}):`, image });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generation & revisions
// ---------------------------------------------------------------------------

function ctaUrl(facts: CourseFacts): string {
  const custom = ui.ctaUrl.value.trim();
  if (custom) return custom;
  return /^https?:\/\//i.test(facts.enroll_url) ? facts.enroll_url : state.factsUrl;
}

function streamingCallbacks() {
  let pendingText = "";
  let pendingThinking = "";
  let frame = 0;
  const flush = () => {
    frame = 0;
    if (pendingText) {
      ui.codeView.textContent = pendingText;
      ui.codeView.scrollTop = ui.codeView.scrollHeight;
      ui.htmlSize.textContent = `${(pendingText.length / 1024).toFixed(1)} KB written…`;
    }
    if (pendingThinking) {
      ui.thinkingDetails.hidden = false;
      ui.thinkingBox.textContent = pendingThinking;
      ui.thinkingBox.scrollTop = ui.thinkingBox.scrollHeight;
    }
  };
  let stopped = false;
  const schedule = () => {
    if (!frame && !stopped) frame = requestAnimationFrame(flush);
  };
  return {
    /** Cancel any pending repaint so it can't overwrite the final output. */
    stop: () => {
      stopped = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    },
    onText: (total: string) => {
      pendingText = total;
      schedule();
    },
    onThinking: (snapshot: string) => {
      pendingThinking = snapshot;
      schedule();
    },
  };
}

async function generate(signal: AbortSignal): Promise<void> {
  requireClaudeKey();
  const facts = await loadFacts(signal, false);
  const branding = await prepareBranding(facts, signal);

  const s = step(`Claude (${state.settings.model}) is designing the landing page`);
  s.update("Planning the layout and copy… this can take a few minutes.");
  const images = await imagesForClaude(branding.assets);
  showStage("code");
  ui.codeView.textContent = "";
  const callbacks = streamingCallbacks();
  const result = await streamLandingPage({
    apiKey: state.settings.claudeKey,
    model: state.settings.model,
    effort: state.settings.effort,
    userText: generationUserText({
      facts,
      branding,
      ctaUrl: ctaUrl(facts),
      ctaText: ui.ctaText.value,
      extraInstructions: ui.extraInstructions.value,
    }),
    images,
    signal,
    callbacks: {
      onThinking: callbacks.onThinking,
      onText: (total) => {
        s.update("Writing HTML…");
        callbacks.onText(total);
      },
    },
  }).finally(callbacks.stop);
  addUsage(result.usage);
  await setHtml(result.html, branding, true);
  s.done(doneDetail(result.html, result.servedBy));
}

async function revise(signal: AbortSignal): Promise<void> {
  requireClaudeKey();
  const request = ui.reviseText.value.trim();
  if (!request) throw new Error("Describe the changes you want first.");
  if (!state.html || !state.facts || !state.lastBranding) throw new Error("Generate a page first.");

  const s = step("Claude is revising the page");
  showStage("code");
  const callbacks = streamingCallbacks();
  const result = await streamLandingPage({
    apiKey: state.settings.claudeKey,
    model: state.settings.model,
    effort: state.settings.effort,
    userText: revisionUserText({
      facts: state.facts,
      branding: state.lastBranding,
      ctaUrl: ctaUrl(state.facts),
      ctaText: ui.ctaText.value,
      currentHtml: state.html,
      request,
    }),
    signal,
    callbacks: {
      onThinking: callbacks.onThinking,
      onText: (total) => {
        s.update("Rewriting HTML…");
        callbacks.onText(total);
      },
    },
  }).finally(callbacks.stop);
  addUsage(result.usage);
  await setHtml(result.html, state.lastBranding, true);
  ui.reviseText.value = "";
  s.done(doneDetail(result.html, result.servedBy));
}

function doneDetail(html: string, servedBy: string): string {
  const fallback = servedBy && servedBy !== state.settings.model ? ` Served by ${servedBy} (automatic fallback).` : "";
  return `${(html.length / 1024).toFixed(1)} KB of HTML.${fallback}`;
}

// ---------------------------------------------------------------------------
// Preview / output
// ---------------------------------------------------------------------------

async function setHtml(html: string, branding: BrandingContext | null, pushHistory: boolean): Promise<void> {
  if (pushHistory && state.html) state.history.push({ html: state.html, branding: state.lastBranding });
  if (state.history.length > 20) state.history.shift();
  state.html = html;
  state.lastBranding = branding;
  ui.reviseCard.hidden = false;
  await renderPreview();
  showStage("preview");
  syncButtons();
}

async function renderPreview(): Promise<void> {
  ui.codeView.textContent = state.html;
  ui.htmlSize.textContent = state.html ? `${(state.html.length / 1024).toFixed(1)} KB` : "";
  ui.preview.srcdoc = state.html ? await buildPreviewHtml(state.html, state.lastBranding?.assets ?? []) : "";
}

function showStage(view: "preview" | "code"): void {
  state.view = view;
  ui.emptyState.hidden = true;
  ui.frameWrap.hidden = view !== "preview";
  ui.codeView.hidden = view !== "code";
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
}

function initStage(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-device]").forEach((btn) =>
    btn.addEventListener("click", () => {
      ui.frameWrap.dataset.device = btn.dataset.device;
      document.querySelectorAll("[data-device]").forEach((b) => b.classList.toggle("active", b === btn));
    }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (!state.html && !state.busy) return;
      showStage(btn.dataset.view as "preview" | "code");
    }),
  );
  ui.fullscreenBtn.addEventListener("click", () => {
    const full = document.body.classList.toggle("stage-full");
    ui.fullscreenBtn.textContent = full ? "Exit full screen" : "Full screen";
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("stage-full")) ui.fullscreenBtn.click();
  });
  ui.copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.html);
      toast("HTML copied to the clipboard.");
    } catch {
      toast("Couldn't access the clipboard. Use the Code view to copy manually.", true);
    }
  });
  ui.downloadBtn.addEventListener("click", async () => {
    if (!state.html) return;
    try {
      await exportZip({
        html: state.html,
        assets: state.lastBranding?.assets ?? [],
        facts: state.facts,
        fileBase: courseSlug(state.factsUrl || "course"),
      });
      toast("ZIP downloaded: index.html + assets/. Upload the folder to any web host.");
    } catch (err) {
      toast(`Couldn't create the ZIP: ${describeError(err)}`, true);
    }
  });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function init(): void {
  initSettingsForm();
  initUploads();
  initStage();

  ui.courseUrl.addEventListener("input", updateUrlHint);
  ui.courseUrl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") ui.analyzeBtn.click();
  });
  ui.analyzeBtn.addEventListener("click", () =>
    runTask(async (signal) => {
      requireClaudeKey();
      await loadFacts(signal, true);
    }),
  );
  ui.manualAnalyze.addEventListener("click", () =>
    runTask(async (signal) => {
      requireClaudeKey();
      const text = ui.manualText.value.trim();
      if (text.length < 200) throw new Error("Paste more of the course page (at least a few paragraphs).");
      let url = "";
      try {
        url = currentCourseUrl();
      } catch {
        /* URL is optional for pasted content */
      }
      await analyzePage({ url, source: "manual", title: "", content: text.slice(0, 60_000), images: [] }, signal);
    }),
  );
  ui.factsSave.addEventListener("click", () => {
    try {
      const facts = parseCourseFactsJson(ui.factsJson.value);
      setFacts(facts, state.factsUrl || (() => { try { return currentCourseUrl(); } catch { return ""; } })(), null);
      toast("Course details saved.");
    } catch (err) {
      toast(describeError(err), true);
    }
  });

  document.querySelectorAll<HTMLInputElement>('input[name="brand-mode"]').forEach((r) => r.addEventListener("change", onModeChange));
  ui.chatgptReset.addEventListener("click", () => {
    state.chatgpt.kit = null;
    state.chatgpt.images.clear();
    renderGallery();
    toast("Brand kit and images discarded. New ones will be created on the next run.");
  });

  ui.generateBtn.addEventListener("click", () => runTask(generate));
  ui.reviseBtn.addEventListener("click", () => runTask(revise));
  ui.cancelBtn.addEventListener("click", () => state.abort?.abort());
  ui.undoBtn.addEventListener("click", async () => {
    const prev = state.history.pop();
    if (!prev) return;
    await setHtml(prev.html, prev.branding, false);
    toast("Reverted to the previous version.");
  });

  window.addEventListener("beforeunload", (e) => {
    if (state.html || state.busy) e.preventDefault();
  });

  onModeChange();
  syncButtons();
}

init();
