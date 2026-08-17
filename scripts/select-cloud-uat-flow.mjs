#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { routeCloudUatChanges } from "./lib/cloud-uat-routing.mjs";

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const base = value("--base", process.env.GITHUB_EVENT_BEFORE || "HEAD~1");
const head = value("--head", process.env.GITHUB_SHA || "HEAD");
const runFast = args.includes("--run-fast");
if (!base || !head || /[\s\0]/.test(base) || /[\s\0]/.test(head)) {
  throw new Error("Usage: node scripts/select-cloud-uat-flow.mjs [--base <git-ref>] [--head <git-ref>]");
}

const isInitialPush = /^0+$/.test(base);
const diffArgs = isInitialPush
  ? ["diff-tree", "--no-commit-id", "--name-only", "--diff-filter=ACMR", "-r", head]
  : ["diff", "--name-only", "--diff-filter=ACMR", base, head];
const paths = execFileSync("git", diffArgs, { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const manifest = JSON.parse(fs.readFileSync("uat.flows.json", "utf8"));
const result = routeCloudUatChanges(paths, manifest.flows ?? []);
const output = process.env.GITHUB_OUTPUT;
if (output && !runFast) {
  fs.appendFileSync(output, `fast_matrix=${JSON.stringify(result.fastMatrix)}\nhas_fast=${result.fastMatrix.include.length > 0}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY && !runFast) {
  const recommendation = result.dispatch ? `Run **Free cloud UAT** with \`${result.dispatch}\` when browser/database verification is needed.` : "No declared Docker UAT flow matches this change.";
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## UAT routing\n\n${recommendation}\n`);
}
console.log(JSON.stringify(result));
if (runFast) {
  for (const { script } of result.fastMatrix.include) {
    const completed = spawnSync("npm", ["run", script], { stdio: "inherit" });
    if (completed.error) throw completed.error;
    if (completed.status !== 0) throw new Error(`Fast check ${script} failed with exit code ${completed.status ?? "unknown"}`);
  }
}
