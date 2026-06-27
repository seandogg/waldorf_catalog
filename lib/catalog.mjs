// lib/catalog.mjs
//
// Thin wrapper around Shopify's official Universal Commerce Protocol CLI
// (@shopify/ucp-cli, binary `ucp`). We wrap the CLI rather than reverse-
// engineer the raw HTTP API because the CLI owns protocol negotiation,
// discovery (/.well-known/ucp), and schema validation, and is guaranteed to
// track the spec. The same binary also runs as an MCP server (`ucp --mcp`)
// for direct agent integration in v1.
//
// Auth model (verified against the ucp-cli docs, Spring '26):
//   - Global-catalog SEARCH is unauthenticated. No keys needed for discovery.
//   - CART / CHECKOUT require a Catalog JWT from the Shopify Developer
//     Dashboard, passed via `--header "Authorization: Bearer <JWT>"`.
//
// Default endpoint: https://catalog.shopify.com (the global catalog).

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UCP_BIN = join(__dirname, "..", "node_modules", ".bin", "ucp");

if (!existsSync(UCP_BIN)) {
  throw new Error(
    `ucp CLI not found at ${UCP_BIN}. Run: npm install @shopify/ucp-cli`
  );
}

/**
 * Run a `ucp` subcommand and return parsed JSON stdout.
 * @param {string[]} args - CLI args after the binary name.
 * @returns {Promise<{ok: boolean, json: any, raw: string, code: number}>}
 */
export function ucp(args) {
  return new Promise((resolve) => {
    const child = spawn(UCP_BIN, args, {
      // Node's built-in fetch (undici) only honours HTTPS_PROXY when
      // NODE_USE_ENV_PROXY=1. Harmless when no proxy is set (local runs).
      env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      let json = null;
      try {
        json = JSON.parse(out);
      } catch {
        /* non-JSON output (help text, etc.) */
      }
      resolve({ ok: code === 0, json, raw: out || err, code: code ?? -1 });
    });
    child.on("error", (e) =>
      resolve({ ok: false, json: null, raw: e.message, code: -1 })
    );
  });
}

/**
 * Ensure a local UCP agent profile exists (required before any catalog op).
 * Idempotent: a no-op if a profile is already present.
 */
export async function ensureProfile(name = "agent") {
  const res = await ucp(["profile", "init", "--name", name]);
  // init returns {created:true|false}; an already-existing profile is fine.
  return res.json ?? { ok: res.ok, raw: res.raw };
}

/**
 * Search the global Shopify catalog for a free-text query.
 * @param {string} query
 * @param {object} [opts]
 * @param {string} [opts.business] - target a single merchant URL (optional).
 * @param {string} [opts.jwt] - Catalog JWT (only needed for checkout, not search).
 * @returns {Promise<{products: object[], rawEnvelope: any, error: any}>}
 */
export async function search(query, opts = {}) {
  const args = ["catalog", "search", "--set", `/query=${query}`, "--format", "json"];
  if (opts.business) args.push("--business", opts.business);
  if (opts.jwt) args.push("--header", `Authorization: Bearer ${opts.jwt}`);

  const res = await ucp(args);
  if (!res.ok || !res.json) {
    return { products: [], rawEnvelope: res.json ?? res.raw, error: res.json ?? res.raw };
  }
  if (res.json.code && res.json.message) {
    // UCP error envelope, e.g. PROFILE_FETCH_FAILED.
    return { products: [], rawEnvelope: res.json, error: res.json };
  }
  return { products: extractProducts(res.json), rawEnvelope: res.json, error: null };
}

/**
 * Fetch full detail for a single product by id (wraps `ucp catalog get_product`).
 * Used by the shelf renderer and the coverage-drift monitor to check that a
 * curated/pinned product still resolves and is in stock.
 * @param {string} id - product id, e.g. "gid://shopify/p/...".
 * @param {object} [opts]
 * @param {string} [opts.business]
 * @param {string} [opts.jwt]
 * @returns {Promise<{product: object|null, rawEnvelope: any, error: any}>}
 */
export async function getProduct(id, opts = {}) {
  const args = ["catalog", "get_product", id, "--format", "json"];
  if (opts.business) args.push("--business", opts.business);
  if (opts.jwt) args.push("--header", `Authorization: Bearer ${opts.jwt}`);

  const res = await ucp(args);
  if (!res.ok || !res.json) {
    return { product: null, rawEnvelope: res.json ?? res.raw, error: res.json ?? res.raw };
  }
  if (res.json.code && res.json.message) {
    return { product: null, rawEnvelope: res.json, error: res.json };
  }
  const p = res.json?.result?.product;
  return { product: p ? normalizeProduct(p) : null, rawEnvelope: res.json, error: null };
}

/**
 * Extract products from a search envelope.
 *
 * Concrete UCP schema (verified against live catalog.shopify.com output,
 * protocol 2026-04-08): products live at `envelope.result.products`. Each
 * product carries `title`, `price_range`, `media[]`, and `variants[]`; the
 * merchant ("vendor") and the shoppable URLs live on the first variant's
 * `seller`/`url`/`checkout_url`.
 */
export function extractProducts(envelope) {
  const products = envelope?.result?.products;
  return Array.isArray(products) ? products.map(normalizeProduct) : [];
}

/** Format a {min,max} price_range into a human string, e.g. "$22.00" or "$22.00–$110.00". */
function formatPrice(range) {
  if (!range || !range.min) return undefined;
  const money = (m) => {
    if (!m || m.amount == null) return null;
    const value = m.amount / 100; // amounts are in minor units (cents)
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: m.currency || "USD",
      }).format(value);
    } catch {
      return `${value} ${m.currency || ""}`.trim();
    }
  };
  const lo = money(range.min);
  const hi = money(range.max);
  return lo && hi && lo !== hi ? `${lo}–${hi}` : lo ?? hi ?? undefined;
}

function normalizeProduct(p) {
  const variant = Array.isArray(p.variants) ? p.variants[0] : undefined;
  return {
    id: p.id,
    title: p.title,
    vendor: variant?.seller?.name, // the merchant offering this product
    price: formatPrice(p.price_range),
    available: variant?.availability?.available ?? undefined, // in stock?
    image: Array.isArray(p.media) ? p.media[0]?.url : undefined,
    url: variant?.url, // merchant product page (with UCP session id)
    checkoutUrl: variant?.checkout_url, // direct add-to-cart for v1 "Shop" links
    raw: p,
  };
}
