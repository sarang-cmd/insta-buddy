# insta buddy

**Drop the whole camera roll. Get back a sorted, culled, touched-up holiday dump.**

Insta Buddy groups your photos into moments, picks the keeper out of every burst and retake, suggests the edits you'd
actually make (straighten, level the horizon, remove overhead lines, remove people, remove objects, crop, extend,
sharpen) and assembles a caption-ready set for Instagram.

Everything — decoding, scoring, grouping, retouching, exporting — runs **in your browser**. No upload, no account, no
API keys.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/
```

No photos to hand? Click **Try a demo trip** — it paints a 21-frame holiday (bursts, soft retakes, tilted horizons,
overhead wires, people in frame) so you can poke at every feature.

---

## What it does

### 1. Ingest
- Drag-and-drop or file picker, plus **⌘V to paste** images.
- EXIF capture time, GPS, camera, lens, ISO, aperture, shutter — read locally with `exifr`.
- Falls back to file timestamps (and says so) when EXIF is missing.
- Decodes with `createImageBitmap(file, { imageOrientation: 'from-image' })`, so rotated phone shots land upright.

### 2. Analyse (≈30–110 ms/photo, all on the CPU)
| Signal | Method |
| --- | --- |
| Sharpness | variance of the Laplacian on luma |
| Exposure | histogram mean, clipped-highlight and crushed-shadow ratios |
| Colour | Hasler–Süsstrunk colourfulness + mean saturation |
| Similarity | 64-bit dHash + 12-bin hue histogram + a 6×4 coarse luma signature (blur/exposure tolerant) |
| Horizon tilt | Sobel → Hough line space → dominant near-horizontal orientation, sub-degree weighted refinement |
| Sky | bright / low-saturation / blue-ish row profile |
| Overhead lines & poles | Hough peaks **verified per line**: the line must be a *thin dark stroke with brighter background on both sides*, and it must sit against sky. Ridges, sea lines and horizons fail this test. |
| People | skin-chroma blobs in YCbCr with size/aspect/fill gates, sky rejection, gradient rejection and a contrast test against the surrounding ring — an honest heuristic, not a face model |
| Objects | high-edge cells surrounded by visually calm neighbours |
| Subject | magnitude-weighted edge centroid (drives crop framing) |

### 3. Group
- Sorts by capture time, splits **sessions** on >45 min gaps or >2 km jumps.
- Clusters **moments** inside each session by time proximity + visual similarity.
- Picks the **keeper** per moment (overall score, sharpness tie-break, fewer repair needs) and labels the rest
  `retake` / `alt`.
- Reads back like a human: *"4 shots · keeper #3 (sharpest, best exposed) · 2 retakes"*. Retakes are hidden by
  default; one click shows them or promotes a different keeper.

### 4. Suggest
Every suggestion carries a confidence and a reason, grouped by kind:

- **Geometry** — straighten *n*°, crop to 4:5, drop the horizon onto a third, extend to 4:5.
- **Light** — lift shadows, recover highlights, open crushed blacks.
- **Colour** — take the yellow cast out, warm it up, add vibrance, calm it down.
- **Objects** — remove overhead lines, remove people, remove a distraction.
- **Quality** — rescue sharpen for soft frames.

"Tidy all safe" applies only the reversible, low-risk set (geometry + light + sharpen + vibrance) — object removal is
never automatic.

### 5. Edit (non-destructive)
- **Frame** — straighten ±15° with auto-level, aspect crops (1:1, 4:5, 9:16, 3:2), and **extend**: the frame grows and
  the new area is filled with mirrored, blurred edge synthesis (great on sky, sea and walls).
- **Light / colour** — exposure, contrast, highlights, shadows, temperature, saturation, vibrance, sharpen, vignette,
  applied through a per-pixel pass on the rendered canvas.
- **Retouch** — paint a mask (or use a pre-painted wire/people/object mask) and fill it with multi-scale *content-aware
  inpainting*: directional propagation, 26 relaxation passes, PatchMatch-style patch synthesis (random init →
  propagation → random search → voting), tone matching and seam feathering. Thin structures take the diffusion route
  (patch texture on a 20 px band mostly smears), big holes fall back to diffusion when too little real texture
  survives.
- Every retouch is baked into a new base and pushed onto an undo stack. Previews and exports always run the same
  renderer, so what you see is what downloads.

### 6. Compose & export
- Formats 4:5 / 1:1 / 9:16, ordering chronological / best-first / colour-flow, a live 3×3 feed grid and a single-frame
  preview.
- Three caption variants (short, playful, story) + hashtag set + per-photo alt text, generated locally from capture
  time, scene scores and your selection. Every line is editable and copyable.
- **Export** builds a ZIP: edited JPEGs at your chosen long edge, `captions.txt`, `captions.json` (with scores and
  per-photo metadata) and a 9-up `feed-grid.jpg`.

---

## Architecture

```
src/
  lib/
    types.ts        Photo / Recipe / Cluster / Suggestion model
    exif.ts         EXIF + GPS extraction
    image.ts        decode, render pipeline (straighten → extend → crop → scale → colour → sharpen → vignette)
    analysis.ts     scores, hashes, horizon, sky, wires, people, objects, subject
    grouping.ts     sessions, moments, keepers, roles, trip stats
    suggestions.ts  the rule engine (confidence + reason per suggestion)
    inpaint.ts      mask → content-aware fill (diffusion + patch synthesis)
    preview.ts      cached preview renderer (keyed by photo + base version + recipe)
    captions.ts     vibe detection + local caption/alt-text generation
    export.ts       ZIP export (photos, captions, grid)
    demo.ts         procedural demo trip generator
    store.ts        Zustand store: ingestion, edits, retouch, selection, toasts
  components/       TopBar, DropView, ReviewView, ClusterCard, Inspector, Editor, ComposeView, PhotoThumb
  hooks.ts          preview + media-query hooks
  styles.css        design tokens and layout
```

Edits are a **recipe** (declarative) plus an optional **baked retouch base**, so:
- previews are cheap and cached,
- undo is a stack of `{ baseUrl, recipe }` snapshots,
- export re-renders at full size from the same recipe.

Everything is in-memory for the session; nothing is written to disk or a server.

---

## Honest limits

- **People detection is a skin-chroma heuristic.** It finds compact, human-shaped blobs; it will miss people in
  helmets/gloves and can be fooled by oddly lit objects. That's why auto-masks always open in the editor for review
  instead of filling blind — the suggestion is a starting brush stroke, not a promise.
- **Wire detection needs contrast.** Thin cables against a busy sky can slip through; the brush is there for those.
- **Extend is mirrored-edge synthesis, not a diffusion model.** Convincing on sky, sea and walls; it will not invent
  signage or faces.
- **Retouch bakes at up to 2000 px** on the long edge, so object removal on a 48 MP file trades a little resolution for
  speed. Regular edits and exports render from the original at your chosen size.
- **Captions are templates** seeded by real signals (time of day, scene type, cull stats). They're a first draft to
  edit, not a ghostwriter.
- **HEIC** depends on what your browser can decode; JPEG/PNG/WebP always work.
- Analysis runs on the main thread — Web Worker offloading is the obvious next step for very large dumps.

## Roadmap
1. Move analysis + inpainting into a Worker with a progress channel (keeps the UI at 60 fps on 300-photo dumps).
2. Persist a trip in IndexedDB so a refresh doesn't lose edits.
3. Drag-to-reorder in the compose strip, and per-photo crop override in compose.
4. Optional WebGPU/Metal-backed super-resolution for the sharpen path.
5. Batch retouch: apply one mask across a burst (the same wire appears in every frame).
