/**
 * Fetching and condensing a course page.
 *
 * hazwoper-osha.com serves `Access-Control-Allow-Origin: *`, so the browser can
 * download course pages directly. A course page is ~1 MB of HTML, so we strip it
 * down to the parts that matter (meta tags, JSON-LD, the main content as
 * Markdown-ish text, and image URLs) before handing it to Claude.
 */

export interface PageImage {
  url: string;
  alt: string;
}

export interface CoursePage {
  url: string;
  source: "direct" | "claude-web-fetch" | "manual";
  title: string;
  /** Condensed text that is sent to Claude for fact extraction. */
  content: string;
  images: PageImage[];
}

const MAX_CONTENT_CHARS = 45_000;
const MAX_JSONLD_CHARS = 8_000;

export function normalizeCourseUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Enter a course URL first.");
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http(s) URLs are supported.");
  }
  url.hash = "";
  return url;
}

export function isHazwoperOshaUrl(url: URL): boolean {
  return /(^|\.)hazwoper-osha\.com$/i.test(url.hostname);
}

export function courseSlug(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? "course";
    return last.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "course";
  } catch {
    return "course";
  }
}

/** Download the course page HTML straight from the browser (requires CORS). */
export async function fetchCourseHtml(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal, credentials: "omit", mode: "cors", redirect: "follow" });
  if (!res.ok) throw new Error(`The course page returned HTTP ${res.status}.`);
  const type = res.headers.get("content-type") ?? "";
  if (type && !type.includes("html")) throw new Error(`Expected an HTML page but got "${type}".`);
  return res.text();
}

export function condenseCourseHtml(html: string, pageUrl: string): CoursePage {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const meta = (selector: string) => doc.querySelector<HTMLMetaElement>(selector)?.content?.trim() ?? "";

  const title = doc.querySelector("title")?.textContent?.trim() || meta('meta[property="og:title"]');
  const description = meta('meta[name="description"]') || meta('meta[property="og:description"]');

  // --- Structured data -------------------------------------------------------
  const jsonLd: string[] = [];
  const imageUrls = new Map<string, string>();
  const addImage = (raw: string | null | undefined, alt = "") => {
    if (!raw) return;
    const src = raw.trim().split(/\s+\d+[wx](,|$)/)[0]?.trim();
    if (!src || src.startsWith("data:")) return;
    try {
      const abs = new URL(src, pageUrl).href;
      if (!imageUrls.has(abs)) imageUrls.set(abs, alt);
    } catch {
      /* ignore unparsable URLs */
    }
  };

  addImage(meta('meta[property="og:image"]'), "Open Graph image");

  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const raw = script.textContent ?? "";
    let text: string;
    try {
      const data: unknown = JSON.parse(raw);
      if (isBreadcrumbOnly(data)) continue;
      collectJsonLdImages(data, addImage);
      text = JSON.stringify(data);
    } catch {
      // Some sites ship JSON-LD with raw newlines inside strings; keep it as text.
      text = raw.replace(/\s+/g, " ").trim();
      for (const m of text.matchAll(/"(?:image|logo|thumbnailUrl)"\s*:\s*"([^"]+)"/g)) addImage(m[1], "structured data image");
    }
    if (text) jsonLd.push(text.slice(0, MAX_JSONLD_CHARS));
  }

  // --- Main content ------------------------------------------------------------
  const root =
    doc.querySelector("main") ?? doc.querySelector("article") ?? doc.querySelector('[role="main"]') ?? doc.body;
  const clone = root.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(
      "script, style, noscript, svg, iframe, template, canvas, video, audio, select, input, textarea, [hidden], [aria-hidden='true']",
    )
    .forEach((el) => el.remove());
  if (root === doc.body) clone.querySelectorAll("header, footer, nav").forEach((el) => el.remove());

  for (const img of clone.querySelectorAll("img")) {
    const w = Number(img.getAttribute("width") ?? "0");
    const h = Number(img.getAttribute("height") ?? "0");
    if ((w && w < 100) || (h && h < 100)) continue; // icons, flags, badges
    addImage(img.getAttribute("data-src") ?? img.getAttribute("data-lazy-src") ?? img.getAttribute("src"), img.alt ?? "");
  }

  const mainText = dedupeLines(htmlToText(clone)).slice(0, MAX_CONTENT_CHARS);
  if (mainText.length < 300 && jsonLd.length === 0) {
    // Blocked/challenge pages or JavaScript-only shells: let the caller fall back to Claude's web fetch.
    throw new Error("The downloaded page had no readable course content.");
  }

  const images = [...imageUrls].slice(0, 15).map(([url, alt]) => ({ url, alt }));

  const content = [
    `Course URL: ${pageUrl}`,
    `Page title: ${title}`,
    description && `Meta description: ${description}`,
    jsonLd.length ? `\nStructured data (JSON-LD):\n${jsonLd.join("\n\n")}` : "",
    images.length ? `\nImages found on the page:\n${images.map((i) => `- ${i.url}${i.alt ? ` (${i.alt})` : ""}`).join("\n")}` : "",
    `\nMain page content:\n${mainText}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { url: pageUrl, source: "direct", title, content, images };
}

function isBreadcrumbOnly(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as Record<string, unknown>)["@type"] === "BreadcrumbList";
}

function collectJsonLdImages(node: unknown, add: (url: string, alt?: string) => void, key = ""): void {
  if (typeof node === "string") {
    if (key === "image" || key === "logo" || key === "thumbnailUrl") add(node, `structured data ${key}`);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectJsonLdImages(child, add, key));
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if ((key === "image" || key === "logo") && typeof obj.url === "string") add(obj.url, `structured data ${key}`);
    for (const [k, v] of Object.entries(obj)) collectJsonLdImages(v, add, k);
  }
}

const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DETAILS", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION",
  "FIGURE", "FOOTER", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "SUMMARY", "TABLE",
  "TBODY", "THEAD", "TFOOT", "TR", "UL", "BR",
]);

/** Convert a DOM subtree to compact, Markdown-ish text (headings, list items, table rows). */
function htmlToText(root: HTMLElement): string {
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ");
      if (text.trim()) out.push(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName;
    const heading = /^H([1-6])$/.exec(tag);
    if (heading) {
      out.push(`\n\n${"#".repeat(Number(heading[1]))} ${(el.textContent ?? "").replace(/\s+/g, " ").trim()}\n`);
      return;
    }
    if (tag === "TD" || tag === "TH") {
      out.push(" | ");
    } else if (tag === "LI") {
      out.push("\n- ");
    } else if (BLOCK_TAGS.has(tag)) {
      out.push("\n");
    }
    el.childNodes.forEach(walk);
    if (BLOCK_TAGS.has(tag)) out.push("\n");
  };
  walk(root);
  return out.join("");
}

function dedupeLines(text: string): string {
  const lines = text.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim());
  const result: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line || line === "-" || line === "|") {
      if (result[result.length - 1] !== "") result.push("");
      continue;
    }
    // Drop repeated non-heading lines (pricing tables, tab labels) that appear several times.
    if (!line.startsWith("#") && line.length > 2 && seen.has(line)) continue;
    seen.add(line);
    result.push(line);
  }
  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
