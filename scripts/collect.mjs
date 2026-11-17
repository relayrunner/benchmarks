// Reads this run's benchmark jobs from the GitHub API and writes one results file for the dispatch.
// Every time comes from GitHub's own job and step timestamps, never from the runner's clock.
//
//   GITHUB_TOKEN=… GITHUB_REPOSITORY=relayrunner/benchmarks RUN_ID=… RUN_ATTEMPT=1 \
//     node scripts/collect.mjs <machines dir> <out dir>
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The workflow's timed steps, by name.
export const STAGES = { install: "Install", typecheck: "Typecheck", test: "Test" };
// Matrix jobs are named `bench <provider>/<arch>/<repeat>`.
const JOB_NAME = /^bench (\w[\w-]*)\/(x64|arm)\/(\d+)$/;

const seconds = (from, to) =>
  from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 100) / 10 : null;

/** One API job (GET /actions/runs/{id}/attempts/{n}/jobs) as a result row, or null if it isn't a bench job. */
export function jobResult(job, machines = {}) {
  const m = JOB_NAME.exec(job.name);
  if (!m) return null;
  const [, provider, arch, repeat] = m;
  const stages = {};
  for (const [key, name] of Object.entries(STAGES)) {
    const step = job.steps?.find((s) => s.name === name);
    stages[key] =
      step && step.conclusion === "success" ? seconds(step.started_at, step.completed_at) : null;
  }
  const complete = Object.values(stages).every((s) => s !== null);
  return {
    provider,
    arch,
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
    // Install + typecheck + test: the number the leaderboard ranks on. Null unless all three passed.
    workloadS: complete
      ? Math.round((stages.install + stages.typecheck + stages.test) * 10) / 10
      : null,
    machine: machines[`${provider}/${arch}/${repeat}`] ?? null,
  };
}

/** The machine-*.json files the bench jobs uploaded, keyed by job id. */
export function readMachines(dir) {
  const out = {};
  let files = [];
  try {
    files = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(".json"));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const m = JSON.parse(readFileSync(join(dir, String(f)), "utf8"));
      if (m.id) out[m.id] = m;
    } catch {
      // A half-written file from a job that died says nothing; skip it.
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
  const [machinesDir = "machines", outDir = "out"] = process.argv.slice(2);
  const env = process.env;
  const runId = env.RUN_ID;
  const attempt = env.RUN_ATTEMPT || "1";
  const jobs = await fetchJobs({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY, runId, attempt });
  const machines = readMachines(machinesDir);
  const results = jobs.map((j) => jobResult(j, machines)).filter(Boolean);
  const record = {
    schema: 1,
    runId: Number(runId),
    runAttempt: Number(attempt),
    runUrl: `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${runId}`,
    // When the first job was queued: the dispatch's moment, whatever time this job runs.
    dispatchedAt:
      results.map((j) => j.queuedAt).filter(Boolean).sort()[0] ?? new Date().toISOString(),
    benchmarksSha: env.GITHUB_SHA ?? null,
    workload: { repository: env.WORKLOAD_REPOSITORY, ref: env.WORKLOAD_REF, node: env.NODE_VERSION },
    inputs: { providers: env.PROVIDERS ?? "", arch: env.ARCH ?? "", repeats: Number(env.REPEATS) },
    jobs: results.sort((a, b) =>
      `${a.provider}/${a.arch}/${a.repeat}`.localeCompare(`${b.provider}/${b.arch}/${b.repeat}`),
    ),
  };
  mkdirSync(outDir, { recursive: true });
  const day = record.dispatchedAt.slice(0, 10);
  const file = join(outDir, `${day}-${runId}-${attempt}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`Wrote ${file} with ${results.length} jobs`);
}
