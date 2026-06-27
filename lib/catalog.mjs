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
 * Defensive product extraction.
 *
 * The exact search response schema is documented at
 * https://shopify.dev/docs/api/catalog-api/search (blocked from this sandbox
 * by egress policy), so rather than hardcode a path we recursively find the
 * largest array of objects that look like products, then normalize the fields
 * we care about. Once you see real output, this can be simplified to the
 * concrete path (likely `result.products`).
 */
export function extractProducts(envelope) {
  let best = [];
  const looksLikeProduct = (o) =>
    o && typeof o === "object" &&
    (o.title || o.name || o.productTitle || o.product_title);

  const walk = (node) => {
    if (Array.isArray(node)) {
      if (node.length && node.every(looksLikeProduct) && node.length > best.length) {
        best = node;
      }
      node.forEach(walk);
    } else if (node && typeof node === "object") {
      Object.values(node).forEach(walk);
    }
  };
  walk(envelope);
  return best.map(normalizeProduct);
}

function pick(o, keys) {
  for (const k of keys) if (o[k] != null) return o[k];
  return undefined;
}

function normalizeProduct(p) {
  const price = pick(p, ["price", "amount", "priceRange", "price_range", "minPrice"]);
  return {
    id: pick(p, ["id", "productId", "gid", "handle"]),
    title: pick(p, ["title", "name", "productTitle", "product_title"]),
    vendor: pick(p, ["vendor", "brand", "merchant", "shop", "shopName", "storeName", "businessName"]),
    price: typeof price === "object" ? JSON.stringify(price) : price,
    url: pick(p, ["url", "onlineStoreUrl", "online_store_url", "link", "productUrl"]),
    raw: p,
  };
}
