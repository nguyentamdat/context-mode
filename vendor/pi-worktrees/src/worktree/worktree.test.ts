import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { CommandResult, CommandRunner } from "../git/index.js";
import { createWorktreeEffect, deleteWorktreeEffect, getOverlayDataEffect, returnFromWorktreeEffect } from "./index.js";

class FakeRunner implements CommandRunner {
  readonly calls: string[][] = [];
  dirtyPaths = new Set<string>();
  worktrees: string[] = [];

  constructor(private readonly repoRoot: string, private readonly currentRoot = repoRoot) {}

  async exec(command: string, args: string[]): Promise<CommandResult> {
    this.calls.push([command, ...args]);
    const cwd = args[1] ?? this.repoRoot;
    const gitArgs = args.slice(2);
    const joined = gitArgs.join(" ");

    if (joined === "rev-parse --show-toplevel") {
      return ok(cwd === this.repoRoot ? this.repoRoot : this.currentRoot);
    }

    if (joined === "rev-parse --path-format=absolute --git-common-dir") {
      return ok(path.join(this.repoRoot, ".git"));
    }

    if (joined === "branch --show-current") {
      return ok("main\n");
    }

    if (joined === "worktree list --porcelain") {
      const paths = this.worktrees.length > 0 ? this.worktrees : [this.repoRoot];
      return ok(paths.map((worktreePath) => `worktree ${worktreePath}\nHEAD abc123\nbranch refs/heads/main`).join("\n\n"));
    }

    if (joined === "status --porcelain=v1 -uall") {
      return ok(this.dirtyPaths.has(cwd) ? " M file.txt\n" : "");
    }

    if (gitArgs[0] === "stash" && gitArgs[1] === "push") {
      return ok("Saved working directory\n");
    }

    if (joined === "stash pop") {
      return ok("Applied stash\n");
    }

    if (gitArgs[0] === "worktree" && gitArgs[1] === "add") {
      return ok("");
    }

    if (gitArgs[0] === "worktree" && gitArgs[1] === "remove") {
      return ok("");
    }

    return { stdout: "", stderr: `unsupported: ${joined}`, code: 1 };
  }
}

describe("worktree operations", () => {
  it("creates managed worktrees and moves changes with stash", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "pi-worktrees-test-"));
    const repoRoot = path.join(tmp, "repo");
    const storageHome = path.join(tmp, "store");
    await mkdir(repoRoot, { recursive: true });
    const runner = new FakeRunner(repoRoot);
    runner.dirtyPaths.add(repoRoot);

    const result = await Effect.runPromise(createWorktreeEffect(runner, {
      cwd: repoRoot,
      name: "Feature One",
      moveChanges: true,
      storageHome,
      now: new Date("2026-06-05T01:02:03.000Z")
    }));

    expect(result.name).toBe("feature-one-worktree-20260605");
    expect(result.branchName).toBe("wt/feature-one-worktree-20260605");
    expect(result.path).toBe(path.join(storageHome, "20260605010203", "feature-one-worktree-20260605"));
    expect(result.movedChanges).toBe(true);
    const callText = runner.calls.map((call) => call.join(" "));
    expect(callText.some((call) => call.startsWith(`git -C ${repoRoot} stash push -u -m pi-worktrees:feature-one-worktree-20260605:`))).toBe(true);

    const metadataPath = path.join(storageHome, ".meta", "20260605010203", "feature-one-worktree-20260605.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as { originalPath: string; worktreePath: string };
    expect(metadata).toEqual({
      version: 1,
      name: "feature-one-worktree-20260605",
      originalPath: repoRoot,
      worktreePath: result.path,
      storageTimestamp: "20260605010203",
      createdAt: "2026-06-05T01:02:03.000Z"
    });
  });

  it("deletes managed worktrees and metadata", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "pi-worktrees-delete-test-"));
    const repoRoot = path.join(tmp, "repo");
    const storageTimestamp = "20260605010203";
    const worktreeName = "feature-one-worktree-20260605";
    const worktreeRoot = path.join(tmp, "store", storageTimestamp, worktreeName);
    const metadataPath = path.join(tmp, "store", ".meta", storageTimestamp, `${worktreeName}.json`);
    await mkdir(path.dirname(metadataPath), { recursive: true });
    await writeFile(metadataPath, JSON.stringify({
      version: 1,
      name: worktreeName,
      originalPath: repoRoot,
      worktreePath: worktreeRoot,
      storageTimestamp,
      createdAt: "2026-06-05T01:02:03.000Z"
    }), "utf8");

    const runner = new FakeRunner(repoRoot);
    runner.worktrees = [repoRoot, worktreeRoot];

    const result = await Effect.runPromise(deleteWorktreeEffect(runner, { cwd: repoRoot, path: worktreeRoot, force: false, storageHome: path.join(tmp, "store") }));

    expect(result).toEqual({ path: worktreeRoot, wasDirty: false });
    expect(runner.calls.map((call) => call.join(" "))).toContain(`git -C ${repoRoot} worktree remove ${worktreeRoot}`);
    await expect(readFile(metadataPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects deleting the current worktree", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "pi-worktrees-current-delete-test-"));
    const repoRoot = path.join(tmp, "repo");
    const runner = new FakeRunner(repoRoot);
    runner.worktrees = [repoRoot];

    await expect(Effect.runPromise(deleteWorktreeEffect(runner, { cwd: repoRoot, path: repoRoot, force: true, storageHome: path.join(tmp, "store") }))).rejects.toThrow("cannot delete the current worktree");
  });

  it("rejects deleting unmanaged worktrees", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "pi-worktrees-unmanaged-delete-test-"));
    const repoRoot = path.join(tmp, "repo");
    const unmanagedRoot = path.join(tmp, "other", "feature");
    const runner = new FakeRunner(repoRoot);
    runner.worktrees = [repoRoot, unmanagedRoot];

    await expect(Effect.runPromise(deleteWorktreeEffect(runner, { cwd: repoRoot, path: unmanagedRoot, force: true, storageHome: path.join(tmp, "store") }))).rejects.toThrow("only managed pi-worktrees worktrees can be deleted");
  });

  it("requires force before deleting dirty managed worktrees", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "pi-worktrees-dirty-delete-test-"));
    const repoRoot = path.join(tmp, "repo");
    const storageTimestamp = "20260605010203";
    const worktreeName = "feature-one-worktree-20260605";
    const worktreeRoot = path.join(tmp, "store", storageTimestamp, worktreeName);
    await mkdir(path.join(tmp, "store", ".meta", storageTimestamp), { recursive: true });

    const runner = new FakeRunner(repoRoot);
    runner.worktrees = [repoRoot, worktreeRoot];
    runner.dirtyPaths.add(worktreeRoot);

    await expect(Effect.runPromise(deleteWorktreeEffect(runner, { cwd: repoRoot, path: worktreeRoot, force: false, storageHome: path.join(tmp, "store") }))).rejects.toThrow("worktree has uncommitted changes");

    await Effect.runPromise(deleteWorktreeEffect(runner, { cwd: repoRoot, path: worktreeRoot, force: true, storageHome: path.join(tmp, "store") }));

    expect(runner.calls.map((call) => call.join(" "))).toContain(`git -C ${repoRoot} worktree remove --force ${worktreeRoot}`);
  });

  it("lists the original project when opened from a managed worktree", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "pi-worktrees-overlay-test-"));
    const repoRoot = path.join(tmp, "repo");
    const storageTimestamp = "20260605010203";
    const worktreeName = "feature-one-worktree-20260605";
    const worktreeRoot = path.join(tmp, "store", storageTimestamp, worktreeName);
    await mkdir(path.join(tmp, "store", ".meta", storageTimestamp), { recursive: true });
    await writeFile(path.join(tmp, "store", ".meta", storageTimestamp, `${worktreeName}.json`), JSON.stringify({
      version: 1,
      name: worktreeName,
      originalPath: repoRoot,
      worktreePath: worktreeRoot,
      storageTimestamp,
      createdAt: "2026-06-05T01:02:03.000Z"
    }), "utf8");

    const runner = new FakeRunner(repoRoot, worktreeRoot);
    runner.worktrees = [repoRoot, worktreeRoot];

    const data = await Effect.runPromise(getOverlayDataEffect(runner, worktreeRoot));

    expect(data.items.map((item) => item.path)).toEqual([worktreeRoot, repoRoot]);
    expect(data.items[0]).toMatchObject({ path: worktreeRoot, isCurrent: true, isManaged: true });
    expect(data.items[1]).toMatchObject({ path: repoRoot, isCurrent: false, isManaged: false });
  });

  it("returns to original project and can move changes back", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "pi-worktrees-return-test-"));
    const repoRoot = path.join(tmp, "repo");
    const storageTimestamp = "20260605010203";
    const worktreeName = "feature-one-worktree-20260605";
    const worktreeRoot = path.join(tmp, "store", storageTimestamp, worktreeName);
    await mkdir(path.join(tmp, "store", ".meta", storageTimestamp), { recursive: true });
    await writeFile(path.join(tmp, "store", ".meta", storageTimestamp, `${worktreeName}.json`), JSON.stringify({
      version: 1,
      name: worktreeName,
      originalPath: repoRoot,
      worktreePath: worktreeRoot,
      storageTimestamp,
      createdAt: "2026-06-05T01:02:03.000Z"
    }), "utf8");

    const runner = new FakeRunner(repoRoot, worktreeRoot);
    runner.dirtyPaths.add(worktreeRoot);

    const result = await Effect.runPromise(returnFromWorktreeEffect(runner, { cwd: worktreeRoot, moveChanges: true }));

    expect(result).toEqual({ originalPath: repoRoot, currentPath: worktreeRoot, movedChanges: true });
    const callText = runner.calls.map((call) => call.join(" "));
    expect(callText.some((call) => call.startsWith(`git -C ${worktreeRoot} stash push -u -m pi-worktrees-return:${worktreeName}:`))).toBe(true);
    expect(callText).toContain(`git -C ${repoRoot} stash pop`);
  });
});

function ok(stdout: string): CommandResult {
  return { stdout, stderr: "", code: 0 };
}
