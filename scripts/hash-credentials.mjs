#!/usr/bin/env node
// Turns LOGIN_EMAIL / LOGIN_PASSWORD (GitHub secrets in CI, env vars locally) into a random salt
// plus a PBKDF2-SHA256 hash, written to .env.production.local for `vite build`.
// The plaintext credentials never reach the repo or the built site.
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const ITERATIONS = 600_000;
const email = (process.env.LOGIN_EMAIL ?? "").trim().toLowerCase();
const password = process.env.LOGIN_PASSWORD ?? "";

if (!email || !password) {
  console.error(
    "LOGIN_EMAIL and LOGIN_PASSWORD must be set.\n" +
      "On GitHub: Settings → Secrets and variables → Actions → New repository secret (add both).",
  );
  process.exit(1);
}
if (password.length < 10) {
  console.error("LOGIN_PASSWORD must be at least 10 characters.");
  process.exit(1);
}

const salt = randomBytes(16);
const hash = pbkdf2Sync(Buffer.from(`${email}\n${password}`, "utf8"), salt, ITERATIONS, 32, "sha256");

writeFileSync(
  ".env.production.local",
  `VITE_AUTH_SALT=${salt.toString("hex")}\nVITE_AUTH_HASH=${hash.toString("hex")}\nVITE_AUTH_ITERATIONS=${ITERATIONS}\n`,
);
console.log("Login configured: wrote salted hash to .env.production.local");
