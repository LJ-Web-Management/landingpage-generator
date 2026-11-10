# Course Landing Page Generator

Paste a course link from [hazwoper-osha.com](https://hazwoper-osha.com/online-courses), pick a branding style, and Claude builds a conversion-focused landing page for it. Preview it on desktop, tablet and mobile, ask Claude for changes, then **download it as a ZIP** (`index.html` + `assets/`) ready to upload to any web host.

It's a static site with no backend, so it runs on **GitHub Pages**. It sits behind a sign-in screen, and your API keys stay in your browser.

## How it works

1. **Fetch the course page.** hazwoper-osha.com allows cross-origin requests, so the browser downloads the page directly and strips it down to what matters: meta tags, structured data (price, rating, FAQs), the main content and image URLs.
   - If the browser can't download it, Claude fetches it server-side with its web fetch tool.
   - As a last resort you can paste the page text.
2. **Extract course facts.** Claude turns the page into structured JSON (title, price, bulk tiers, duration, regulations, certificate, audience, objectives, syllabus, FAQs, testimonials, rating…). You can review and edit this JSON before generating.
3. **Branding.** Choose one of three sources:
   | Mode | What happens | Needs |
   |---|---|---|
   | **ChatGPT** | A GPT model designs a brand kit (palette, Google Fonts, voice, image prompts), then a GPT Image model generates a hero image, a course badge and feature images. | OpenAI API key |
   | **Claude styles** | No images. Claude designs the look with typography, color, CSS effects and inline SVG icons. | none |
   | **Upload** | Use your own logo, hero and other images, plus optional brand colors and fonts. Claude looks at the images to match the palette. | your files |

   Every mode supports a style direction (bold industrial, HAZWOPER OSHA yellow/black, corporate, minimal…), free-form notes, and an option to also use the official course image and logo (linked from the provider's site).
4. **Generate.** Claude streams a single self-contained HTML page with a hero, benefits, audience, syllabus, course facts, pricing, testimonials, FAQ and CTAs, plus a sticky mobile CTA, SEO and Open Graph tags, and Course JSON-LD. It only uses facts from the page and never invents prices, testimonials or accreditations.
5. **Refine & export.** Describe changes ("move pricing above the syllabus") and Claude revises the page. Undo is available. **Download ZIP** gives you:
   ```
   index.html
   assets/            ← generated or uploaded images (if any)
   course-details.json
   ```

## Deploy to GitHub Pages

The repo includes a workflow (`.github/workflows/deploy.yml`) that builds the site and publishes it.

1. **Turn on Pages:** open **Settings → Pages**. Under **Build and deployment → Source**, choose **GitHub Actions**.
2. **Set the login:** open **Settings → Secrets and variables → Actions → New repository secret** and add two secrets:
   - `LOGIN_EMAIL`: the email people sign in with.
   - `LOGIN_PASSWORD`: the password, at least 10 characters.
3. **Default branch:** in **Settings → General → Default branch**, choose `main`. GitHub only lets the default branch deploy to Pages.
4. **Deploy:** push to `main`, or open the **Actions** tab, select **Deploy to GitHub Pages** and click **Run workflow**.
5. The site will be at `https://<owner>.github.io/<repo>/`. For this repo that's `https://lj-web-management.github.io/landingpage-generator/`.

### Sign-in

Every visitor sees a sign-in screen before the app loads. The deploy workflow reads `LOGIN_EMAIL` / `LOGIN_PASSWORD` from the repository secrets and `scripts/hash-credentials.mjs` turns them into a random salt plus a slow PBKDF2-SHA256 hash (600,000 rounds). Only that hash is published. The plaintext password never appears in the repo or on the site.

- **Change the password:** update the `LOGIN_PASSWORD` secret and re-run the workflow. Everyone is signed out.
- **Missing secrets:** the deploy fails, so the site is never published without the gate.
- **Limits:** GitHub Pages has no server, so the check runs in the browser. It keeps the tool private from casual visitors, but someone determined could try to guess the password offline against the published hash, and the source code is public in this repo. Use a long password that you don't use anywhere else. For server-side, per-user sign-in, put the site behind something like Cloudflare Access on a custom domain.
- **Local testing:** `npm run dev` skips the sign-in. To test it locally:
  ```bash
  LOGIN_EMAIL=you@example.com LOGIN_PASSWORD='a-long-test-password' npm run hash-login
  ```
  then `npm run build && npm run preview`.

## Using it

1. Open the site and expand **API keys & models**.
   - Paste your **Claude API key** (from [platform.claude.com](https://platform.claude.com/)).
   - Add an **OpenAI API key** only if you'll use ChatGPT branding.
2. Paste a course URL, for example `https://hazwoper-osha.com/online-courses/osha-lockout-tagout-loto-training`, and click **Analyze** (optional: **Generate** also analyzes).
3. Pick a branding mode and options, then click **Generate landing page**.
4. Refine if needed, then click **Download ZIP**.

### Models and cost

- **Claude model:** Opus 5.5 is the default. Sonnet 5.5 is faster and cheaper, Haiku 5.5 is cheapest, and Fable 5.2 is the most capable and most expensive.
- **Effort:** controls how hard Claude thinks. Lower is faster and cheaper; High is the default.
- **Cost:** the app shows a running token count and cost estimate. A typical page on Opus 5.5 at High effort costs roughly $0.30–$1.00 in Claude usage. ChatGPT images are billed by OpenAI per image.
- **ChatGPT / image models:** default to `gpt-5.5` and `gpt-image-2`. You can type any model your OpenAI account can use. GPT Image models may require [OpenAI organization verification](https://platform.openai.com/settings/organization/general).
- **Refusal fallback:** requests opt into Claude's server-side refusal fallback (`fallbacks: "default"`). If a model's safety classifier declines a request (rare for safety-training content), the API retries it on Anthropic's recommended fallback model instead of failing. Haiku 5.5 doesn't support this.

### API key safety

- Keys are only sent directly from your browser to `api.anthropic.com` and `api.openai.com`. They're never stored in this repo or on GitHub Pages.
- By default keys are kept for the current tab only. Tick **Remember API keys on this device** to keep them in `localStorage`, and use **Forget saved keys** to remove them.
- The preview runs in a sandboxed iframe that can't read your keys.
- Anyone who opens your Pages site must use their own keys. Consider a dedicated API key with a spend limit.

## Local development

Requires Node.js 20+.

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run build
```

`npm run build` type-checks and writes the static site to `dist/`.

### Project structure

```
index.html            App layout
src/main.ts           UI controller (state, progress, preview, revisions)
src/course.ts         Course page fetching and condensing
src/schema.ts         Course facts schema (Zod → structured outputs)
src/claude.ts         Claude API calls: fact extraction, web fetch fallback, streaming page generation
src/prompts.ts        System prompts, style presets, prompt builders
src/branding.ts       ChatGPT brand kit + GPT Image generation
src/assets.ts         Image assets (sizes, downscaling for Claude vision)
src/export.ts         Preview HTML and ZIP export
src/settings.ts       Settings and API-key storage
src/auth.ts           Sign-in gate (PBKDF2 check, sessions)
scripts/hash-credentials.mjs  Builds the login hash from LOGIN_EMAIL / LOGIN_PASSWORD
```

## Troubleshooting

| Problem | Fix |
|---|---|
| Deploy fails at "Get Pages site" | Turn on Pages: Settings → Pages → Source: GitHub Actions. |
| Deploy fails at "Configure login" | Add the `LOGIN_EMAIL` and `LOGIN_PASSWORD` repository secrets. |
| Deploy fails with "not allowed to deploy to github-pages" | Make `main` the default branch (Settings → General). |
| "Sign-in isn't configured" on the site | The site was built without the login secrets. Add them and re-run the workflow. |
| "Couldn't load the course page" | Use **Can't fetch the page? Paste its content instead**. If your organization restricts Claude's web tools, enable web fetch in the Claude Console. |
| Claude 401 / OpenAI 401 | Re-check the API key in step 1. |
| OpenAI 403 on images | Your OpenAI organization may need verification for GPT Image models. Or switch to Claude styles or Upload. |
| "Model not found" | Pick another Claude model, or correct the ChatGPT/image model name. |
| Output cut off | Lower the effort level or shorten your extra instructions. |
