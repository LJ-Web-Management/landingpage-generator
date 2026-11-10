/** Image files that ship inside the exported ZIP under `assets/`. */
export interface Asset {
  /** Path used inside the generated HTML and the ZIP, e.g. "assets/hero.webp". */
  path: string;
  role: "logo" | "hero" | "badge" | "feature" | "other";
  /** Human description given to Claude so it knows where the image fits. */
  description: string;
  blob: Blob;
  mime: string;
  width: number;
  height: number;
}

export interface ImageForClaude {
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  base64: string;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

export function extensionFor(mime: string, fallbackName = ""): string {
  return EXT_BY_MIME[mime] ?? fallbackName.split(".").pop()?.toLowerCase() ?? "img";
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(blob);
  });
}

export function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // The decoded image stays usable after revoking; revoke on next tick to be safe.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const img = await loadImageElement(blob);
    return { width: img.naturalWidth || 0, height: img.naturalHeight || 0 };
  } catch {
    return { width: 0, height: 0 };
  }
}

export async function makeAsset(
  blob: Blob,
  baseName: string,
  role: Asset["role"],
  description: string,
): Promise<Asset> {
  const mime = blob.type || "application/octet-stream";
  const ext = extensionFor(mime, blob instanceof File ? blob.name : "");
  const { width, height } = await imageSize(blob);
  return { path: `assets/${baseName}.${ext}`, role, description, blob, mime, width, height };
}

/**
 * Downscale an image so Claude can look at it cheaply (vision input).
 * Returns null for formats Claude can't read (e.g. SVG that fails to rasterize).
 */
export async function imageForClaude(blob: Blob, maxSide = 1024): Promise<ImageForClaude | null> {
  let img: HTMLImageElement;
  try {
    img = await loadImageElement(blob);
  } catch {
    return null;
  }
  const w = img.naturalWidth || maxSide;
  const h = img.naturalHeight || maxSide;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
  if (!out) return null;
  // Safari may ignore the WebP request and hand back PNG; trust the blob's real type.
  const mediaType = out.type === "image/webp" ? "image/webp" : "image/png";
  const dataUrl = await blobToDataUrl(out);
  return { mediaType, base64: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}

export function describeAssetsForPrompt(assets: Asset[], remoteImages: { url: string; description: string }[]): string {
  const lines: string[] = [];
  for (const a of assets) {
    const size = a.width && a.height ? ` (${a.width}×${a.height}px)` : "";
    lines.push(`- ${a.path}${size} — ${a.role}: ${a.description}`);
  }
  for (const r of remoteImages) lines.push(`- ${r.url} — ${r.description}`);
  return lines.length ? lines.join("\n") : "None. Do not use any <img> tags; rely on typography, CSS and inline SVG.";
}
