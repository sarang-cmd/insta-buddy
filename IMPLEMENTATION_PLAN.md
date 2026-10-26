# Insta Buddy — Implementation Plan

**One-liner:** drop a folder of holiday photos → Insta Buddy groups them into moments, picks the keeper from every burst/retake, suggests AI touch-ups (straighten, horizon, remove wires, remove people, crop, extend, sharpen) and assembles a caption-ready dump for Instagram.

**Product principles**

1. **Nothing leaves the device.** All analysis and editing runs in the browser (Canvas / WebGL-free pixel maths). No upload, no API keys, no accounts. Privacy is the selling point.
2. **Every suggestion explains itself.** "Straighten 2.4° — horizon is tilted" beats a magic wand you can't trust.
3. **Never silently rewrite a photo.** Suggestions are one-tap, non-destructive, undoable, and export always re-renders from the original file.
4. **Cull before you edit.** The biggest win for a dump is picking the right 9 from 240, not 40 individual edits.

---

## 1. Architecture

| Layer | Choice | Why |
| --- | --- | --- |
| UI | React 18 + TypeScript + Vite | Fast iteration, typed state, instant dev server |
| State | Zustand (single store) | One serialisable trip model, no prop drilling |
| Styling | Hand-written CSS tokens + utilities | Editorial look, zero runtime cost, no config risk |
| Image decode | `createImageBitmap(file, {imageOrientation:'from-image'})` | Native, EXIF-orientation aware, off the JS heap path |
| EXIF | `exifr` | Capture time + GPS + orientation + camera |
| Pixel work | `OffscreenCanvas`/`canvas` + typed arrays | Sharpness, hashes, tilt, edges, retouch |
| Retouch | Custom multi-scale inpainting (diffusion + patch synthesis) | Real content-aware fill without a server |
| Export | Canvas re-render + `JSZip` | Full-res downloads, zip of the whole dump |
| Icons | `lucide-react` | Crisp and tiny |

Pipeline: **Ingest → Decode → Analyse → Group → Suggest → Edit → Compose → Export.** Each stage is a pure module in `src/lib`, so it is testable and can be moved to a Worker later without touching the UI.

---

## 2. Data model

```ts
Photo {
  id, file, meta { fileName, size, width, height, takenAt, takenAtSource, gps, camera }
  status: queued | decoding | analysing | ready | error
  analysis {
    scores { sharpness, exposure, color, overall }
    phash, hist                        // similarity
    tiltDeg, tiltConfidence, horizonY  // level horizon
    skyFraction, wireCandidates[]      // overhead lines
    personCandidates[]                 // skin-tone blob heuristic
    subjectX, subjectY, aspect
  }
  baseUrl     // original OR retouched bitmap result
  recipe      // { straighten, crop, extend, adjust{...}, applied retouch ops }
  suggestions IDs seen/dismissed
  clusterId, role: hero | retake | alt | hidden
}

Cluster (moment) { id, sessionId, photoIds[], heroId, kind: burst|similar|single, label }
Session          { id, start, end, gps?, photoIds[], title }
```

Edits are a **recipe** (declarative) + an optional **baked retouch base**. Previews render recipe → cached `PreviewURL`; export re-runs the same renderer at up to 4096 px, so previews and downloads always agree.

---

## 3. Analysis (all local, ~30–80 ms/photo)

1. **Decode** to a 512 px working bitmap (plus 1600 px preview on demand).
2. **Sharpness** — variance of the Laplacian on luma, normalised to 0–100.
3. **Exposure** — histogram mean/σ, clipped-highlight and crushed-shadow ratios → score.
4. **Colour** — Hasler–Süsstrunk colourfulness + mean saturation → "flat" detector.
5. **Similarity** — 64-bit dHash + 12-bin hue histogram. Hamming ≤ 10 = near-identical.
6. **Level horizon** — Sobel orientation histogram, smoothed peak inside ±20°, weighted confidence. Also returns horizon line's y for crop suggestions.
7. **Sky** — bright, low-saturation/blue-ish pixels in the top 55 % → fraction + bounding band.
8. **Overhead lines / poles** — Hough accumulation on strong Canny-ish edges: long near-horizontal thin runs in the sky band (wires) and long near-vertical runs (poles). Each peak → a line candidate with endpoints, used to pre-paint the retouch mask.
9. **People** — skin-tone chroma blobs (>0.4 % area, portrait-ish aspect, merged) → candidate boxes with confidence. Explicitly labelled a heuristic in the UI; it seeds the remove-people brush, it does not claim face detection.
10. **Subject position** — magnitude-weighted edge centroid → rule-of-thirds / crop suggestions.

---

## 4. Grouping

1. Sort by capture time (EXIF `DateTimeOriginal`, else file mtime; the UI marks which).
2. **Sessions** — split on gaps > 45 min. Title from weekday + time-of-day + GPS bucket (≈200 m) when available; no reverse geocoding, so it never invents a place name.
3. **Moments inside a session** — single-link clustering on dHash Hamming ≤ 12 (and ≤ 10 min apart). Time-adjacent bursts and visually-similar scenes both land together.
4. **Roles** — hero = max overall score (tie-break sharpness, then earliest); the rest are `retake` (near-duplicate) or `alt` (same moment, different framing). Hidden-by-default toggle for retakes.
5. **Copy for each moment** — "7 shots · keeper #4 — sharpest, best exposed · 3 retakes, 1 with eyes-closed risk flagged by low sharpness".

---

## 5. Suggestion engine (rules with confidence + reason)

| Suggestion | Trigger | Action |
| --- | --- | --- |
| Straighten 2.4° | \|tilt\| ≥ 1.2°, confidence ≥ 0.5 | recipe.straighten |
| Level the horizon by crop | strong tilt + horizon not in the middle | crop to horizon thirds |
| Remove overhead lines | ≥ 1 long thin line in the sky band | retouch with pre-painted line mask |
| Remove person / people | skin-box present, area > 1.5 % | retouch with box mask |
| Remove object | high-edge small blob in clean background | brush retouch |
| Sharpen +18 | sharpness < 45 | adjust.sharpen |
| Lift shadows / tame highlights | crushed < 3 % / clipped > 4 % | adjust.exposure/highlights |
| Warm it up | colourfulness low & cool WB cast | adjust.temp |
| Crop to 4:5 | not already 4:5 | crop (portrait-aware, subject-aware) |
| Extend to 4:5 | landscape hero with room at the edges | generative expand |
| Auto enhance | always available | safe bundle of the above |

Each carries `confidence`, `reason`, and a tonal `kind` (geometry / light / colour / object) for grouping in the panel. "Apply all safe" applies geometry + light only.

---

## 6. Editor

- **Straighten** — slider ±15° + horizon auto-level from analysis; rotate-cover-crop render.
- **Light & colour** — exposure, contrast, highlights, shadows, warmth, saturation, vibrance (single `adjust` object).
- **Crop** — free, 1:1, 4:5, 9:16, 16:9, original; subject-centred defaults, draggable.
- **Extend** — pick a target aspect; the canvas grows and the new area is filled by mirrored + blurred edge synthesis (generative-expand stand-in, flagged as "approx").
- **Sharpen / vignette** — unsharp mask and radial falloff.
- **Retouch brush** — paint masks (auto-seeded for lines/people), adjustable size, then multi-scale inpainting: coarse pyramid diffusion to kill the hole, patch-synthesis passes to restore texture. Bakes into a new base, fully undoable.
- Compare (hold), undo stack, reset.

---

## 7. Compose & export

- **Selection** — auto-picks heroes, one per moment, chronological; drag to reorder, pin/exclude.
- **Formats** — carousel 4:5, square 1:1, 9-grid preview, story 9:16.
- **Ordering** — chronological / best-first / colour-flow.
- **Captions** — three locally generated variants (short / playful / story), hashtag sets by trip vibe, and per-photo alt text. Template + seeded word banks; no network call, labelled as such.
- **Export** — ZIP with edited JPEGs at chosen long edge, `captions.txt`, `captions.json`, plus a 9-grid contact-sheet PNG. One-tap download.

---

## 8. Desktop shell (Electron)

The renderer is unchanged: same Vite bundle, same stores. The desktop build only adds a secure host around it.

**Process split**

| Layer | Responsibility |
| --- | --- |
| `electron/main.ts` | window + menu + CSP, IPC router, native dialogs, single-instance, window state |
| `electron/preload.ts` | one `contextBridge` surface (`window.buddy`) — no node exposed to the page |
| `electron/aiProxy.ts` | all provider traffic: key injection, https guard, retry, timeouts, error normalisation |
| `electron/vault.ts` | keys at rest: `safeStorage` → OS keychain, file mode 0600, fallback flagged |

**Why proxy through main**: CORS disappears for every provider, keys never exist in page memory, and the app can
enforce policy (https-only, loopback exception for local models, payload caps) in one place. The renderer contract is
`{providerId, modelId, baseUrl?, request} → {ok, result | error, httpStatus, ms}`.

**Hardening checklist**: `contextIsolation` on, `nodeIntegration` off, `sandbox` on, strict CSP, `window.open` denied,
in-app navigation only, webviews blocked, permissions denied, external links `https`-checked, vault 0600, no secrets in
logs, single-instance lock.

**Packaging**: `electron-builder` → dmg (arm64/x64, hardened runtime + entitlements), NSIS (x64/arm64), AppImage + deb.
`vite base: './'` so `file://` loading works; asar with only `dist/**`, `electron/dist/**`, `package.json`.

## 9. AI providers (12) — pluggable layer

**Shape**: a provider registry (id, transport, base URL, models with per-model capabilities, quirks) + request builders
+ response parsers + one runtime. Three transports cover twelve providers:

| Transport | Providers | Notes |
| --- | --- | --- |
| OpenAI-compatible | OpenAI, OpenRouter, Groq, Mistral, DeepSeek, xAI, Together, LM Studio | different base URLs, some extra headers, optional JSON mode |
| Azure OpenAI | Azure | deployment in path, `api-key` header, `api-version` |
| Anthropic | Claude | `x-api-key`, `anthropic-version`, base64 image blocks |
| Gemini | Google | `:generateContent`, `inline_data`, `responseModalities` for image out |
| Ollama | Ollama | native `/api/chat`, images as base64 array, no key |

**Capabilities are per model**, so `gpt-4.1-mini` (vision, no pixels) and `gpt-image-1` (masked edits) coexist under one
provider badge. The UI disables what the selected model can't do and explains the fix.

**Feature mapping**

| Feature | Request | Fallback |
| --- | --- | --- |
| Captions / hashtags / alt text | `text` or `vision` + JSON mode | local template engine |
| Second opinion on a frame | `vision` → verdict, score, issues, ≤4 editable actions | local rule suggestions |
| Burst ranking | `vision` over ≤4 frames → winner + why | local score ordering |
| AI erase | `imageEdit` with the painted mask (PNG alpha) | on-device inpaint |

**Safety rails**: image upload is a separate hard opt-in from picking a provider; size is capped (768/1024/1536 px);
prompts demand JSON and parsing is tolerant (fences, prose, truncation) with clamping of every field; unknown edit kinds
are dropped; requests are time/​size bounded; all failures map to a hint.

## 10. Build order

1. Scaffold, design tokens, shell, drop zone.
2. EXIF + decode + thumbnail pipeline with progress.
3. Analysis modules + scores/hashes/tilt.
4. Grouping + review UI (moments, heroes, retake badges).
5. Suggestion engine + panel.
6. Editor: geometry/light/crop, then retouch/inpaint, then extend.
7. Compose, captions, export.
8. Demo-photo generator (procedural holiday scenes with bursts, tilts, wires) so the app is explorable with zero setup.
9. Polish: keyboard, empty/error states, responsive, README.
10. Electron shell: preload contract, IPC, vault, proxy, CSP/menu, packaging config.
11. AI layer: registry → transports → runtime → tasks → settings UI → feature wiring in review/compose/editor.
12. Tests: transport construction for all 12, runtime dispatch, task parsing, and the main process against a mocked
    Electron (key-at-rest, https enforcement, retries, dialogs).

## 11. Deliberate limits (documented in-app)

- Skin-tone people detection is a **heuristic**, not a model — it seeds the brush.
- Line detection finds strong straight edges; thin wires over busy backgrounds can be missed.
- Extend is mirrored-edge synthesis, not a diffusion model — good for sky/wall/sea, visible on text/faces.
- Captions are template-generated; you can edit every line.
- Everything is cached in memory; a refresh clears the trip (no local DB in v1).
- AI features are opt-in and provider-dependent. Image editing needs an image model, and only four providers have one.
- In the web build, keys are session-only; only the desktop build has the encrypted vault and the CORS-free proxy.
- The Electron binary is downloaded at install time; the shell is covered by tests that run the real main bundle against
  a mocked Electron, so CI needs no display.
