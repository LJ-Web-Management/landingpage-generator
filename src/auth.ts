/**
 * Login gate for the static site.
 *
 * GitHub Pages has no server, so the check runs in the browser. The credentials are never in
 * the repo or the bundle: the deploy workflow reads them from GitHub secrets and
 * `scripts/hash-credentials.mjs` bakes in only a random salt plus a slow PBKDF2-SHA256 hash
 * of "email\npassword". A wrong guess costs real CPU time, but a determined attacker can still
 * guess offline against the published hash, so use a long, unique password.
 */

const SALT: string = import.meta.env.VITE_AUTH_SALT ?? "";
const HASH: string = import.meta.env.VITE_AUTH_HASH ?? "";
const ITERATIONS = Number(import.meta.env.VITE_AUTH_ITERATIONS ?? 600_000);
const SESSION_KEY = "lpg.session.v1";

export type AuthMode = "enforced" | "disabled-dev" | "not-configured";

export function authMode(): AuthMode {
  if (SALT && HASH) return "enforced";
  // Local `npm run dev` without credentials: no gate. Production builds without credentials stay locked.
  return import.meta.env.DEV ? "disabled-dev" : "not-configured";
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function derive(email: string, password: string): Promise<string> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${normalizeEmail(email)}\n${password}`),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(SALT), iterations: ITERATIONS },
    material,
    256,
  );
  return bytesToHex(bits);
}

export async function verifyCredentials(email: string, password: string): Promise<boolean> {
  if (authMode() !== "enforced") return false;
  const candidate = await derive(email, password);
  // Compare every character so timing doesn't reveal how much matched.
  let diff = candidate.length ^ HASH.length;
  for (let i = 0; i < Math.max(candidate.length, HASH.length); i++) {
    diff |= (candidate.charCodeAt(i) || 0) ^ (HASH.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function read(storage: Storage): string | null {
  try {
    return storage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

/** A session is tied to the current hash, so changing the password signs everyone out. */
export function hasSession(): boolean {
  if (authMode() === "disabled-dev") return true;
  if (authMode() !== "enforced") return false;
  return read(sessionStorage) === HASH || read(localStorage) === HASH;
}

export function startSession(remember: boolean): void {
  try {
    (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, HASH);
  } catch {
    /* storage blocked: the session lasts until the page is reloaded */
  }
}

export function endSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
