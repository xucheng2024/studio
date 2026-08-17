#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { assertVercelCandidateUrl, requiredEnvironment } from "./lib/release-gate-safety.mjs";

const baseUrl = assertVercelCandidateUrl(requiredEnvironment("RELEASE_CANDIDATE_URL"));
const runId = (process.env.RELEASE_SMOKE_RUN_ID || `local-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "-");
const evidenceDirectory = path.join(process.cwd(), "tmp", "release-smoke", runId);
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
const extraHTTPHeaders = bypassSecret
  ? { "x-vercel-protection-bypass": bypassSecret, "x-vercel-set-bypass-cookie": "true" }
  : undefined;
const issues = [];
const assertions = [];
let browser;
let page;

fs.mkdirSync(evidenceDirectory, { recursive: true });

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders });
  page = await context.newPage();
  page.setDefaultNavigationTimeout(120_000);
  page.on("console", (message) => {
    if (message.type() === "error") issues.push("console_error");
  });
  page.on("pageerror", () => issues.push("page_error"));
  page.on("requestfailed", (request) => {
    const resourceType = request.resourceType();
    if (new URL(request.url()).origin === baseUrl && ["document", "script", "stylesheet", "fetch", "xhr"].includes(resourceType)) {
      issues.push(`request_failed_${resourceType}`);
    }
  });

  const homeResponse = await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  assert.ok(homeResponse && homeResponse.status() < 400, `Release candidate home returned ${homeResponse?.status() ?? "no response"}`);
  await page.getByRole("heading", { name: /Run your studio without/i }).waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "Release candidate home overflows at 390px");
  assertions.push("public_home_mobile");

  const authResponse = await page.goto(`${baseUrl}/auth`, { waitUntil: "domcontentloaded" });
  assert.ok(authResponse && authResponse.status() < 400, `Release candidate auth returned ${authResponse?.status() ?? "no response"}`);
  await page.getByRole("heading", { name: "Staff access only" }).waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "Release candidate auth overflows at 390px");
  assertions.push("staff_auth_mobile");

  assert.deepEqual(issues, [], `Release candidate emitted browser errors (${issues.length})`);
  fs.writeFileSync(path.join(evidenceDirectory, "index.json"), `${JSON.stringify({
    schema_version: 1,
    status: "passed",
    run_id: runId,
    commit: process.env.RELEASE_COMMIT_SHA || null,
    deployment_origin: baseUrl,
    assertions: assertions.map((name) => ({ name, result: "passed" })),
  }, null, 2)}\n`);
  console.log(JSON.stringify({ status: "passed", assertions: assertions.length, evidence: path.relative(process.cwd(), evidenceDirectory) }));
} catch (error) {
  if (page) await page.screenshot({ path: path.join(evidenceDirectory, "failure.png"), fullPage: true }).catch(() => {});
  fs.writeFileSync(path.join(evidenceDirectory, "index.json"), `${JSON.stringify({
    schema_version: 1,
    status: "failed",
    run_id: runId,
    assertion_count: assertions.length,
    issue_count: issues.length,
  }, null, 2)}\n`);
  throw error;
} finally {
  await browser?.close();
}
