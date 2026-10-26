# Insta Buddy marketing site: design plan

This file records the two-pass design process requested in the brief. It is documentation, not a runtime dependency.

## Pass 1: compact token system

### Subject and audience

The product is an on-device photo dump sorter. The audience is someone with a folder of holiday photos who wants a calm, private path from hundreds of frames to a small set worth posting. The page has one job: make the real product legible before asking for a download or a GitHub visit.

### Color

| Name | Hex | Use |
| --- | --- | --- |
| Paper | `#F4F1EA` | Page background, warm neutral base |
| Porcelain | `#FBF9F5` | Quiet raised surfaces and legal pages |
| Ink | `#171614` | Primary text and buttons |
| Slate | `#5E5B55` | Secondary text and captions |
| Rule | `#D8D2C8` | Hairline borders and dividers |
| Deep teal | `#2C5E63` | One accent for links, focus rings and the brand mark |

The app screenshots supply their own dark surface. No page section needs a gradient, orb or decorative glow.

### Type

- Display: self-hosted Newsreader Variable, optical-size axis enabled. Large headlines use tight line height and generous tracking corrections. It is editorial without becoming a newspaper pastiche.
- Body: a humanist system sans stack, `"Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif`. No default web font, no Inter, Geist or Space Grotesk.
- Scale: hero `clamp(4.2rem, 8.5vw, 9rem)`; section heads `clamp(2.8rem, 5vw, 5.4rem)`; body `1.0625rem` with `1.65` line height. Line lengths stay under 78 characters.
- No tracked-out all-caps labels, no monospace data labels, no single italic word inside a headline.

### Layout

Left aligned, asymmetric, built on a 12-column grid with a generous outer margin. Content is left aligned almost everywhere; the stage caption is the only centered text. Structural rules encode sequence and group content, not decoration.

ASCII wireframes considered:

```
A. Headline left, product right
+---------------------+  +---------------------------+
| Big type            |  | Real product screenshot   |
| Short explanation   |  |                           |
+---------------------+  +---------------------------+

B. Headline above, full-width product stage
+---------------------------------------------------+
| Big type                                          |
| Short explanation            Actions              |
+---------------------------------------------------+
| Tabs | Real product screenshot, full width         |
+---------------------------------------------------+

C. Sequence as three equal cards
+---+ +---+ +---+
| 1 | | 2 | | 3 |
+---+ +---+ +---+
```

Option B wins because the brief asks for the actual product to be the main visual. Option C is rejected as the default SaaS-card layout. The process section instead uses three full-width ledger rows with alternating image crops.

### Principles

1. The product screen is the hero, not an illustration of a product.
2. Every visual claim comes from a real app screen or the README.
3. One accent, one page-load motion, no decorative gradients.
4. Simulated demo photos are labeled wherever they appear.
5. Legal pages say what is missing instead of inventing a publisher.

## Pass 2: review against the brief

- The first color idea used a terracotta accent on warm cream. That is one of the generic defaults the skill warns about, so the accent moved to deep teal, a darkroom reference, and the page kept a warmer neutral base rather than a Claude-like cream.
- A high-contrast serif plus all-caps eyebrows would have made the page look like a generic editorial template. Newsreader and sentence-case notes replace that treatment.
- Three feature cards were replaced with a tabbed product stage and a ledger-style sequence. The numbered markers remain only because the content is an actual ordered workflow.
- The hero does not use a fake statistic, testimonial or logo strip. It uses real app screens and plain product facts.
- Motion is one short page-load reveal. Tab changes and disclosures are user-triggered and respect reduced motion.
- The attachment `image-1.png` described in the handoff is not present in this workspace and its purpose is unknown, so it is not used.
- No em dash, en dash, emoji, sparkle icon, checkmark bullet, arrow link suffix, pricing tier or invented customer claim appears in the copy.

## Build notes

- Static HTML, CSS and a small amount of vanilla JavaScript. No motion library and no Radix primitives are needed for this scope.
- The working demo is the repository's real Vite app, built into `site/public/app` and embedded on `demo.html`.
- Screenshots were captured from the running app with its built-in demo trip loaded, then compressed to WebP. They are real screens, not mockups.
