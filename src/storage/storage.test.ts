import path from "node:path";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { getManagedPaths, getWorktreePath, normalizeWorktreeName, readMetadataEffect } from "./index.js";

describe("storage", () => {
  it("normalizes optional kebab-case names into dated worktree directories", () => {
    const now = new Date("2026-06-05T01:02:03.000Z");

    expect(normalizeWorktreeName(" Feature/Add Search ", now).name).toBe("feature-add-search-worktree-20260605");
    expect(normalizeWorktreeName("Quick Review Notes", now).name).toBe("quick-review-notes-worktree-20260605");
  });

  it("generates a random-name worktree when omitted", () => {
    const result = normalizeWorktreeName(undefined, new Date("2026-06-05T01:02:03.000Z"), "fresh branch");

    expect(result).toEqual({ name: "fresh-branch-worktree-20260605", isGenerated: true, storageTimestamp: "20260605010203" });
  });

  it("rejects names without letters or numbers", () => {
    expect(() => normalizeWorktreeName("---")).toThrow("worktree name");
  });

  it("builds managed paths below storage home", () => {
    const storageHome = path.resolve("/tmp/pi-worktrees-home");
    const paths = getManagedPaths("/repos/My App", storageHome);
    const targetPath = getWorktreePath(paths, "feature-one-worktree-20260605", "20260605010203");

    expect(paths.managedRoot).toBe(storageHome);
    expect(targetPath).toBe(path.join(paths.managedRoot, "20260605010203", "feature-one-worktree-20260605"));
  });

  it("reads legacy metadata without storage timestamps", async () => {
    const filePath = "/tmp/pi-worktrees-home/.meta/20260605010203/feature-one-worktree-20260605.json";
    const content = JSON.stringify({
      version: 1,
      name: "feature-one-worktree-20260605",
      originalPath: "/repo",
      worktreePath: "/tmp/pi-worktrees-home/20260605010203/feature-one-worktree-20260605",
      createdAt: "2026-06-05T01:02:03.000Z"
    });

    const metadata = await Effect.runPromise(readMetadataEffect(async () => content, filePath));

    expect(metadata).toEqual({
      version: 1,
      name: "feature-one-worktree-20260605",
      originalPath: "/repo",
      worktreePath: "/tmp/pi-worktrees-home/20260605010203/feature-one-worktree-20260605",
      storageTimestamp: "20260605010203",
      createdAt: "2026-06-05T01:02:03.000Z"
    });
  });
});
