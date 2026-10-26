# Insta Buddy marketing site

A static marketing site in `site/`. It does not change the root Vite app or the Electron shell.

## Run it

From the repository root:

```bash
npm install
npm run site:dev      # http://localhost:4173
```

`site:dev` first builds the real renderer into `site/public/app` with `base: '/app/'`, then starts the site dev server. The working demo on `demo.html` is that real app in an iframe, not a mockup.

To produce a deployable folder:

```bash
npm run site:build
npm run site:preview  # serves site/dist on http://localhost:4173
```

`npm run site:build` writes `site/dist/`. Serve that folder from the root of a static host. The site uses root-relative paths for CSS, scripts, screenshots and `/app/`.

## What is here

| Path | Purpose |
| --- | --- |
| `index.html` | Main marketing page |
| `demo.html` | Real app working demo |
| `terms.html` | Draft Terms of Service |
| `privacy.html` | Draft Privacy Policy |
| `styles.css` | Shared design system |
| `site.js` | Accessible product tab switcher |
| `public/favicon.svg` | Brand mark |
| `public/assets/screens/` | Real app screenshots, WebP |
| `public/assets/fonts/` | Self-hosted Newsreader Variable and its OFL license |
| `DESIGN_PLAN.md` | Two-pass design plan and review |

## Content rules used

- Real product facts only, taken from the app and `README.md`.
- No testimonials, customer logos, invented statistics or pricing.
- The built-in demo photos are labelled as locally generated sample images wherever they appear.
- Terms and Privacy are marked as drafts. Missing publisher, contact, hosting and legal details are written as bracketed placeholders on those pages.
- No em dash or en dash in the site copy.
- One page-load motion. Reduced-motion preference is respected.
- No external font, icon, analytics or motion dependency.

## Screenshots

The screenshots in `public/assets/screens/` were captured from the running Vite app after clicking `Try a demo trip`. They are real app screens. The sample photos come from the app's procedural demo generator, so they are simulated holiday photos, not customer images.

## Fonts

Newsreader Variable is self-hosted from `public/assets/fonts/`. Its SIL Open Font License text is included as `OFL.txt`. The body uses a system sans stack.

## Notes

- `site/public/app` and `site/dist` are generated and ignored by Git.
- The root app build keeps `base: './'` for Electron. The site uses a separate config, `site/app.vite.config.ts`, to build the same renderer with `base: '/app/'`.
- The attachment described in the handoff as `image-1.png` was not present in this workspace and its purpose was unknown, so it is not used.
