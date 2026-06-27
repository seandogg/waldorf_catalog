# Waldorf Catalog — curated homeschool discovery on Shopify's Catalog API

A content-driven discovery channel where an in-house curator surfaces Waldorf-inspired
wooden toys and craft supplies (and, in **v2**, children's books). Monetization is a
non-goal — no promoted placements, no affiliate. Curation and voice are the product.

Built on Shopify's **Catalog API**, the discovery layer of the **Universal Commerce
Protocol (UCP)** — the global, cross-merchant agentic-commerce catalog (not the
B2B/Markets Catalogs in Admin GraphQL).

## Decisions locked

- **v1 = toys-first.** Books deferred to v2. The coverage test therefore targets
  Waldorf toy/craft **makers**, not book titles.
- **No keys for v1 discovery.** Global-catalog *search* is unauthenticated. A Catalog
  JWT (free, from the Dev Dashboard) is only needed later for **cart/checkout**.

## What's verified (Spring '26)

| Fact | Source |
|---|---|
| Catalog API is self-serve for every developer | [Spring '26 Edition (dev)](https://www.shopify.com/news/spring-26-edition-dev) |
| It's UCP's discovery layer over millions of merchants | [About Catalogs](https://shopify.dev/docs/agents/catalog) |
| Global vs Storefront catalog distinction | [Global Catalog MCP](https://shopify.dev/docs/agents/catalog/global-catalog) |
| Search unauthenticated; checkout needs Catalog JWT | [Shopify/ucp-cli](https://github.com/Shopify/ucp-cli) |
| Search endpoint schema | [Catalog API: Search](https://shopify.dev/docs/api/catalog-api/search) |

Default endpoint: `https://catalog.shopify.com`. Official tooling: `@shopify/ucp-cli`
(npm, MIT, binary `ucp`) — also runs as an MCP server (`ucp --mcp`).

## Setup

```bash
npm install                 # installs @shopify/ucp-cli
npx ucp profile init --name agent   # one-time local agent profile (auto-done by the script too)
```

Node ≥ 22 required (the CLI needs it).

## Run the coverage test

```bash
npm run coverage            # uses coverage_targets.json
# or ad-hoc:
node coverage_test.mjs "Grimm's" "Grapat"
```

Outputs:
- `coverage_report.md` — verdict, summary table, per-maker top matches
- `coverage_raw.json` — full raw response envelopes (audit trail)

Edit `coverage_targets.json` to swap in your curator's real maker shortlist.

### ⚠️ Egress note (Claude Code on the web)

This project was scaffolded in a Claude Code web session whose network policy
**blocks `catalog.shopify.com`** (and `shopify.dev`) — confirmed via the egress
proxy (403 `connect_rejected`). The harness is verified working but returns
`PROFILE_FETCH_FAILED` for every query there. To get real numbers, either:

1. **Run it locally** (no egress limits) — `npm install && npm run coverage`, or
2. **Allow the domain** in the web environment's network policy, then re-run in-session.
   See <https://code.claude.com/docs/en/claude-code-on-the-web>.

## v1 architecture sketch (lean, toys-first)

```
coverage_targets.json ──▶ coverage_test.mjs ──▶ coverage_report.md   (you are here)
                                │
                                ▼
                         lib/catalog.mjs              ← search wrapper (DONE)
                         search() / ensureProfile()     wraps `ucp catalog search`
                                │
                ┌───────────────┴───────────────┐
                ▼                                ▼
        editorial layer                   shelf renderer (DONE)
   curated_shelf.json:                 render_shelf.mjs reads curated_shelf.json,
   [{ productId|query,                 calls getProduct()/search() per entry,
      note: "curator voice",           emits dist/index.html — a static shelf
      tags: [...] }]                    with each note beside a live product card
```

Three small pieces, all built:

1. **`lib/catalog.mjs`** — ✅ done. `search(query)`, `getProduct(id)`, and
   `ensureProfile()` over the official CLI.
2. **Editorial layer** — ✅ a plain `curated_shelf.json`: each entry pairs a catalog
   reference (a pinned `productId`, recommended — or a `query`) with an editorial
   `note` and `tags`. This file *is* the product — version it, no DB needed.
3. **Shelf renderer** — ✅ `render_shelf.mjs` resolves each entry via
   `lib/catalog.mjs` and emits a static shoppable shelf to `dist/index.html`
   (cards: image, editorial note, tags, title, vendor, price, "Shop" link → the
   merchant's UCP checkout). Sold-out items are badged; unresolved picks are
   hidden and reported. No backend — host the folder anywhere (e.g. GitHub Pages).

```bash
npm run render      # curated_shelf.json -> dist/index.html
```

For checkout later: obtain a Catalog JWT from the Dev Dashboard and pass it through
`search(query, { jwt })` → `cart`/`checkout` ops. Or expose the whole thing to an AI
agent by running `ucp --mcp` and pointing the agent at it.

## Coverage-drift monitor

The catalog is live and changes under us: merchants come and go, products sell
out, a maker that surfaced across five stores last month may surface in two
today. The monitor turns the one-shot coverage test into a tracked time series.

```bash
npm run monitor      # = coverage + snapshot + diff (the whole loop in one)
# or step by step:
npm run coverage     # writes coverage_summary.json (machine-readable buckets)
npm run snapshot     # archives it to coverage_history/coverage_<date>.*
npm run diff         # diffs the two most recent snapshots → stable JSON
```

- **`coverage_summary.json`** is the stable unit the monitor diffs: per-maker
  `{bucket, titleHits, vendorHits, count}` plus curated-shelf liveness.
- **`coverage_history/`** (tracked) accumulates dated snapshots — the time series.
  Raw envelopes are written there too but git-ignored (768K each; audit-only).
- **`coverage_diff.mjs`** is **egress-independent** — it only compares two files,
  so it's deterministic. It reports makers that moved buckets
  (`downgraded`/`upgraded`/`disappeared`/`appeared`) and curated cards that
  `broke`/`recovered`/`newlyBroken`. `changed: true` iff anything moved.

Intended for an unattended `/loop` (daily while seeding, weekly once stable):
run `npm run monitor`, commit the new snapshot, and ping a human only when
`changed` is true. It never mutates app code or `coverage_targets.json`.

**Curated liveness caveat:** global-catalog *search* is fuzzy and almost always
returns *something*, so a `query`-based curated card rarely reads "dead." For
real dead-card / out-of-stock detection, pin curated entries by **`productId`**
(resolved via `getProduct`), which 404s or reports `available:false` honestly.

## Files

| File | Purpose |
|---|---|
| `lib/catalog.mjs` | Search wrapper over `@shopify/ucp-cli`: `search()`, `getProduct()`, `ensureProfile()` (auth model documented inline) |
| `coverage_test.mjs` | Maker coverage test → report + raw dump + machine-readable `coverage_summary.json` (resolves `curated_shelf.json` liveness if present) |
| `coverage_diff.mjs` | Egress-independent snapshot comparator → stable drift JSON |
| `snapshot.mjs` | Archives the latest outputs into `coverage_history/` under a dated name |
| `curated_shelf.json` | The product itself: curator's pinned picks + editorial notes/tags |
| `render_shelf.mjs` | Renders `curated_shelf.json` → `dist/index.html` (the v1 frontend) |
| `coverage_targets.json` | Editable maker list (books deferred to `books_v2`) |
| `coverage_history/` | Tracked time series of dated snapshots |
| `package.json` | `npm run coverage` / `snapshot` / `diff` / `monitor` / `render` |
