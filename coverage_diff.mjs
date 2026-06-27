#!/usr/bin/env node
// coverage_diff.mjs
//
// Egress-INDEPENDENT comparator for the coverage-drift monitor. It reads two
// `coverage_summary.json` snapshots (produced by coverage_test.mjs) and prints,
// as stable JSON, how maker buckets and curated-shelf liveness moved between
// them. No network calls — it only diffs two files, so it's fast and
// deterministic and safe to run anywhere.
//
// Usage:
//   node coverage_diff.mjs <old_summary.json> <new_summary.json>
//   node coverage_diff.mjs                # auto: two most recent in coverage_history/
//   node coverage_diff.mjs coverage_history   # auto from a given dir
//
// Output: a JSON object on stdout. `changed` is true iff any maker moved
// buckets / (dis)appeared, or any curated item broke or recovered. Exit code is
// 0 on success (inspect `changed`), 1 on usage/IO error.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const HISTORY_DIR = "coverage_history";
const RANK = { none: 0, error: 0, present: 1, strong: 2 }; // for up/down direction

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function readSummary(path) {
  if (!existsSync(path)) fail(`snapshot not found: ${path}`);
  try {
    return { file: path, ...JSON.parse(readFileSync(path, "utf8")) };
  } catch (e) {
    return fail(`cannot parse ${path}: ${e.message}`);
  }
}

// Resolve which two snapshots to diff.
function resolveInputs(argv) {
  const args = argv.slice(2);
  if (args.length >= 2) return [readSummary(args[0]), readSummary(args[1])];

  const dir = args[0] && !args[0].endsWith(".json") ? args[0] : HISTORY_DIR;
  if (!existsSync(dir)) fail(`no snapshots given and ${dir}/ not found`);
  const snaps = readdirSync(dir)
    .filter((f) => f.endsWith(".summary.json"))
    .sort(); // coverage_YYYY-MM-DD.summary.json sorts chronologically
  if (snaps.length < 2) {
    // Baseline: nothing to compare against yet.
    console.log(JSON.stringify({ changed: false, note: `only ${snaps.length} snapshot(s) in ${dir}/ — baseline, nothing to diff` }, null, 2));
    process.exit(0);
  }
  return [readSummary(join(dir, snaps.at(-2))), readSummary(join(dir, snaps.at(-1)))];
}

function indexBy(arr, key) {
  const m = new Map();
  for (const x of arr ?? []) m.set(x[key], x);
  return m;
}

function diffMakers(oldS, newS) {
  const o = indexBy(oldS.makers, "maker");
  const n = indexBy(newS.makers, "maker");
  const downgraded = [], upgraded = [], disappeared = [], appeared = [];

  for (const [maker, ov] of o) {
    const nv = n.get(maker);
    if (!nv) { disappeared.push(maker); continue; }
    if (ov.bucket !== nv.bucket) {
      const move = { maker, from: ov.bucket, to: nv.bucket };
      if ((RANK[nv.bucket] ?? 0) < (RANK[ov.bucket] ?? 0)) downgraded.push(move);
      else upgraded.push(move);
    }
  }
  for (const [maker, nv] of n) {
    if (!o.has(maker)) appeared.push({ maker, bucket: nv.bucket });
  }
  const sortM = (a, b) => a.maker.localeCompare(b.maker);
  return {
    downgraded: downgraded.sort(sortM),
    upgraded: upgraded.sort(sortM),
    disappeared: disappeared.sort(),
    appeared: appeared.sort(sortM),
  };
}

function diffCurated(oldS, newS) {
  const o = indexBy(oldS.curated, "ref");
  const n = indexBy(newS.curated, "ref");
  const broke = [], recovered = [], newlyBroken = [];

  const health = (e) => (!e?.alive ? "dead" : e.inStock === false ? "oos" : "ok");
  for (const [ref, nv] of n) {
    const ov = o.get(ref);
    const now = health(nv);
    if (!ov) { if (now !== "ok") newlyBroken.push({ ref, now }); continue; }
    const was = health(ov);
    if (was === "ok" && now !== "ok") broke.push({ ref, was, now });
    else if (was !== "ok" && now === "ok") recovered.push({ ref, was, now });
  }
  const sortR = (a, b) => a.ref.localeCompare(b.ref);
  return { broke: broke.sort(sortR), recovered: recovered.sort(sortR), newlyBroken: newlyBroken.sort(sortR) };
}

const [oldS, newS] = resolveInputs(process.argv);
const makers = diffMakers(oldS, newS);
const curated = diffCurated(oldS, newS);

const changed =
  makers.downgraded.length || makers.upgraded.length ||
  makers.disappeared.length || makers.appeared.length ||
  curated.broke.length || curated.recovered.length || curated.newlyBroken.length;

const result = {
  changed: Boolean(changed),
  old: { file: oldS.file, generatedAt: oldS.generatedAt ?? null, totals: oldS.totals ?? null },
  new: { file: newS.file, generatedAt: newS.generatedAt ?? null, totals: newS.totals ?? null },
  makers,
  curated,
};

console.log(JSON.stringify(result, null, 2));
