#!/usr/bin/env node
// snapshot.mjs
//
// Archive the latest coverage outputs into coverage_history/ under a dated name,
// so the drift monitor builds a persisted time series. Run AFTER `npm run
// coverage`. Idempotent within a day: re-running overwrites the same dated file.
//
// Usage: node snapshot.mjs            # date = today (UTC)
//        node snapshot.mjs 2026-06-27 # explicit date (for backfill/tests)
//
// Produces, for <date>:
//   coverage_history/coverage_<date>.summary.json   (the unit coverage_diff reads)
//   coverage_history/coverage_<date>.md             (human report)
//   coverage_history/coverage_<date>.raw.json       (full audit envelopes)

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const HISTORY_DIR = "coverage_history";
const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`bad date "${date}" — expected YYYY-MM-DD`);
  process.exit(1);
}

const COPIES = [
  ["coverage_summary.json", `coverage_${date}.summary.json`],
  ["coverage_report.md", `coverage_${date}.md`],
  ["coverage_raw.json", `coverage_${date}.raw.json`],
];

mkdirSync(HISTORY_DIR, { recursive: true });
let n = 0;
for (const [src, dest] of COPIES) {
  if (!existsSync(src)) {
    console.error(`missing ${src} — run \`npm run coverage\` first`);
    process.exit(1);
  }
  copyFileSync(src, join(HISTORY_DIR, dest));
  n++;
}
console.log(`Archived ${n} files to ${HISTORY_DIR}/ for ${date}`);
