#!/usr/bin/env node
// coverage_test.mjs
//
// Measures how deep Shopify's GLOBAL catalog goes for a list of Waldorf/
// homeschool toy & craft makers. For each maker it runs an unauthenticated
// global-catalog search and buckets coverage:
//
//   strong  - a returned product's vendor/title clearly matches the maker
//   present - results came back, but no clear name match (worth eyeballing)
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

function classify(maker, products) {
  if (!products.length) return "none";
  const needle = norm(maker).replace(/\s+toys?$/, ""); // "Bumbu Toys" -> "bumbu"
  const tokens = needle.split(/\s+/).filter((t) => t.length > 2);
  const hit = products.some((p) => {
    const hay = norm(p.vendor) + " " + norm(p.title);
    return tokens.length
      ? tokens.every((t) => hay.includes(t)) || hay.includes(needle)
      : hay.includes(needle);
  });
  return hit ? "strong" : "present";
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

    const bucket = classify(maker, products);
    console.log(`${products.length} results -> ${bucket}`);
    rows.push({
      maker,
      bucket,
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

  lines.push("## Summary table\n");
  lines.push("| Maker | Coverage | Results | Top match (vendor — title) |");
  lines.push("|---|---|---:|---|");
  for (const r of rows) {
    const t = r.top?.[0];
    const top = t ? `${t.vendor ?? "?"} — ${t.title ?? "?"}` : "—";
    lines.push(`| ${r.maker} | ${r.bucket} | ${r.count} | ${top} |`);
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
