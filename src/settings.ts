import { DEFAULT_MODEL, type Effort } from "./claude";

export interface Settings {
  claudeKey: string;
  openaiKey: string;
  /** Persist API keys in localStorage (otherwise they live only for this browser tab). */
  rememberKeys: boolean;
  model: string;
  effort: Effort;
  openaiTextModel: string;
  openaiImageModel: string;
  imageQuality: "low" | "medium" | "high" | "auto";
}

export const DEFAULT_SETTINGS: Settings = {
  claudeKey: "",
  openaiKey: "",
  rememberKeys: false,
  model: DEFAULT_MODEL,
  effort: "high",
  openaiTextModel: "gpt-5.5",
  openaiImageModel: "gpt-image-2",
  imageQuality: "medium",
};

const PREFS_KEY = "lpg.prefs.v1";
const KEYS_KEY = "lpg.keys.v1";

function read(storage: Storage, key: string): Record<string, unknown> {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function write(storage: Storage, key: string, value: unknown): void {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode, blocked cookies) — settings stay in memory */
  }
}

export function loadSettings(): Settings {
  const prefs = read(localStorage, PREFS_KEY);
  const remembered = read(localStorage, KEYS_KEY);
  const session = read(sessionStorage, KEYS_KEY);
  const keys = Object.keys(remembered).length ? remembered : session;
  return { ...DEFAULT_SETTINGS, ...prefs, ...keys } as Settings;
}

export function saveSettings(s: Settings): void {
  const { claudeKey, openaiKey, ...prefs } = s;
  write(localStorage, PREFS_KEY, prefs);
  const keys = { claudeKey, openaiKey };
  if (s.rememberKeys) {
    write(localStorage, KEYS_KEY, keys);
    write(sessionStorage, KEYS_KEY, null);
  } else {
    write(sessionStorage, KEYS_KEY, keys);
    write(localStorage, KEYS_KEY, null);
  }
}

export function forgetKeys(): void {
  write(localStorage, KEYS_KEY, null);
  write(sessionStorage, KEYS_KEY, null);
}
