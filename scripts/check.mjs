// Static checks for sources. Runs without network access and without building packages.
//
//   node scripts/check.mjs                 validate every source
//   node scripts/check.mjs --base <ref>    also warn when a changed source keeps its old version
//
// Errors fail the run (exit code 1); warnings are printed and, on GitHub Actions, shown as annotations.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcesDir = join(root, "sources");
const inCi = process.env.GITHUB_ACTIONS === "true";
const baseArg = process.argv.indexOf("--base");
const baseRef = baseArg > 0 ? process.argv[baseArg + 1] : null;

// Templated sources (source.json with "template") are expanded by compose.mjs when the repository has it.
const composePath = join(root, "scripts", "lib", "compose.mjs");
const composeSource = existsSync(composePath)
  ? (await import(composePath)).composeSource
  : null;

let errors = 0;
let warnings = 0;

function report(level, folder, message) {
  const file = `sources/${folder}`;
  if (level === "error") errors += 1;
  else warnings += 1;
  console.log(`${level === "error" ? "ERROR" : "warn "} ${file}: ${message}`);
  if (inCi) console.log(`::${level} file=${file}/source.json::${message}`);
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function collectSettingIds(items, ids = []) {
  for (const item of items ?? []) {
    if (item.id) ids.push(item.id);
    if (Array.isArray(item.items)) collectSettingIds(item.items, ids);
  }
  return ids;
}

function baseVersion(folder) {
  try {
    const raw = execFileSync("git", ["show", `${baseRef}:sources/${folder}/source.json`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(raw)?.info?.version;
  } catch {
    return undefined; // new source
  }
}

function changedSince(folder) {
  const out = execFileSync("git", ["diff", "--name-only", `${baseRef}...HEAD`, "--", `sources/${folder}`], {
    cwd: root,
    encoding: "utf8",
  });
  return out.split("\n").some((name) => /\.(js|json)$/.test(name));
}

const seenIds = new Map();
const folders = readdirSync(sourcesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "template")
  .map((entry) => entry.name);

for (const folder of folders) {
  const dir = join(sourcesDir, folder);

  if (!existsSync(join(dir, "source.json"))) {
    report("error", folder, "source.json is missing");
    continue;
  }

  let manifest;
  let script;
  try {
    if (composeSource) {
      ({ manifest, script } = composeSource(folder));
    } else {
      manifest = readJson(join(dir, "source.json"));
      script = readFileSync(join(dir, "index.js"), "utf8");
    }
  } catch (error) {
    report("error", folder, `cannot read the source: ${error.message}`);
    continue;
  }

  const info = manifest.info ?? {};

  if (typeof info.id !== "string" || info.id.trim() === "") {
    report("error", folder, "info.id is required");
  } else {
    if (seenIds.has(info.id)) {
      report("error", folder, `info.id "${info.id}" is already used by sources/${seenIds.get(info.id)}`);
    }
    seenIds.set(info.id, folder);
    if (!info.id.endsWith(".tamdok")) {
      report("warn", folder, `info.id "${info.id}" should end with .tamdok`);
    }
  }
  if (typeof info.name !== "string" || info.name.trim() === "") {
    report("error", folder, "info.name is required");
  }
  if (!Number.isInteger(info.version) || info.version < 1) {
    report("error", folder, "info.version must be a positive integer");
  }
  if (info.contentRating !== undefined && ![0, 1, 2].includes(info.contentRating)) {
    report("error", folder, "info.contentRating must be 0, 1 or 2");
  }
  if (info.languages !== undefined && !(Array.isArray(info.languages) && info.languages.every((l) => typeof l === "string"))) {
    report("error", folder, "info.languages must be an array of strings");
  }
  for (const key of ["url", ...(Array.isArray(info.urls) ? ["urls"] : [])]) {
    for (const value of key === "url" ? [info.url] : info.urls) {
      if (value === undefined) continue;
      try {
        new URL(value);
      } catch {
        report("error", folder, `info.${key} is not a valid URL: ${value}`);
      }
    }
  }

  const settingIds = collectSettingIds(manifest.settings);
  const duplicates = settingIds.filter((id, index) => settingIds.indexOf(id) !== index);
  if (duplicates.length > 0) {
    report("error", folder, `duplicate setting ids: ${[...new Set(duplicates)].join(", ")}`);
  }
  for (const listing of manifest.listings ?? []) {
    if (!listing.id) report("error", folder, "every listing needs an id");
  }

  // Only parses the script; nothing is executed.
  try {
    new vm.Script(script, { filename: `sources/${folder}/index.js` });
  } catch (error) {
    report("error", folder, `index.js has a syntax error: ${error.message}`);
  }
  if (!/module\.exports/.test(script)) {
    report("error", folder, "index.js never assigns module.exports");
  }

  const filtersPath = join(dir, "filters.json");
  if (existsSync(filtersPath)) {
    try {
      readJson(filtersPath);
    } catch (error) {
      report("error", folder, `filters.json is not valid JSON: ${error.message}`);
    }
  }
  if (!existsSync(join(dir, "icon.png")) && !manifest.template) {
    report("warn", folder, "icon.png is missing (128x128 PNG recommended)");
  }

  if (baseRef && changedSince(folder)) {
    const before = baseVersion(folder);
    if (before !== undefined && before === info.version) {
      report("warn", folder, `changed since ${baseRef} but info.version is still ${info.version}; bump it so users get the update`);
    }
  }
}

console.log(`\nChecked ${folders.length} sources: ${errors} error(s), ${warnings} warning(s).`);
process.exit(errors > 0 ? 1 : 0);
