# insta buddy

**Drop the whole camera roll. Get back a sorted, culled, touched-up holiday dump.**

Insta Buddy groups your photos into moments, picks the keeper out of every burst and retake, suggests the edits you'd
actually make (straighten, level the horizon, remove overhead lines, remove people, remove objects, crop, extend,
sharpen) and assembles a caption-ready set for Instagram.

It ships two ways:

| | Web build | Desktop app (Electron) |
| --- | --- | --- |
| Sorting, culling, on-device edits | ✅ | ✅ |
| Keys stored encrypted in the OS keychain | ❌ memory only | ✅ |
| AI calls free of CORS limits | ❌ some providers block browsers | ✅ proxied from the main process |
| Native file picker & save dialogs | ❌ | ✅ |
| Provider keys visible to page JS | yes (in-memory) | **no** — requests are proxied |

Everything — decoding, scoring, grouping, retouching, exporting — runs **in your browser/app**. The AI providers below
are optional. With none configured, the app is fully offline.

```bash
npm install

npm run dev            # web app on http://localhost:5173
npm run desktop:dev    # electron + vite with HMR
npm run desktop        # build once and run the packaged-style desktop app
npm run desktop:package      # installers into release/ (dmg / nsis / AppImage + deb)
npm run desktop:package:win  # Windows NSIS installer only → release/*.exe
npm test               # typecheck + 100+ assertions across the AI layer and the Electron shell
```

No photos to hand? Click **Try a demo trip** — it paints a 21-frame holiday (bursts, soft retakes, tilted horizons,
overhead wires, people in frame) so you can poke at every feature.

---

## 1. What it does

### Ingest
- Drag-and-drop, native picker (desktop), file picker (web) and **⌘V to paste**.
- EXIF capture time, GPS, camera, lens, ISO, aperture, shutter — read locally with `exifr`.
- Falls back to file timestamps (and says so) when EXIF is missing.
- Decodes with `createImageBitmap(file, { imageOrientation: 'from-image' })`, so rotated phone shots land upright.

### Analyse (≈30–110 ms/photo, all on the CPU)
| Signal | Method |
| --- | --- |
| Sharpness | variance of the Laplacian on luma |
| Exposure | histogram mean, clipped-highlight and crushed-shadow ratios |
| Colour | Hasler–Süsstrunk colourfulness + mean saturation |
| Similarity | 64-bit dHash + 12-bin hue histogram + a 6×4 coarse luma signature (blur/exposure tolerant) |
| Horizon tilt | Sobel → Hough line space → dominant near-horizontal orientation, sub-degree weighted refinement |
| Sky | bright / low-saturation / blue-ish row profile |
| Overhead lines & poles | Hough peaks **verified per line**: thin dark stroke with brighter background on *both* sides, against sky |
| People | skin-chroma blobs in YCbCr with size/aspect/fill gates, sky rejection, gradient rejection, ring-contrast test |
| Objects | high-edge cells surrounded by visually calm neighbours |
| Subject | magnitude-weighted edge centroid (drives crop framing) |

### Group
- Sorts by capture time, splits **sessions** on >45 min gaps or >2 km jumps.
- Clusters **moments** inside each session by time proximity + visual similarity.
- Picks the **keeper** per moment and labels the rest `retake` / `alt`, with a readable reason:
  *"4 shots · keeper #3 (sharpest, best exposed) · 2 retakes"*.

### Suggest
Every suggestion carries a confidence and a reason: **Geometry** (straighten, crop 4:5, horizon-on-a-third, extend),
**Light** (lift shadows, recover highlights, open blacks), **Colour** (cast, warmth, vibrance), **Objects** (wires,
people, distractions), **Quality** (rescue sharpen). "Tidy all safe" applies only the reversible set; object removal is
never automatic.

### Edit (non-destructive)
- Straighten ±15° with auto-level, aspect crops, **extend** via mirrored/softened edge synthesis.
- Exposure, contrast, highlights, shadows, temperature, saturation, vibrance, unsharp mask, vignette.
- **Retouch:** paint a mask (or use a pre-painted wire/people/object mask) and fill it with content-aware inpainting —
  directional propagation, relaxation, PatchMatch-style patch synthesis, tone matching, seam feathering.
- Every retouch bakes into a new base and lands on an undo stack.

### Compose & export
- Formats 4:5 / 1:1 / 9:16, ordering chronological / best-first / colour-flow, feed grid + single-frame preview.
- Three caption variants, hashtags and per-photo alt text — generated locally, or by any AI provider you configure.
- **Export** a ZIP: edited JPEGs at your chosen long edge, `captions.txt`, `captions.json`, `feed-grid.jpg`. Desktop
  uses a native save dialog; web downloads the file.

---

## 2. AI providers (12)

All optional, all off by default. Open **Settings → AI** (or the chip in the top bar) and pick one. The on-device
engine keeps working regardless — every AI feature falls back to it or tells you why it can't.

| # | Provider | Transport | Text | Vision | Image edit (mask erase) | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **OpenAI** | `/v1/chat/completions`, `/v1/images/edits` | ✅ | ✅ | ✅ `gpt-image-1` | best all-round |
| 2 | **Anthropic** | `/v1/messages` | ✅ | ✅ | — | great at scene judgement |
| 3 | **Google Gemini** | `:generateContent` | ✅ | ✅ | ✅ `gemini-2.5-flash-image` | free tier |
| 4 | **Azure OpenAI** | deployments API | ✅ | ✅ | ✅ | your own tenant |
| 5 | **OpenRouter** | OpenAI-compatible | ✅ | ✅ | — | hundreds of models |
| 6 | **Groq** | OpenAI-compatible | ✅ | ✅ | — | fastest |
| 7 | **Mistral AI** | OpenAI-compatible | ✅ | ✅ Pixtral | — | EU-hosted |
| 8 | **DeepSeek** | OpenAI-compatible | ✅ | — | — | cheapest text |
| 9 | **xAI Grok** | OpenAI-compatible | ✅ | ✅ | — | — |
| 10 | **Together AI** | OpenAI-compatible + FLUX | ✅ | ✅ | ✅ `FLUX.1 Kontext` | open models |
| 11 | **Ollama** | `/api/chat` | ✅ | ✅ | — | **local, keyless** |
| 12 | **LM Studio** | OpenAI-compatible | ✅ | ✅ | — | **local, keyless** |

What each provider unlocks:

1. **Captions with real understanding** — with *vision* on and photo upload allowed, the model sees up to three keeper
   frames and writes captions that only fit this trip. Without upload it works from metadata only, and says so.
2. **Second opinion on a frame** — vision models return a verdict, score, issues and up to four concrete edits. Those
   edits are clickable and map onto the real recipe (straighten, crop 4:5, extend, sharpen, exposure, colour, or open
   the eraser).
3. **Burst ranking** — "Let AI pick" on a moment sends up to four frames and promotes the winner, with a one-line reason.
4. **AI erase** — paint a mask, then send the frame + mask to an image model. The result replaces the base as a normal,
   undoable retouch. Auto-picks that provider's image model even if you're currently on a text model.

Every AI surface shows the model that answered, and every failure is mapped to a plain-language fix (bad key, wrong
model, rate limit, unreachable, timeout, capability mismatch).

### Capability model
Capabilities are **per model**, not per provider: `gpt-4.1-mini` can't edit pixels, `gpt-image-1` can. The UI shows a
badge per provider, a matrix per provider, and disables the eraser button with an explanation when the selected model
can't do it. You can paste any custom model id (snapshots, fine-tunes, a proxy's naming scheme).

---

## 3. Desktop app (Electron)

```
electron/
  main.ts       window, menu, CSP, IPC, file dialogs
  preload.ts    contextBridge surface (window.buddy)
  aiProxy.ts    provider traffic: key injection, https guard, retries, timeouts, error mapping
  vault.ts      API keys at rest (safeStorage → OS keychain)
scripts/
  build-electron.mjs   esbuild bundle for main + preload
  dev-desktop.mjs      vite + electron dev loop
electron-builder.yml   dmg / nsis / AppImage + deb
.github/workflows/build-release.yml   per-platform installers on push / tag
build/
  icon.ico / icon.png / icon-512.png    app icons
  entitlements.mac.plist                hardened-runtime entitlements
```

**Security posture**
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no `remote`.
- Keys live in the main process only. The renderer sends `{providerId, modelId, request}` over IPC and never sees a
  secret — verified by a test that asserts the raw key never appears in the vault file.
- Vault is `ai-keys.json` in `userData`, written `0600`, encrypted with `safeStorage` (Keychain / DPAPI / libsecret)
  with a labelled fallback when the OS has no keyring.
- Requests leave from the main process: no CORS, and a hard guard that only allows `https:` (plus `http:` on loopback
  for Ollama / LM Studio / self-hosted).
- Strict CSP, `window.open` denied, navigation restricted to the app itself, webviews blocked, every permission
  request denied, external links handed to the system browser with an `https` check.
- Single-instance lock, window state persisted, native menu (Add photos ⌘O, Export ⌘E, Review ⌘1, Compose ⌘2,
  Settings ⌘,).

**Packaging**
```bash
npm run desktop:package      # release/Insta Buddy-0.1.0-arm64.dmg, .exe, .AppImage, .deb …
npm run desktop:package:win  # Windows NSIS installer → release/Insta Buddy-0.1.0-x64.exe
```
`electron-builder.yml` targets macOS arm64+x64 (hardened runtime + entitlements), Windows x64+arm64 (NSIS), and Linux
AppImage + deb. Assets load over `file://` from `dist/`, which is why Vite is configured with `base: './'`.
Icons live in `build/`: `icon.ico` (16–256 px, 32-bit RGBA) for Windows, `icon.png` (1024) for macOS, `icon-512.png`
for Linux.

### Building the `.exe` on Windows

```powershell
git clone https://github.com/sarang-cmd/insta-buddy; cd insta-buddy
npm install
npm run desktop:package:win
```

`release/Insta Buddy-0.1.0-x64.exe` is the NSIS installer; `release/Insta Buddy-0.1.0-arm64.exe` is the ARM64 build.
Install and launch it:

```powershell
.\release\Insta Buddy-0.1.0-x64.exe
```

To build only one architecture (useful if you don't have an ARM64 host for the ARM64 target):

```powershell
npx electron-builder --win nsis --x64   --publish never
npx electron-builder --win nsis --arm64 --publish never
```

**Code signing.** The installer is unsigned, so Windows shows a SmartScreen warning on first run. To clear it,
right-click the `.exe` → *Properties* → tick *Unblock*, or replace the identity with your own certificate via
`CSC_KEY_PASSWORD` / `win.signtoolOptions` in CI. `app.instabuddy.desktop` is already in `electron-builder.yml`, so
your signed build keeps the same identity once you add the certificate.

### Continuous integration

`.github/workflows/build-release.yml` builds every platform on every push to `main` and on `v*` tags, and uploads
each installer as an artifact:

| Job | Runner | Artifact |
|---|---|---|
| `installer-windows` | `windows-latest` | `release/*.exe` (NSIS) |
| `installer-mac` | `macos-14` | `release/*.dmg` |
| `installer-linux` | `ubuntu-latest` | `release/*.AppImage` |
| `test` | `ubuntu-latest` | `dist/` + `electron/dist/` layout |

The Windows job runs `npm test` before packaging, so a broken build can't ship. Grab the installer from the Actions
tab, or `gh run download --repo sarang-cmd/insta-buddy`. Push a `v0.1.0` tag to cut a version.

> Note: `npm install` downloads the Electron binary from GitHub release assets. In a restricted sandbox you can skip it
> with `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install` — the web app and all tests still work, but packaging cannot run
> because the win32 Electron zip lives on `objects.githubusercontent.com` (this is what blocked the `.exe` build in
> the build sandbox; CI and a Windows machine have no such restriction). `npm run test:electron` runs the real
> main-process bundle against a mocked `electron` module, so the shell is testable without a display.

---

## 4. Tests

`npm test` runs three things:

- **`test:ai`** — 70+ assertions across the provider layer: request construction for all 12 providers (URLs, auth
  headers, body shapes, JSON mode, image encoding), image-edit builders for the four capable providers, response
  parsing per transport, JSON extraction from fenced/prose output, error mapping (401/404/429/5xx/offline), runtime
  dispatch (browser fetch *and* the Electron bridge), capability guards, and the task layer (caption parsing and
  hashtag cleaning, review clamping/filtering, burst index clamping, AI-erase model auto-pick and mask conversion).
- **`test:electron`** — bundles the real `electron/main.ts` and runs it against a mocked Electron: secure
  `webPreferences`, CSP contents, menu creation, every IPC handler, vault encryption at rest, key injection into
  provider requests, https enforcement, 429 retry, 401/offline mapping, native dialogs, external-link allowlist.
- **`typecheck`** — `tsc --noEmit` over `src/` and `electron/`.

---

## 5. Honest limits

- **People detection is a skin-chroma heuristic.** Compact, human-shaped blobs, not faces. That's why auto-masks always
  open in the editor for review instead of filling blind.
- **Wire detection needs contrast.** Thin cables against busy backgrounds slip through; the brush covers those.
- **On-device extend is mirrored-edge synthesis**, convincing on sky/sea/walls, not on signage or faces.
- **AI image edits depend on the provider's model** and cost money; the result is 1024-ish square-ish output and is
  stored as a new baked base (undoable, but resolution is capped by the provider).
- **Keys in the web build are session-only** by design. Use the desktop app for the encrypted vault.
- **Captions are templates locally, or a model's draft remotely.** Both are editable; neither is fact-checked.
- Analysis runs on the main thread (Web Worker offload is the next step).

## 6. Roadmap
1. Web Worker for analysis + inpainting.
2. IndexedDB trip persistence.
3. Batch retouch across a burst (the same wire in every frame).
4. Provider-side upscaling/denoise (Replicate/fal adapters slot into the same registry).
5. Manual focus/burst scoring with a small on-device model via ONNX Runtime Web.
