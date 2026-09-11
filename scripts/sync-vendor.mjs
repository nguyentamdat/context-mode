#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const vendors = JSON.parse(readFileSync(join(root, "vendor/upstreams.json"), "utf8"));
const [name = "", ...flags] = process.argv.slice(2);
const apply = flags.includes("--apply");
const adopt = flags.includes("--adopt");

if (!vendors[name] || flags.some((flag) => !["--apply", "--adopt"].includes(flag))) {
  console.error(`Usage: node scripts/sync-vendor.mjs <vendor> [--apply] [--adopt]\nVendors: ${Object.keys(vendors).join(", ")}`);
  process.exit(1);
}

const vendor = vendors[name];
const run = (command, args, options = {}) => execFileSync(command, args, {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
  ...options,
}).trim();
const git = (args, options) => run("git", args, options);
const forkUrl = `https://github.com/${vendor.fork}.git`;

if (git(["status", "--porcelain"])) throw new Error("Working tree must be clean.");

if (vendor.upstream) {
  console.log(`Syncing ${vendor.fork} from ${vendor.upstream}…`);
  run("gh", ["repo", "sync", vendor.fork, "--source", vendor.upstream, "--branch", "main"]);
}

if (vendor.upstreamPath) {
  const temp = mkdtempSync(join(tmpdir(), "pitada-vendor-"));
  try {
    run("git", ["clone", "--quiet", forkUrl, temp], { cwd: temp });
    run("git", ["subtree", "split", `--prefix=${vendor.upstreamPath}`, "--branch", vendor.ref], { cwd: temp });
    run("git", ["push", "--force", "origin", vendor.ref], { cwd: temp });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

const split = run("git", ["ls-remote", forkUrl, `refs/heads/${vendor.ref}`]).split(/\s+/)[0];
if (!split) throw new Error(`Missing ${vendor.fork}@${vendor.ref}`);

if (adopt) {
  const message = `Adopt ${name} subtree baseline\n\ngit-subtree-dir: ${vendor.path}\ngit-subtree-split: ${split}\n`;
  run("git", ["commit", "--allow-empty", "-F", "-"], { input: message });
  console.log(`Recorded ${name} baseline at ${split.slice(0, 12)}.`);
}

if (apply) {
  console.log(`Pulling ${vendor.fork}@${vendor.ref} into ${vendor.path}…`);
  run("git", ["subtree", "pull", `--prefix=${vendor.path}`, forkUrl, vendor.ref, "--squash"]);
}

if (!adopt && !apply) console.log(`${name}: ${vendor.fork}@${vendor.ref} is ${split.slice(0, 12)}. Pass --apply to merge it, or --adopt once to establish the subtree baseline.`);
