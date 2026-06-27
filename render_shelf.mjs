#!/usr/bin/env node
// render_shelf.mjs
//
// The v1 frontend. Reads curated_shelf.json (the curator's editorial picks),
// resolves each entry against the live global catalog via lib/catalog.mjs, and
// emits a single self-contained static page: dist/index.html. No backend, no
// build framework — just a shoppable shelf where each curated note sits beside
// a live product card whose "Shop" button hands off to the merchant's checkout.
//
// Usage: node render_shelf.mjs            # -> dist/index.html
//
// Entries are pinned by productId (stable card + honest liveness via
// getProduct). A `query` entry is also accepted (resolved via search), but see
// the liveness caveat in the README.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ensureProfile, getProduct, search } from "./lib/catalog.mjs";

const SHELF_FILE = new URL("./curated_shelf.json", import.meta.url);
const OUT_DIR = "dist";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

function loadShelf() {
  if (!existsSync(SHELF_FILE)) {
    console.error("curated_shelf.json not found — nothing to render.");
    process.exit(1);
  }
  let data = JSON.parse(readFileSync(SHELF_FILE));
  if (!Array.isArray(data)) data = data.shelf ?? data.items ?? [];
  return data;
}

async function resolveEntry(entry) {
  if (entry.productId) {
    const { product, error } = await getProduct(entry.productId);
    return { entry, product, error };
  }
  if (entry.query) {
    const { products, error } = await search(entry.query);
    return { entry, product: products?.[0] ?? null, error };
  }
  return { entry, product: null, error: { message: "entry has no productId or query" } };
}

function card({ entry, product }) {
  const note = esc(entry.note);
  const tags = (entry.tags ?? [])
    .map((t) => `<span class="tag">${esc(t)}</span>`)
    .join("");

  const title = esc(product.title);
  const vendor = esc(product.vendor ?? "");
  const price = esc(product.price ?? "");
  const img = product.image ? esc(product.image) : "";
  const shopUrl = esc(product.checkoutUrl || product.url || "#");
  const oos = product.available === false;

  return `
    <article class="card${oos ? " oos" : ""}">
      <a class="media" href="${shopUrl}" target="_blank" rel="noopener">
        ${img ? `<img loading="lazy" src="${img}" alt="${title}">` : `<div class="noimg">no image</div>`}
        ${oos ? `<span class="badge">Sold out</span>` : ""}
      </a>
      <div class="body">
        <p class="note">${note}</p>
        <div class="tags">${tags}</div>
        <h2 class="title">${title}</h2>
        <p class="meta">${vendor ? `<span class="vendor">${vendor}</span>` : ""}${price ? `<span class="price">${price}</span>` : ""}</p>
        <a class="shop" href="${shopUrl}" target="_blank" rel="noopener">${oos ? "View" : "Shop"} &rarr;</a>
      </div>
    </article>`;
}

function page(cards, { broken }) {
  const brokenNote = broken.length
    ? `<p class="broken">${broken.length} curated ${broken.length === 1 ? "pick" : "picks"} could not be resolved and ${broken.length === 1 ? "is" : "are"} hidden: ${broken.map(esc).join(", ")}.</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Waldorf Catalog — a curated shelf</title>
<style>
  :root { --ink:#2b2620; --soft:#6b6354; --line:#e7e0d4; --bg:#faf6ef; --accent:#7d5a3c; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font:16px/1.55 ui-serif, Georgia, "Times New Roman", serif; }
  header { max-width:1080px; margin:0 auto; padding:3.5rem 1.5rem 1.5rem; }
  header h1 { font-size:2.1rem; margin:0 0 .4rem; letter-spacing:-.01em; }
  header p { margin:0; color:var(--soft); max-width:46ch; }
  .broken { max-width:1080px; margin:0 auto; padding:0 1.5rem; color:#9a5b3b; font-style:italic; }
  main { max-width:1080px; margin:0 auto; padding:1.5rem;
    display:grid; gap:1.75rem; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; overflow:hidden;
    display:flex; flex-direction:column; transition:box-shadow .2s, transform .2s; }
  .card:hover { box-shadow:0 10px 30px rgba(60,45,25,.10); transform:translateY(-2px); }
  .card.oos { opacity:.72; }
  .media { position:relative; display:block; aspect-ratio:1/1; background:#f1ebe0; }
  .media img { width:100%; height:100%; object-fit:cover; display:block; }
  .noimg { display:grid; place-items:center; height:100%; color:var(--soft); font-style:italic; }
  .badge { position:absolute; top:.6rem; left:.6rem; background:#3b332a; color:#fff;
    font-family:ui-sans-serif,system-ui,sans-serif; font-size:.7rem; letter-spacing:.04em;
    text-transform:uppercase; padding:.25rem .5rem; border-radius:6px; }
  .body { padding:1.1rem 1.15rem 1.25rem; display:flex; flex-direction:column; gap:.55rem; flex:1; }
  .note { margin:0; color:var(--ink); }
  .tags { display:flex; flex-wrap:wrap; gap:.35rem; }
  .tag { font-family:ui-sans-serif,system-ui,sans-serif; font-size:.7rem; color:var(--accent);
    background:#f3ece1; border:1px solid var(--line); padding:.12rem .5rem; border-radius:999px; }
  .title { font-size:1.02rem; margin:.3rem 0 0; line-height:1.3; }
  .meta { margin:0; display:flex; justify-content:space-between; align-items:baseline; gap:.5rem;
    font-family:ui-sans-serif,system-ui,sans-serif; font-size:.85rem; color:var(--soft); }
  .price { font-weight:600; color:var(--ink); }
  .shop { margin-top:auto; align-self:flex-start; font-family:ui-sans-serif,system-ui,sans-serif;
    font-size:.85rem; font-weight:600; color:var(--accent); text-decoration:none; padding-top:.4rem; }
  .shop:hover { text-decoration:underline; }
  footer { max-width:1080px; margin:0 auto; padding:2rem 1.5rem 4rem; color:var(--soft);
    font-family:ui-sans-serif,system-ui,sans-serif; font-size:.8rem; }
</style>
</head>
<body>
  <header>
    <h1>A curated shelf</h1>
    <p>Waldorf-inspired wooden toys &amp; craft supplies, chosen by hand. No promoted placements, no affiliate — just the picks and why they earn shelf space.</p>
  </header>
  ${brokenNote}
  <main>
    ${cards.join("\n")}
  </main>
  <footer>
    Live prices &amp; availability from the Shopify global catalog (UCP). Each &ldquo;Shop&rdquo; link goes to the merchant&rsquo;s own checkout.
  </footer>
</body>
</html>
`;
}

async function run() {
  const shelf = loadShelf();
  console.log(`Rendering ${shelf.length} curated entries`);
  await ensureProfile();

  const resolved = [];
  for (const entry of shelf) {
    const ref = entry.productId || entry.query || "(invalid)";
    process.stdout.write(`  ${ref} ... `);
    const r = await resolveEntry(entry);
    if (!r.product) {
      console.log("UNRESOLVED — hidden");
    } else {
      console.log(`${r.product.title}${r.product.available === false ? " (sold out)" : ""}`);
    }
    resolved.push(r);
  }

  const live = resolved.filter((r) => r.product);
  const broken = resolved.filter((r) => !r.product).map((r) => r.entry.productId || r.entry.query || "(invalid)");
  const cards = live.map(card);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/index.html`, page(cards, { broken }));
  console.log(`\nWrote ${OUT_DIR}/index.html — ${live.length} cards${broken.length ? `, ${broken.length} hidden` : ""}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
