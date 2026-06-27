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
        editorial layer                   shelf renderer (v1, next)
   curated_shelf.json:                 reads curated_shelf.json, calls
   [{ query|productId,                 search()/get_product per item,
      note: "curator voice",           renders a shoppable shelf with
      tags: [...] }]                    the editorial note beside each card
```

Three small pieces, in build order:

1. **`lib/catalog.mjs`** — ✅ done. `search(query)` and `ensureProfile()` over the
   official CLI. Add `getProduct(id)` (wraps `ucp catalog get_product`) when the
   shelf needs full detail.
2. **Editorial layer** — a plain `curated_shelf.json`: each entry pairs a catalog
   reference (a search query the curator trusts, or a pinned product id) with an
   editorial `note` and `tags`. This file *is* the product — version it, no DB needed.
3. **Shelf renderer** — resolves each entry via `lib/catalog.mjs`, emits a static
   shoppable shelf (cards: image, title, vendor, price, "Shop" link → the merchant's
   UCP checkout) with the curator's note rendered alongside. Static HTML/SSR keeps it
   lean; no backend required for read-only discovery.

For checkout later: obtain a Catalog JWT from the Dev Dashboard and pass it through
`search(query, { jwt })` → `cart`/`checkout` ops. Or expose the whole thing to an AI
agent by running `ucp --mcp` and pointing the agent at it.

## Files

| File | Purpose |
|---|---|
| `lib/catalog.mjs` | Search wrapper over `@shopify/ucp-cli` (auth model documented inline) |
| `coverage_test.mjs` | Maker coverage test → report + raw dump |
| `coverage_targets.json` | Editable maker list (books deferred to `books_v2`) |
| `package.json` | `npm run coverage` |
