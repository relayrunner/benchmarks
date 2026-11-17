// Turns results files into a leaderboard per architecture, fastest first.
//
// Runs dispatched on different days aren't directly comparable (the network, mirrors and GitHub's
// own load move), so every dispatch also runs GitHub's runner as a baseline. Each job's workload
// time is divided by the median GitHub time from the same dispatch, and providers are ranked on
// the median of those ratios. The real times are shown alongside.
//
//   node scripts/summarize.mjs <results dir>   (prints Markdown)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BASELINE = "github";

export function median(values) {
  const v = values.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function summarize(records) {
  // provider/arch -> accumulated runs
  const rows = new Map();
  for (const record of records) {
    for (const arch of ["x64", "arm"]) {
      const jobs = record.jobs.filter((j) => j.arch === arch);
      if (!jobs.length) continue;
      const baseline = median(jobs.filter((j) => j.provider === BASELINE).map((j) => j.workloadS));
      for (const job of jobs) {
        const key = `${job.provider}/${arch}`;
        if (!rows.has(key)) {
          rows.set(key, { provider: job.provider, arch, jobs: [], ratios: [], dispatches: new Set(), last: null });
        }
        const row = rows.get(key);
        row.jobs.push(job);
        row.dispatches.add(record.runId);
        if (!row.last || record.dispatchedAt > row.last) row.last = record.dispatchedAt;
        if (baseline && job.workloadS !== null) row.ratios.push(job.workloadS / baseline);
      }
    }
  }

  const byArch = { x64: [], arm: [] };
  for (const row of rows.values()) {
    const ok = row.jobs.filter((j) => j.workloadS !== null);
    byArch[row.arch].push({
      provider: row.provider,
      label: row.jobs.at(-1)?.label ?? null,
      runs: row.jobs.length,
      failed: row.jobs.length - ok.length,
      neverStarted: row.jobs.filter((j) => !j.started).length,
      dispatches: row.dispatches.size,
      last: row.last,
      workloadS: median(ok.map((j) => j.workloadS)),
      minS: ok.length ? Math.min(...ok.map((j) => j.workloadS)) : null,
      maxS: ok.length ? Math.max(...ok.map((j) => j.workloadS)) : null,
      pickupS: median(row.jobs.map((j) => j.pickupS)),
      install: median(ok.map((j) => j.stages.install)),
      typecheck: median(ok.map((j) => j.stages.typecheck)),
      test: median(ok.map((j) => j.stages.test)),
      vsGitHub: median(row.ratios),
      cpu: row.jobs.map((j) => j.machine?.cpu).find(Boolean) ?? null,
    });
  }
  for (const arch of Object.keys(byArch)) {
    const list = byArch[arch].sort((a, b) => (a.vsGitHub ?? Infinity) - (b.vsGitHub ?? Infinity));
    const best = list.find((r) => r.vsGitHub !== null)?.vsGitHub;
    for (const r of list) r.vsFastest = best && r.vsGitHub !== null ? r.vsGitHub / best : null;
  }
  return byArch;
}

const time = (s) => {
  if (s === null || s === undefined) return "–";
  const r = Math.round(s);
  return r >= 60 ? `${Math.floor(r / 60)}m ${String(r % 60).padStart(2, "0")}s` : `${r}s`;
};
const factor = (x) => (x === null ? "–" : `${x.toFixed(2)}x`);

export function markdown(byArch, { title = "Node workload leaderboard" } = {}) {
  const out = [`# ${title}`, ""];
  for (const [arch, rows] of Object.entries(byArch)) {
    if (!rows.length) continue;
    out.push(`## Linux ${arch}, 2 vCPU`, "");
    out.push(
      "| # | Runner | Median workload | vs fastest | vs GitHub | Range | Pickup | Install | Typecheck | Test | Runs (failed) | CPU |",
      "|---|---|---|---|---|---|---|---|---|---|---|---|",
    );
    rows.forEach((r, i) => {
      out.push(
        `| ${i + 1} | ${r.provider} \`${r.label}\` | ${time(r.workloadS)} | ${factor(r.vsFastest)} | ${factor(r.vsGitHub)} | ${time(r.minS)} to ${time(r.maxS)} | ${time(r.pickupS)} | ${time(r.install)} | ${time(r.typecheck)} | ${time(r.test)} | ${r.runs} (${r.failed}) | ${r.cpu ?? "–"} |`,
      );
    });
    out.push("");
  }
  out.push(
    "Workload = install + typecheck + test, timed from GitHub's step timestamps. Ranked on the median ratio to GitHub's runner in the same dispatch. Pickup = queued to started.",
  );
  return out.join("\n");
}

export function readResults(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
    .filter((r) => r.schema === 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? "results";
  console.log(markdown(summarize(readResults(dir))));
}
