# Methodology

What this benchmark measures, how, and where its limits are. Questions or disputes: open an issue.

## What we measure

One job, the same everywhere: [Zustand](https://github.com/pmndrs/zustand)'s own CI steps at a pinned commit.

| Stage | Command | Notes |
|---|---|---|
| Pickup | – | GitHub queueing the job to a runner starting it, from the jobs API |
| Restore cache | `actions/cache/restore` of the pnpm store | Warm runs only |
| Install | `pnpm install --frozen-lockfile --prefer-offline` | |
| Typecheck | `pnpm run test:types` (`tsc --noEmit`) | |
| Test | `pnpm run test:spec` (`vitest run`) | |
| Build | `pnpm run build` | |

**Workload time** is restore (warm only) + install + typecheck + test + build. It is what the leaderboard ranks on. Pickup is shown next to it but kept out of it, since it says more about capacity than speed.

Pinned: Zustand `9fed2eb`, Node 24, pnpm 11.3.0. The workflow sets these in one place.

## How we time it

- **Stages:** each stage records its own duration on the runner, in milliseconds. GitHub's step timestamps are whole seconds, which is too coarse for stages that take a few seconds. If a stage's own time is missing, GitHub's step time is used and the result says so (`timing: "api"`).
- **Pickup:** GitHub's `created_at` to `started_at` for the job, from the jobs API.
- A stage that fails gives the job no workload time. The job still counts, as a failure.

## Cold and warm

- **Cold:** no cache of any kind, so every run downloads every package.
- **Warm:** one priming job per runner installs and saves the pnpm store with `actions/cache` under a key unique to that dispatch. The timed runs then restore exactly that cache. Providers that redirect `actions/cache` to their own storage (Blacksmith and others) get that benefit automatically, so the same workflow file runs everywhere.

Provider-only features that need their own actions (sticky disks, Docker layer caching) are not measured.

## Making runs comparable

Runs happen on demand, often days apart, and the network, package mirrors and GitHub's own load change in between. So every dispatch also runs **GitHub's standard runner** (`ubuntu-24.04`, `ubuntu-24.04-arm`) as a baseline. In a public repository that runner has **4 vCPU and 16 GB**.

Each job's workload time is divided by the median GitHub workload time from the same dispatch, architecture and cache mode. Rankings use those ratios, never raw times from different days. Raw times are shown too.

Runners are grouped by architecture, vCPU count and cache mode. A 2 vCPU table still uses the 4 vCPU GitHub baseline, so read it within the table, not against GitHub.

## Score

0 to 100, higher is better, adapted from [ComputeSDK's benchmarks](https://github.com/computesdk/benchmarks/blob/main/METHODOLOGY.md):

```
statScore(r) = clamp(100 × (1 − r / 2), 0, 100)     r = ratio to GitHub
score        = (0.75 × statScore(median r) + 0.25 × statScore(p95 r)) × success rate
```

GitHub's runner scores about 50. A runner taking twice GitHub's time scores 0, and one taking half scores 75. The scale is fixed, so adding a provider never moves anyone else's score. p95 is nearest-rank. With a handful of runs it is close to the slowest run, which is the point: a runner with an occasional slow run loses some points.

**Success rate** is the share of jobs that finished every stage. Jobs that failed, timed out (15 minutes) or never started all count against it.

**vs fastest** is a runner's median ratio divided by the best in its table, so the top runner reads 1.00x.

## Results

- Each dispatch writes `results/<date>-<run id>-<attempt>.json` to the [`results` branch](../../tree/results), with every job's timings, the CPU, vCPUs, memory and kernel it got, and the inputs.
- The `results` branch README is the leaderboard, rebuilt from every results file on each dispatch.
- A change to the workload, timing or stages bumps `schema`. Older schemas are kept but not ranked with newer ones.

## Fairness and limits

- **Same workflow, same commit, cold by default.** No provider gets custom steps.
- **Normal accounts.** No arrangement with any provider.
- **Hardware varies.** The same label can land on different CPUs, so each job records what it got.
- **Warm pools.** Providers may keep runners warm, which shows up as fast pickup. That's real for users, but it isn't the same as boot time.
- **Small samples.** Runs are manual and few, so treat close scores as ties. The range column shows the spread.
- **Region and time of day** aren't controlled. Each dispatch's GitHub baseline absorbs some of that, not all.
- **Conflict of interest.** RelayRunner routes jobs to these providers. The method, workflow and every raw result are public so anyone can check or rerun them.

## Changelog

| Date | Change |
|---|---|
| 2026-11-17 | Run 44199045830 excluded: a setup bug in the workflow failed every job before the workload started |
| 2026-11-17 | Schema 2: added build stage, millisecond stage timing, 4 vCPU runners, warm cache mode, score |
| 2026-11-17 | Schema 1: first run (install, typecheck, test; 2 vCPU Blacksmith vs GitHub) |
