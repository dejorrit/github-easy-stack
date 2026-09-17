// Bumps "version" in manifest.json and prints the new version.
// Usage: node scripts/bump-version.mjs [patch|minor|major]

import { readFileSync, writeFileSync } from "node:fs";

const MANIFEST = new URL("../manifest.json", import.meta.url);
const level = process.argv[2] ?? "patch";

if (!["patch", "minor", "major"].includes(level)) {
  console.error(`Unknown bump level "${level}", expected patch, minor or major.`);
  process.exit(1);
}

const source = readFileSync(MANIFEST, "utf8");
const { version } = JSON.parse(source);
const parts = version.split(".").map(Number);

if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
  console.error(`manifest.json version "${version}" is not MAJOR.MINOR.PATCH.`);
  process.exit(1);
}

let [major, minor, patch] = parts;
if (level === "major") [major, minor, patch] = [major + 1, 0, 0];
if (level === "minor") [minor, patch] = [minor + 1, 0];
if (level === "patch") patch += 1;
const next = `${major}.${minor}.${patch}`;

// Replace in place rather than re-serialising, so the manifest keeps its formatting.
writeFileSync(MANIFEST, source.replace(/("version"\s*:\s*")[^"]*(")/, `$1${next}$2`));
console.log(next);
