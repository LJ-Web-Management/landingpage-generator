import { blobToDataUrl, type Asset } from "./assets";
import type { CourseFacts } from "./schema";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * HTML for the in-app preview iframe: local `assets/...` references are swapped for
 * data URLs, and outbound links open in a new tab instead of navigating the frame.
 * The exported ZIP keeps the original relative paths.
 */
export async function buildPreviewHtml(html: string, assets: Asset[]): Promise<string> {
  let out = html;
  for (const asset of assets) {
    if (!out.includes(asset.path)) continue;
    const dataUrl = await blobToDataUrl(asset.blob);
    out = out.replace(new RegExp(`(?:\\./)?${escapeRegExp(asset.path)}`, "g"), () => dataUrl);
  }
  const linkScript = `<script>document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;var h=a.getAttribute("href")||"";if(h.charAt(0)==="#")return;e.preventDefault();window.open(a.href,"_blank","noopener");},true);</script>`;
  return /<\/body>/i.test(out) ? out.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${linkScript}</body>`) : out + linkScript;
}

export async function exportZip(opts: {
  html: string;
  assets: Asset[];
  facts: CourseFacts | null;
  fileBase: string;
}): Promise<void> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("index.html", opts.html);
  for (const asset of opts.assets) zip.file(asset.path, asset.blob);
  if (opts.facts) zip.file("course-details.json", JSON.stringify(opts.facts, null, 2));
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  downloadBlob(blob, `${opts.fileBase}-landing-page.zip`);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
