#!/usr/bin/env node
// coverage_test.mjs
//
// Measures how deep Shopify's GLOBAL catalog goes for a list of Waldorf/
// homeschool toy & craft makers. For each maker it runs an unauthenticated
// global-catalog search and buckets coverage:
//
//   strong  - the maker surfaces in >=2 product TITLES (the brand appears in
//             catalog *content*, not merely in a store's name)
//   present - results came back, but the maker matches in <2 titles (only a
//             merchant/seller name, or a single/coincidental hit). May be the
//             maker's own store (real) or a name collision (e.g. an unrelated
//             "Auris" audio brand). Eyeball via the title/vendor hit counts.
//   none    - zero results
//
// Output:
//   coverage_report.md   - human-readable summary + per-maker detail
//   coverage_raw.json    - full raw envelopes for every query (audit trail)
//
// Usage:
//   node coverage_test.mjs                 # uses coverage_targets.json
//   node coverage_test.mjs "Grimm's" "Grapat"   # ad-hoc makers
//
// No API keys required: global-catalog search is unauthenticated.

import { readFileSync, writeFileSync } from "node:fs";
import { ensureProfile, search } from "./lib/catalog.mjs";

const TOP_N = 5; // sample matches to record per query

function loadMakers() {
  if (process.argv.length > 2) return process.argv.slice(2);
  const cfg = JSON.parse(readFileSync(new URL("./coverage_targets.json", import.meta.url)));
  return cfg.makers ?? [];
}

const norm = (s) => (s ?? "").toString().toLowerCase().replace(/['']/g, "").trim();

// Count how many products match the maker in a single field (title or vendor).
function matchCount(maker, products, field) {
  const needle = norm(maker).replace(/\s+toys?$/, ""); // "Bumbu Toys" -> "bumbu"
  const tokens = needle.split(/\s+/).filter((t) => t.length > 2);
  const hit = (hay) =>
    tokens.length
      ? tokens.every((t) => hay.includes(t)) || hay.includes(needle)
      : hay.includes(needle);
  return products.filter((p) => hit(norm(field(p)))).length;
}

function classify(maker, products) {
  if (!products.length) return { bucket: "none", titleHits: 0, vendorHits: 0 };
  const titleHits = matchCount(maker, products, (p) => p.title);
  const vendorHits = matchCount(maker, products, (p) => p.vendor);
  // "strong" requires the brand in >=2 product TITLES. A merchant-name match,
  // or a lone title hit, is "present" — it may be the maker's own store (real,
  // e.g. Sarah's Silks) or a name collision (false, e.g. an "Auris" audio
  // brand). The hit counts in the report let a curator resolve it at a glance.
  const bucket = titleHits >= 2 ? "strong" : "present";
  return { bucket, titleHits, vendorHits };
}

async function run() {
  const makers = loadMakers();
  console.log(`Coverage test: ${makers.length} makers against the global catalog\n`);

  await ensureProfile();

  const rows = [];
  const rawDump = {};

  for (const maker of makers) {
    process.stdout.write(`  searching "${maker}" ... `);
    const { products, rawEnvelope, error } = await search(maker);
    rawDump[maker] = error ? { error: rawEnvelope } : rawEnvelope;

    if (error) {
      const code = error?.code ?? "ERROR";
      console.log(`✗ ${code}`);
      rows.push({ maker, bucket: "error", count: 0, top: [], code });
      continue;
    }

    const { bucket, titleHits, vendorHits } = classify(maker, products);
    console.log(
      `${products.length} results -> ${bucket} (title:${titleHits} vendor:${vendorHits})`
    );
    rows.push({
      maker,
      bucket,
      titleHits,
      vendorHits,
      count: products.length,
      top: products.slice(0, TOP_N).map((p) => ({
        title: p.title,
        vendor: p.vendor,
        price: p.price,
        url: p.url,
      })),
    });
  }

  writeFileSync(new URL("./coverage_raw.json", import.meta.url), JSON.stringify(rawDump, null, 2));
  writeFileSync(new URL("./coverage_report.md", import.meta.url), renderReport(rows));

  const tally = (b) => rows.filter((r) => r.bucket === b).length;
  console.log(
    `\nDone. strong=${tally("strong")} present=${tally("present")} ` +
      `none=${tally("none")} error=${tally("error")}`
  );
  console.log("Wrote coverage_report.md and coverage_raw.json");
}

function renderReport(rows) {
  const tally = (b) => rows.filter((r) => r.bucket === b).length;
  const total = rows.length;
  const strong = tally("strong");
  const pct = total ? Math.round((strong / total) * 100) : 0;
  const errored = tally("error") > 0;

  const lines = [];
  lines.push("# Waldorf Catalog Coverage — Toys/Makers (v1)\n");
  lines.push(
    `**${strong}/${total} makers** have strong global-catalog coverage (${pct}%). ` +
      `present=${tally("present")}, none=${tally("none")}, error=${tally("error")}.\n`
  );
  if (errored) {
    lines.push(
      "> ⚠️ Some queries errored (likely `PROFILE_FETCH_FAILED` / egress block " +
        "if run where catalog.shopify.com is firewalled). See coverage_raw.json.\n"
    );
  }
  lines.push("## Verdict\n");
  lines.push(
    pct >= 60
      ? `Toys-first is well-supported — ${pct}% of seeded makers surface directly. Proceed to v1 shelf.\n`
      : `Coverage is thin (${pct}%). Review misses below before committing to toys-first depth.\n`
  );

  const present = rows.filter((r) => r.bucket === "present");
  if (present.length) {
    lines.push("## Eyeball these (present)\n");
    lines.push(
      "Results returned but the maker appears in <2 product titles — either the " +
        "maker's own store (real) or a name collision (false). Check each:\n"
    );
    for (const r of present) {
      const t = r.top?.[0];
      const why =
        r.titleHits === 0
          ? `merchant-name match only (vendor hits: ${r.vendorHits})`
          : `only ${r.titleHits} title hit`;
      lines.push(`- **${r.maker}** — ${why}. Top: ${t?.vendor ?? "?"} — ${t?.title ?? "?"}`);
    }
    lines.push("");
  }

  lines.push("## Summary table\n");
  lines.push("| Maker | Coverage | Results | Title/Vendor hits | Top match (vendor — title) |");
  lines.push("|---|---|---:|---:|---|");
  for (const r of rows) {
    const t = r.top?.[0];
    const top = t ? `${t.vendor ?? "?"} — ${t.title ?? "?"}` : "—";
    const hits = `${r.titleHits ?? 0}/${r.vendorHits ?? 0}`;
    lines.push(`| ${r.maker} | ${r.bucket} | ${r.count} | ${hits} | ${top} |`);
  }
  lines.push("");

  lines.push("## Per-maker detail\n");
  for (const r of rows) {
    lines.push(`### ${r.maker} — ${r.bucket} (${r.count} results)\n`);
    if (!r.top?.length) {
      lines.push("_no products returned_\n");
      continue;
    }
    for (const p of r.top) {
      const price = p.price != null ? ` — ${p.price}` : "";
      const url = p.url ? ` <${p.url}>` : "";
      lines.push(`- **${p.title ?? "?"}** (${p.vendor ?? "?"})${price}${url}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
