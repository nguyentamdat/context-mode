import { describe, expect, it } from "vitest";

import { parseWorktreePorcelain } from "./index.js";

describe("git porcelain parser", () => {
  it("parses branches, detached state, and prunable flags", () => {
    const worktrees = parseWorktreePorcelain(`worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\nworktree /repo-linked\nHEAD def456\ndetached\nprunable gitdir file points to non-existent location\n`);

    expect(worktrees).toEqual([
      {
        path: "/repo",
        head: "abc123",
        branch: "main",
        isBare: false,
        isDetached: false,
        isPrunable: false
      },
      {
        path: "/repo-linked",
        head: "def456",
        branch: undefined,
        isBare: false,
        isDetached: true,
        isPrunable: true
      }
    ]);
  });
});
