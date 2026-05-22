#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const APP_ROOT = path.join(ROOT, "src", "app", "[studioSlug]");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

function isDetailPage(filePath) {
  if (!filePath.endsWith(`${path.sep}page.tsx`)) return false;
  if (!filePath.includes(`${path.sep}[studioSlug]${path.sep}`)) return false;
  return /\[[^/\]]*Slug\][\\/]page\.tsx$/.test(filePath);
}

function hasGenerateMetadata(source) {
  return /export\s+async\s+function\s+generateMetadata\s*\(/.test(source);
}

async function main() {
  const allFiles = await walk(APP_ROOT);
  const detailPages = allFiles.filter(isDetailPage);

  const missing = [];
  for (const file of detailPages) {
    const source = await readFile(file, "utf8");
    if (!hasGenerateMetadata(source)) {
      missing.push(path.relative(ROOT, file));
    }
  }

  if (missing.length > 0) {
    console.error("Missing generateMetadata() in detail pages:");
    for (const file of missing) {
      console.error(`- ${file}`);
    }
    process.exit(1);
  }

  console.log(`Detail metadata check passed (${detailPages.length} pages).`);
}

main().catch((error) => {
  console.error("Failed to run detail metadata check.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
