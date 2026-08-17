#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { validateDockerImageList } from "./lib/github-uat-optimization.mjs";

if (process.platform !== "linux" || process.env.GITHUB_ACTIONS !== "true") {
  throw new Error("Supabase image caching must run on a Linux GitHub Actions runner");
}

const action = process.argv[2];
const cacheDirectory = path.join(process.cwd(), ".cache", "github-uat");
const cachePath = path.join(cacheDirectory, "supabase-images.tar");
const manifestPath = path.join(process.cwd(), "tmp", "github-uat", "supabase-images.json");

function runDocker(args) {
  const result = spawnSync("docker", args, { cwd: process.cwd(), stdio: "inherit" });
  if (result.error) throw new Error(`docker could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`docker failed with exit code ${result.status ?? "unknown"}`);
}

if (action === "restore") {
  if (!fs.existsSync(cachePath)) {
    console.log(JSON.stringify({ status: "miss", cache: "supabase-images" }));
  } else {
    runDocker(["load", "--input", cachePath]);
    console.log(JSON.stringify({ status: "restored", cache: "supabase-images" }));
  }
} else if (action === "save") {
  fs.mkdirSync(cacheDirectory, { recursive: true });
  fs.rmSync(cachePath, { force: true });
  if (!fs.existsSync(manifestPath)) {
    console.log(JSON.stringify({ status: "skipped", reason: "image-manifest-missing" }));
  } else {
    const images = validateDockerImageList(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
    runDocker(["save", "--output", cachePath, ...images]);
    console.log(JSON.stringify({ status: "saved", cache: "supabase-images", image_count: images.length }));
  }
} else {
  throw new Error("Usage: node scripts/cache-github-uat-images.mjs <restore|save>");
}
