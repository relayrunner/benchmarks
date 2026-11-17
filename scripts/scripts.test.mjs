// node --test scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { jobResult } from "./collect.mjs";
import { plan } from "./plan.mjs";
import { markdown, median, summarize } from "./summarize.mjs";

const runners = {
  $comment: "x",
  github: { x64: "ubuntu-24.04", arm: "ubuntu-24.04-arm" },
  blacksmith: { x64: "blacksmith-2vcpu-ubuntu-2404" },
};

test("plan always includes the GitHub baseline, once", () => {
  const { include } = plan(runners, { providers: "Blacksmith, github", arch: "x64", repeats: "2" });
  assert.deepEqual(
    include.map((j) => j.id),
    ["github/x64/1", "github/x64/2", "blacksmith/x64/1", "blacksmith/x64/2"],
  );
  assert.equal(include[2].label, "blacksmith-2vcpu-ubuntu-2404");
});

test("plan skips an architecture a provider lacks", () => {
  const { include, skipped } = plan(runners, { providers: "blacksmith", arch: "both", repeats: 1 });
  assert.deepEqual(include.map((j) => j.id), ["github/x64/1", "github/arm/1", "blacksmith/x64/1"]);
  assert.deepEqual(skipped, ["blacksmith/arm"]);
});

test("plan rejects unknown providers and bad repeats", () => {
  assert.throws(() => plan(runners, { providers: "depot", arch: "x64", repeats: 1 }), /Unknown provider depot/);
  assert.throws(() => plan(runners, { providers: "", arch: "x64", repeats: 0 }), /repeats/);
  assert.throws(() => plan(runners, { providers: "", arch: "x64", repeats: 11 }), /repeats/);
  assert.throws(() => plan(runners, { providers: "$comment", arch: "x64", repeats: 1 }), /Unknown/);
});

const step = (name, start, end, conclusion = "success") => ({
  name,
  conclusion,
  started_at: `2026-11-17T10:${start}Z`,
  completed_at: `2026-11-17T10:${end}Z`,
});
const apiJob = (name, { queued = "00:00", started = "00:05", fail = false, never = false } = {}) => ({
  name,
  labels: ["blacksmith-2vcpu-ubuntu-2404"],
  conclusion: never ? "cancelled" : fail ? "failure" : "success",
  runner_name: never ? null : "runner-1",
  created_at: `2026-11-17T10:${queued}Z`,
  started_at: never ? null : `2026-11-17T10:${started}Z`,
  completed_at: "2026-11-17T10:03:00Z",
  steps: never
    ? []
    : [
        step("Install", "00:10", "00:40"),
        step("Typecheck", "00:40", "01:00"),
        step("Test", "01:00", "01:45", fail ? "failure" : "success"),
      ],
});

test("jobResult reads stages from step timestamps", () => {
  const r = jobResult(apiJob("bench blacksmith/x64/2"), { "blacksmith/x64/2": { cpu: "EPYC" } });
  assert.equal(r.provider, "blacksmith");
  assert.equal(r.repeat, 2);
  assert.equal(r.pickupS, 5);
  assert.deepEqual(r.stages, { install: 30, typecheck: 20, test: 45 });
  assert.equal(r.workloadS, 95);
  assert.equal(r.machine.cpu, "EPYC");
});

test("jobResult: failed test or never started gives no workload time", () => {
  assert.equal(jobResult(apiJob("bench github/x64/1", { fail: true })).workloadS, null);
  const never = jobResult(apiJob("bench blacksmith/x64/1", { never: true }));
  assert.equal(never.started, false);
  assert.equal(never.workloadS, null);
  assert.equal(jobResult(apiJob("plan")), null);
  assert.equal(jobResult(apiJob("collect")), null);
});

const job = (provider, workloadS, extra = {}) => ({
  provider,
  arch: "x64",
  label: provider,
  started: true,
  pickupS: 3,
  workloadS,
  stages: { install: workloadS && workloadS / 2, typecheck: 1, test: 1 },
  ...extra,
});

test("summarize ranks on the ratio to GitHub in the same dispatch", () => {
  const records = [
    // Day 1: everything slow; blacksmith half of GitHub.
    { runId: 1, dispatchedAt: "2026-11-17", jobs: [job("github", 200), job("github", 200), job("blacksmith", 100)] },
    // Day 2: everything fast; a new provider at 0.8x of that day's GitHub.
    { runId: 2, dispatchedAt: "2026-11-18", jobs: [job("github", 100), job("other", 80), job("other", null, { started: false })] },
  ];
  const { x64 } = summarize(records);
  assert.deepEqual(x64.map((r) => r.provider), ["blacksmith", "other", "github"]);
  assert.equal(x64[0].vsGitHub, 0.5);
  assert.equal(x64[0].vsFastest, 1);
  assert.equal(x64[1].vsFastest, 1.6);
  assert.equal(x64[1].runs, 2);
  assert.equal(x64[1].failed, 1);
  assert.equal(x64[1].neverStarted, 1);
  assert.equal(x64[2].workloadS, 200);
  assert.match(markdown({ x64, arm: [] }), /\| 1 \| blacksmith .* \| 1m 40s \| 1\.00x \| 0\.50x \|/);
});

test("median", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([null]), null);
});
