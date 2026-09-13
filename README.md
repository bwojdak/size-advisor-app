# Size Advisor

A Shopify app that recommends the right clothing size to shoppers based on their body measurements — and helps merchants configure, verify, and monitor it from an admin panel.

Built solo, end to end: storefront widget, admin panel, sizing engine, AI integration, subscription billing, and analytics.

## The core idea

Most "size finder" apps either (a) trust an LLM to eyeball a size chart and guess a size, or (b) trust a rigid rule-of-thumb formula and ignore the merchant's real chart entirely. Both fail in visible, embarrassing ways.

Size Advisor splits the two responsibilities on purpose:

- **AI's job**: read a size chart (from text, a pasted table, or a photo) and turn it into structured numbers — chest, waist, hip, length, inseam, cut, fabric stretch. It never picks a size.
- **Deterministic code's job**: take those numbers plus the shopper's height/weight/build and *compute* the size — anthropometric formulas, ease tables per garment cut, brand model-reference anchoring, unit auto-detection (flat vs. full circumference), tie-breaks by inseam-to-height band, and several safety nets that catch physically impossible results before they reach a customer.

The result is explainable and testable in a way "ask the LLM" isn't: the same inputs always produce the same size, and every rule can be unit tested.

## What it does

- **Storefront widget** (theme app extension): a 2-step modal — height/weight/gender, then body type/fit preference — returns a recommended size with a visual fit slider ("tighter ↔ looser"), remembers the shopper's profile for next time, and can add the recommended size straight to cart.
- **Admin panel**: per-product size chart configuration (AI-assisted, merchant-verified), reusable "sizing systems" shared across many products, an automatic table-consistency checker (sweeps ~230 synthetic body profiles through the chart looking for "bigger body → smaller size" contradictions), a prompt tester, CSV import/export, and conversion/return analytics.
- **Subscription billing** via the Shopify Billing API, with plan-gated features (history depth, CSV export, custom CSS, bulk import, image-based chart reading, etc.).

## Engineering highlights

A few problems that turned out to be more interesting than they first looked:

- **Model-reference anchoring**: many listings say things like *"Model is 185cm, wearing size M"* — a real, brand-confirmed data point that's more trustworthy than a generic body formula. The engine anchors on it, but nudges the result for shoppers whose build diverges meaningfully from a typical model's (bounded to ±1 size, so it stays a correction, not a competing estimate).
- **Unit ambiguity**: size charts mix flat measurements ("pit-to-pit") and full circumference with no consistent convention. The engine detects which one it's looking at from the numbers themselves and normalizes automatically — with a second safety check to undo its own over-correction if it guesses wrong, without ever "fixing" a table it never touched (a subtle bug: a naive version of this check corrupted genuinely large plus-size-only charts).
- **Graceful degradation across chart shapes**: a chart with only a length column, only hip measurements, no chart at all, an elastic waistband with no recorded stretch data — every one of these used to fall back to a generic guess (or silently return nothing) instead of using the real data the merchant provided. A ~40-shape, ~5000-scenario synthetic test suite (see below) was built specifically to find these gaps systematically instead of one support ticket at a time.
- **Correct-but-wrong tie-breaks**: a fallback that picks "the biggest available size" for an out-of-range body picked whichever row happened to be typed in last by the merchant, rather than the one that actually fit best — same for a fit-preference tie-break that flipped inconsistently right at specific height thresholds.
- **Attribution accuracy in analytics**: revenue and return-rate metrics needed to be scoped to the actual recommended product, not the whole order — a customer buying two recommended items in one order was silently double-counting that order's revenue; a partial refund of an unrelated line item was inflating the wrong product's return rate.

## Testing approach

No formal test framework — instead, a handful of purpose-built TypeScript scripts run directly against the engine (`npx tsx`), each targeting a different failure mode:

- Hand-picked scenario suite (~36 cases) with known-correct expected sizes
- A security/edge-case validation suite (~160 assertions) covering prompt injection, malformed input, locale handling
- A chart-*shape* coverage sweep — ~40 realistic combinations of present/missing columns across garment categories, each run against 40 synthetic bodies
- A large-scale stress test for the model-anchoring logic specifically — 9 synthetic brands swept across height × weight × gender × build (~4,900 scenarios total), checking monotonicity in both height and weight

Every fix in this repo's history was verified against all of the above before being committed.

## Tech stack

- **App framework**: React Router v7 (Remix-style loaders/actions), TypeScript
- **UI**: Shopify Polaris, Shopify App Bridge
- **Storefront**: Shopify theme app extension (Online Store 2.0), vanilla JS
- **Database**: PostgreSQL via Prisma ORM (hosted on Railway)
- **AI**: OpenAI (gpt-4o-mini) or Google Gemini, provider-swappable
- **Billing**: Shopify Billing API (recurring subscriptions, plan-gated capabilities)
- **i18n**: Polish and English throughout admin and storefront

## Project structure

```
app/
  lib/size-advisor.server.ts   # the deterministic sizing engine (pure functions, no AI)
  routes/                      # admin panel pages + API/webhook resource routes
  components/                  # SizeGrid (merchant-facing chart editor), shared UI
extensions/size-advisor-embed/ # storefront theme app extension (the widget)
prisma/                        # schema + migrations (PostgreSQL)
scratchpad/                    # gitignored test scripts (sizing-eval, validation, coverage sweeps)
```

## Local development

Requires the [Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started).

```shell
npm install
shopify app dev
```

Copy `.env.example` to `.env` and fill in Shopify + AI provider credentials first. See comments inline for what each variable does and which ones matter before a production deploy (`BILLING_LIVE`, `SCOPES`).

## License

MIT
