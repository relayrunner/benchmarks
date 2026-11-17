// node --test scripts/scripts.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { jobResult, parseStages } from "./collect.mjs";
import { plan } from "./plan.mjs";
import { markdown, median, percentile, score, summarize } from "./summarize.mjs";

const runners = {
  $comment: "x",
  github: { x64: { 4: "ubuntu-24.04" }, arm: { 4: "ubuntu-24.04-arm" } },
  blacksmith: { x64: { 2: "bs-2", 4: "bs-4" } },
};
const inputs = { providers: "blacksmith", arch: "x64", vcpus: "4", cache: "cold", repeats: 2 };

test("plan always includes the GitHub baseline once, at its own size", () => {
  const { bench, prime } = plan(runners, { ...inputs, providers: "Blacksmith, github", vcpus: "2" });
  assert.deepEqual(
    bench.map((j) => j.id),
    ["github/x64-4/cold/1", "github/x64-4/cold/2", "blacksmith/x64-2/cold/1", "blacksmith/x64-2/cold/2"],
  );
  assert.equal(bench[2].label, "bs-2");
  assert.deepEqual(prime, []);
});

test("plan: warm adds one priming job per runner, and both sizes", () => {
  const { bench, prime } = plan(runners, { ...inputs, vcpus: "both", cache: "both", repeats: 1 });
  assert.deepEqual(prime.map((p) => p.id), ["github/x64-4", "blacksmith/x64-2", "blacksmith/x64-4"]);
  assert.deepEqual(bench.map((j) => j.id), [
    "github/x64-4/cold/1",
    "github/x64-4/warm/1",
    "blacksmith/x64-2/cold/1",
    "blacksmith/x64-2/warm/1",
    "blacksmith/x64-4/cold/1",
    "blacksmith/x64-4/warm/1",
  ]);
  assert.equal(bench[3].cacheKey, prime[1].cacheKey);
});

test("plan skips a runner a provider lacks", () => {
  const { bench, skipped } = plan(runners, { ...inputs, arch: "both", repeats: 1 });
  assert.deepEqual(bench.map((j) => j.id), ["github/x64-4/cold/1", "github/arm-4/cold/1", "blacksmith/x64-4/cold/1"]);
  assert.deepEqual(skipped, ["blacksmith/arm-4"]);
});

test("plan rejects bad inputs", () => {
  assert.throws(() => plan(runners, { ...inputs, providers: "depot" }), /Unknown provider depot/);
  assert.throws(() => plan(runners, { ...inputs, providers: "$comment" }), /Unknown/);
  assert.throws(() => plan(runners, { ...inputs, repeats: 0 }), /repeats/);
  assert.throws(() => plan(runners, { ...inputs, repeats: 11 }), /repeats/);
  assert.throws(() => plan(runners, { ...inputs, vcpus: "8" }), /vcpus/);
  assert.throws(() => plan(runners, { ...inputs, cache: "hot" }), /cache/);
});

const step = (name, start, end, conclusion = "success") => ({
  name,
  conclusion,
  started_at: `2026-11-17T10:${start}Z`,
  completed_at: `2026-11-17T10:${end}Z`,
});
const apiJob = (name, { fail = false, never = false } = {}) => ({
  name,
  labels: ["bs-4"],
  conclusion: never ? "cancelled" : fail ? "failure" : "success",
  runner_name: never ? null : "runner-1",
  created_at: "2026-11-17T10:00:00Z",
  started_at: never ? null : "2026-11-17T10:00:05Z",
  completed_at: "2026-11-17T10:03:00Z",
  steps: never
    ? []
    : [
        step("Restore cache", "00:08", "00:10"),
        step("Install", "00:10", "00:40"),
        step("Typecheck", "00:40", "01:00"),
        step("Test", "01:00", "01:45", fail ? "failure" : "success"),
        step("Build", "01:45", "01:55"),
      ],
});

test("jobResult prefers the runner's ms times and falls back to API seconds", () => {
  const records = { "blacksmith/x64-4/cold/2": { machine: { cpu: "EPYC" }, stagesMs: { install: 29500, typecheck: 20250 } } };
  const r = jobResult(apiJob("bench blacksmith/x64-4/cold/2"), records);
  assert.equal(r.provider, "blacksmith");
  assert.equal(r.vcpus, 4);
  assert.equal(r.cache, "cold");
  assert.equal(r.pickupS, 5);
  // Cold: no restore stage, even though a step of that name is in the API's list.
  assert.deepEqual(r.stages, { install: 29.5, typecheck: 20.25, test: 45, build: 10 });
  assert.equal(r.workloadS, 104.75);
  assert.equal(r.machine.cpu, "EPYC");
  assert.equal(r.timing, "ms");
});

test("jobResult: warm jobs count restore in the workload", () => {
  const r = jobResult(apiJob("bench github/x64-4/warm/1"));
  assert.equal(r.stages.restore, 2);
  assert.equal(r.workloadS, 107);
  assert.equal(r.timing, "api");
});

test("jobResult: a failed stage or never starting gives no workload time", () => {
  assert.equal(jobResult(apiJob("bench github/x64-4/cold/1", { fail: true })).workloadS, null);
  const never = jobResult(apiJob("bench blacksmith/x64-4/cold/1", { never: true }));
  assert.equal(never.started, false);
  assert.equal(never.workloadS, null);
  for (const name of ["plan", "collect", "prime github/x64-4", "bench github/x64/1"]) {
    assert.equal(jobResult(apiJob(name)), null);
  }
});

test("parseStages", () => {
  assert.deepEqual(parseStages("restore 1200\ninstall 30500\n\njunk\ntest x\n"), { restore: 1200, install: 30500 });
});

const job = (provider, workloadS, extra = {}) => ({
  provider,
  arch: "x64",
  vcpus: 4,
  cache: "cold",
  label: provider,
  started: true,
  pickupS: 3,
  workloadS,
  stages: { install: workloadS && workloadS / 2, typecheck: 1, test: 1, build: 1 },
  ...extra,
});

test("summarize scores on the ratio to GitHub in the same dispatch", () => {
  const records = [
    // Day 1: everything slow; blacksmith half of GitHub's time.
    { runId: 1, dispatchedAt: "2026-11-17", jobs: [job("github", 200), job("github", 200), job("blacksmith", 100)] },
    // Day 2: everything fast; another provider at 0.8x that day's GitHub, one of its two runs never started.
    { runId: 2, dispatchedAt: "2026-11-18", jobs: [job("github", 100), job("other", 80), job("other", null, { started: false })] },
  ];
  const rows = summarize(records)["x64/4/cold"];
  assert.deepEqual(rows.map((r) => r.provider), ["blacksmith", "github", "other"]);
  const [bs, gh, other] = rows;
  assert.equal(bs.vsGitHub, 0.5);
  assert.equal(bs.score, 75); // 100 × (1 − 0.5 / 2), success 1
  assert.equal(gh.score, 50);
  assert.equal(other.successRate, 0.5);
  assert.equal(other.score, 30); // 60 × 0.5
  assert.equal(other.vsFastest, 1.6);
  assert.equal(other.neverStarted, 1);
  assert.equal(gh.workloadS, 200);
  assert.match(markdown(summarize(records)), /\| 1 \| blacksmith `blacksmith` \| 75 \| 1m 40s \| 1\.00x \| 0\.50x \|/);
});

test("summarize: warm rows show their gain over cold", () => {
  const records = [
    {
      runId: 1,
      dispatchedAt: "2026-11-17",
      jobs: [job("github", 100), job("github", 60, { cache: "warm", stages: { restore: 2, install: 20, typecheck: 1, test: 1, build: 1 } })],
    },
  ];
  const groups = summarize(records);
  assert.equal(groups["x64/4/warm"][0].vsCold, 0.6);
  assert.match(markdown(groups), /## Linux x64, 4 vCPU, warm cache/);
});

test("stats", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([null]), null);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(percentile([5], 95), 5);
  assert.equal(score([], 1), 0);
  assert.equal(score([3], 1), 0);
});
