# Design Document — VaultStream

**Version 3.0 · "Luminous" · June 2026**

VaultStream's interface was re-imagined from a dark, analyst-only console into a **pastel,
private-bank aesthetic** — calm, editorial and luxurious, while keeping the dense, live data
legibility a fraud workspace demands. The goal: software that looks crafted, not generated.

---

## 1. Design language

**Pastel + luxe.** A warm ivory/lilac canvas, deep-aubergine ink, and a restrained set of
jewel-pastel accents (soft violet, blush rose, champagne gold, mint, sky). Depth comes from
layered soft shadows and glassmorphism rather than hard borders. Signature gradients
(violet→rose "aurora", champagne gold) anchor hero moments and CTAs.

**Editorial typography.** An elegant display serif (*Fraunces*) for headings paired with a
clean grotesque (*Inter*) for UI and a tabular monospace (*Geist Mono*) for all numerics —
so live values never jitter as they update. Fonts are self-hosted via `next/font` (zero
external requests, no layout shift).

**Functional color semantics** are preserved but softened into the palette:
`safe` (sage), `suspicious` (amber/peach), `fraud` (muted rose-red) — luxe, never neon-alarming.

## 2. Tokens

Defined once in `frontend/src/app/globals.css` as Tailwind v4 `@theme` tokens + CSS variables:

| Group | Examples |
|---|---|
| Canvas / surface | `--color-canvas`, `--color-surface`, `--color-veil` (glass) |
| Ink | `--color-ink`, `--color-ink-soft`, `--color-ink-faint` |
| Accents | `--color-violet`, `--color-rose`, `--color-gold`, `--color-mint`, `--color-sky` |
| Semantics | `--color-safe`, `--color-warn`, `--color-alert` (+ `-soft` tints) |
| Gradients | `--grad-aurora`, `--grad-violet-rose`, `--grad-gold`, `--grad-mist` |
| Elevation | `--shadow-sm/md/lg`, `--shadow-glow`; radii `--radius-xs … -pill` |

Reusable classes: `.glass`, `.lux-card`, `.btn`/`.btn-primary|ghost|gold`, `.badge-*`,
`.eyebrow`, `.text-gradient`, `.section`, `.aurora-blob`.

## 3. Motion

Powered by **Framer Motion**. Principles: physical easing (`cubic-bezier(0.16, 1, 0.3, 1)`),
scroll-reveal for editorial sections, immediate reveal for above-the-fold hero text, and a
single hard "flash" only for new FRAUD alerts. Respects `prefers-reduced-motion`.

Bespoke motion components (`frontend/src/components/fx/`), native re-creations of common
premium effects — no third-party page-builder runtime, so production builds stay deterministic:

- `CircleExpandButton` — radial fill-expand CTA
- `TextIndenter` — staggered line reveal
- `ArcText` — text on a rotating arc seal
- `ImageScroller` — infinite drag-scrolling rail
- `ProductSlideshow` — crossfading capability carousel

## 4. Surfaces

- **Landing** — sculptural hero (arc seal + live threat ticker), trust marquee, metrics band,
  five-stage pipeline, capability slideshow, feature scroller, FAQ, aurora CTA.
- **Auth** — split layout: form + aurora brand panel; quick demo logins.
- **Workspace** — three glass panels (live threats · feature correlation · deep-dive) with a
  live KPI footer. Deep-dive shows score, metadata, risk-factor strip, entity-relationship
  graph, and a SHAP contribution waterfall.
- **Model Lab** — algorithm picker, hyperparameter sliders, live training, metric gauges, ROC
  curve, confusion matrix, decision-threshold tuner, feature importance, run registry.
- **Admin** — RBAC user table with inline role assignment.

## 5. Accessibility

Light theme with strong ink-on-canvas contrast; risk states carry both color and label;
keyboard-focusable controls; reduced-motion fallback; numerics use `tabular-nums`.
