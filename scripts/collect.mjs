// Reads this run's benchmark jobs from the GitHub API and writes one results file for the dispatch.
// Queue and pickup times come from GitHub's job timestamps. Stage times come from the runner's
// millisecond clock (GitHub's step times are whole seconds), with the API as the fallback.
//
//   GITHUB_TOKEN=… GITHUB_REPOSITORY=relayrunner/benchmarks RUN_ID=… RUN_ATTEMPT=1 \
//     node scripts/collect.mjs <records dir> <out dir>
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The workflow's timed steps, by name. Each step also writes its own millisecond time to the job's
// stages.txt; the step's whole-second times from the API are the fallback when that's missing.
// `restore` only runs on warm jobs.
export const STAGES = {
  restore: "Restore cache",
  install: "Install",
  typecheck: "Typecheck",
  test: "Test",
  build: "Build",
};
const REQUIRED = ["install", "typecheck", "test", "build"];
// Matrix jobs are named `bench <provider>/<arch>-<vcpus>/<cold|warm>/<repeat>`.
const JOB_NAME = /^bench (\w[\w-]*)\/(x64|arm)-(\d+)\/(cold|warm)\/(\d+)$/;

const seconds = (from, to) =>
  from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 100) / 10 : null;

/** One API job (GET /actions/runs/{id}/attempts/{n}/jobs) as a result row, or null if it isn't a bench job. */
export function jobResult(job, records = {}) {
  const m = JOB_NAME.exec(job.name);
  if (!m) return null;
  const [, provider, arch, vcpus, cache, repeat] = m;
  const id = `${provider}/${arch}-${vcpus}/${cache}/${repeat}`;
  const record = records[id] ?? {};
  const stages = {};
  for (const [key, name] of Object.entries(STAGES)) {
    if (key === "restore" && cache !== "warm") continue;
    const step = job.steps?.find((s) => s.name === name);
    const ok = step && step.conclusion === "success";
    const ms = record.stagesMs?.[key];
    stages[key] = !ok ? null : typeof ms === "number" ? ms / 1000 : seconds(step.started_at, step.completed_at);
  }
  const needed = cache === "warm" ? ["restore", ...REQUIRED] : REQUIRED;
  const complete = needed.every((k) => typeof stages[k] === "number");
  return {
    provider,
    arch,
    vcpus: Number(vcpus),
    cache,
    repeat: Number(repeat),
    label: job.labels?.[0] ?? null,
    conclusion: job.conclusion,
    // Whether a runner ever took the job. A job cancelled or timed out in the queue never started.
    started: Boolean(job.runner_name) && Boolean(job.started_at),
    runnerName: job.runner_name ?? null,
    queuedAt: job.created_at,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    pickupS: seconds(job.created_at, job.started_at),
    jobS: seconds(job.started_at, job.completed_at),
    stages,
    // Every stage added up (restore included on warm jobs, since that's what using the cache
    // costs): the number the leaderboard ranks on. Null unless every stage passed.
    workloadS: complete
      ? Math.round(needed.reduce((sum, k) => sum + stages[k], 0) * 1000) / 1000
      : null,
    // Where the stage times came from: the runner's millisecond clock, or GitHub's step seconds.
    timing: record.stagesMs ? "ms" : "api",
    machine: record.machine ?? null,
  };
}

/** `restore 1234` lines from a job's stages.txt, as { restore: 1234 }. */
export function parseStages(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const [key, ms] = line.trim().split(/\s+/);
    if (key && /^\d+$/.test(ms ?? "")) out[key] = Number(ms);
  }
  return out;
}

/**
 * What each bench job uploaded (one directory per job: machine.json and stages.txt), keyed by job id.
 */
export function readRecords(dir) {
  const out = {};
  let dirs = [];
  try {
    dirs = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return out;
  }
  for (const d of dirs) {
    try {
      const machine = JSON.parse(readFileSync(join(dir, d.name, "machine.json"), "utf8"));
      let stagesMs = null;
      try {
        stagesMs = parseStages(readFileSync(join(dir, d.name, "stages.txt"), "utf8"));
      } catch {
        // No stage finished.
      }
      if (machine.id) out[machine.id] = { machine, stagesMs };
    } catch {
      // A half-written record from a job that died says nothing; skip it.
    }
  }
  return out;
}

async function fetchJobs({ token, repo, runId, attempt }) {
  const jobs = [];
  for (let page = 1; ; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100&page=${page}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
        },
      },
    );
    if (!res.ok) throw new Error(`GitHub jobs API ${res.status}: ${await res.text()}`);
    const body = await res.json();
    jobs.push(...body.jobs);
    if (jobs.length >= body.total_count || body.jobs.length === 0) return jobs;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [recordsDir = "records", outDir = "out"] = process.argv.slice(2);
  const env = process.env;
  const runId = env.RUN_ID;
  const attempt = env.RUN_ATTEMPT || "1";
  const jobs = await fetchJobs({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY, runId, attempt });
  const records = readRecords(recordsDir);
  const results = jobs.map((j) => jobResult(j, records)).filter(Boolean);
  const record = {
    schema: 2,
    runId: Number(runId),
    runAttempt: Number(attempt),
    runUrl: `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${runId}`,
    // When the first job was queued: the dispatch's moment, whatever time this job runs.
    dispatchedAt:
      results.map((j) => j.queuedAt).filter(Boolean).sort()[0] ?? new Date().toISOString(),
    benchmarksSha: env.GITHUB_SHA ?? null,
    workload: {
      repository: env.WORKLOAD_REPOSITORY,
      ref: env.WORKLOAD_REF,
      node: env.NODE_VERSION,
      pnpm: env.PNPM_VERSION,
    },
    inputs: {
      providers: env.PROVIDERS ?? "",
      arch: env.ARCH ?? "",
      vcpus: env.VCPUS ?? "",
      cache: env.CACHE ?? "",
      repeats: Number(env.REPEATS),
    },
    jobs: results.sort((a, b) =>
      [a.provider, a.arch, a.vcpus, a.cache, a.repeat].join("/").localeCompare([b.provider, b.arch, b.vcpus, b.cache, b.repeat].join("/")),
    ),
  };
  mkdirSync(outDir, { recursive: true });
  const day = record.dispatchedAt.slice(0, 10);
  const file = join(outDir, `${day}-${runId}-${attempt}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`Wrote ${file} with ${results.length} jobs`);
}
