// Turns results files into leaderboards, one per architecture, size and cache mode, best first.
//
// Runs dispatched on different days aren't directly comparable (the network, mirrors and GitHub's
// own load move), so every dispatch also runs GitHub's runner as a baseline. Each job's workload
// time is divided by the median GitHub time from the same dispatch (same architecture and cache
// mode), and runners are scored on those ratios. The real times are shown alongside.
//
//   node scripts/summarize.mjs <results dir>   (prints Markdown)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BASELINE = "github";
export const SCHEMA = 2;

// Score: 0 to 100, higher is better, like ComputeSDK's benchmarks. Each statistic of the ratio to
// GitHub scores 100 × (1 − ratio / CEILING), so GitHub's own runner scores about 50 and a runner
// that takes twice GitHub's time scores 0. The weighted sum is multiplied by the success rate.
// The scale is fixed, so adding a provider never moves anyone else's score.
export const CEILING = 2;
export const WEIGHTS = { median: 0.75, p95: 0.25 };

export function median(values) {
  const v = values.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Nearest-rank percentile. */
export function percentile(values, p) {
  const v = values.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)];
}

export function score(ratios, successRate) {
  const m = median(ratios);
  const p = percentile(ratios, 95);
  if (m === null) return 0;
  const stat = (r) => Math.max(0, Math.min(100, 100 * (1 - r / CEILING)));
  return Math.round((WEIGHTS.median * stat(m) + WEIGHTS.p95 * stat(p)) * successRate * 10) / 10;
}

const groupKey = (j) => `${j.arch}/${j.vcpus}/${j.cache}`;

export function summarize(records) {
  // provider/arch/vcpus/cache -> accumulated runs
  const rows = new Map();
  for (const record of records) {
    for (const arch of ["x64", "arm"]) {
      for (const cache of ["cold", "warm"]) {
        const jobs = record.jobs.filter((j) => j.arch === arch && j.cache === cache);
        if (!jobs.length) continue;
        const baseline = median(jobs.filter((j) => j.provider === BASELINE).map((j) => j.workloadS));
        for (const job of jobs) {
          const key = `${job.provider}/${groupKey(job)}`;
          if (!rows.has(key)) {
            rows.set(key, { provider: job.provider, arch, vcpus: job.vcpus, cache, jobs: [], ratios: [], dispatches: new Set(), last: null });
          }
          const row = rows.get(key);
          row.jobs.push(job);
          row.dispatches.add(record.runId);
          if (!row.last || record.dispatchedAt > row.last) row.last = record.dispatchedAt;
          if (baseline && job.workloadS !== null) row.ratios.push(job.workloadS / baseline);
        }
      }
    }
  }

  const groups = {};
  for (const row of rows.values()) {
    const ok = row.jobs.filter((j) => j.workloadS !== null);
    const successRate = row.jobs.length ? ok.length / row.jobs.length : 0;
    const stage = (k) => median(ok.map((j) => j.stages[k]));
    const key = `${row.arch}/${row.vcpus}/${row.cache}`;
    (groups[key] ??= []).push({
      provider: row.provider,
      arch: row.arch,
      vcpus: row.vcpus,
      cache: row.cache,
      label: row.jobs.at(-1)?.label ?? null,
      runs: row.jobs.length,
      failed: row.jobs.length - ok.length,
      neverStarted: row.jobs.filter((j) => !j.started).length,
      successRate,
      dispatches: row.dispatches.size,
      last: row.last,
      workloadS: median(ok.map((j) => j.workloadS)),
      minS: ok.length ? Math.min(...ok.map((j) => j.workloadS)) : null,
      maxS: ok.length ? Math.max(...ok.map((j) => j.workloadS)) : null,
      pickupS: median(row.jobs.map((j) => j.pickupS)),
      stages: { restore: stage("restore"), install: stage("install"), typecheck: stage("typecheck"), test: stage("test"), build: stage("build") },
      vsGitHub: median(row.ratios),
      score: score(row.ratios, successRate),
      cpu: row.jobs.map((j) => j.machine?.cpu).find(Boolean) ?? null,
    });
  }
  for (const list of Object.values(groups)) {
    list.sort((a, b) => b.score - a.score || (a.vsGitHub ?? Infinity) - (b.vsGitHub ?? Infinity));
    const best = list.find((r) => r.vsGitHub !== null)?.vsGitHub;
    for (const r of list) r.vsFastest = best && r.vsGitHub !== null ? r.vsGitHub / best : null;
  }
  // Warm rows: how their median compares to the same runner's cold median, the cache's benefit.
  for (const [key, list] of Object.entries(groups)) {
    if (!key.endsWith("/warm")) continue;
    const cold = groups[key.replace(/warm$/, "cold")] ?? [];
    for (const r of list) {
      const c = cold.find((x) => x.provider === r.provider)?.workloadS;
      r.vsCold = c && r.workloadS ? r.workloadS / c : null;
    }
  }
  return groups;
}

const time = (s) => {
  if (s === null || s === undefined) return "–";
  if (s < 60) return `${s.toFixed(1)}s`;
  const r = Math.round(s);
  return `${Math.floor(r / 60)}m ${String(r % 60).padStart(2, "0")}s`;
};
const factor = (x) => (x === null || x === undefined ? "–" : `${x.toFixed(2)}x`);

const ORDER = ["x64/2/cold", "x64/4/cold", "arm/2/cold", "arm/4/cold", "x64/2/warm", "x64/4/warm", "arm/2/warm", "arm/4/warm"];

export function markdown(groups, { title = "Node workload leaderboard" } = {}) {
  const out = [`# ${title}`, ""];
  for (const key of ORDER) {
    const rows = groups[key];
    if (!rows?.length) continue;
    const [arch, vcpus, cache] = key.split("/");
    const warm = cache === "warm";
    out.push(`## Linux ${arch}, ${vcpus} vCPU, ${cache} cache`, "");
    out.push(
      `| # | Runner | Score | Median | vs fastest | vs GitHub${warm ? " | vs cold" : ""} | Range | Pickup |${warm ? " Restore |" : ""} Install | Typecheck | Test | Build | Runs (failed) | CPU |`,
      `|---|---|---|---|---|---${warm ? "|---" : ""}|---|---|${warm ? "---|" : ""}---|---|---|---|---|---|`,
    );
    rows.forEach((r, i) => {
      const s = r.stages;
      out.push(
        `| ${i + 1} | ${r.provider} \`${r.label}\` | ${r.score} | ${time(r.workloadS)} | ${factor(r.vsFastest)} | ${factor(r.vsGitHub)}${warm ? ` | ${factor(r.vsCold)}` : ""} | ${time(r.minS)} to ${time(r.maxS)} | ${time(r.pickupS)} |${warm ? ` ${time(s.restore)} |` : ""} ${time(s.install)} | ${time(s.typecheck)} | ${time(s.test)} | ${time(s.build)} | ${r.runs} (${r.failed}) | ${r.cpu ?? "–"} |`,
      );
    });
    out.push("");
  }
  out.push(
    "Score: 0 to 100, from the median and p95 ratio to GitHub's runner in the same dispatch, times the success rate (GitHub ≈ 50, twice GitHub's time = 0). Median = restore (warm only) + install + typecheck + test + build. Pickup = queued to started. GitHub's runner in a public repo has 4 vCPU, so 2 vCPU tables still compare against it. See METHODOLOGY.md.",
  );
  return out.join("\n");
}

export function readResults(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
    // Older schemas ran a different workload, so they aren't ranked with these.
    .filter((r) => r.schema === SCHEMA);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? "results";
  console.log(markdown(summarize(readResults(dir))));
}
