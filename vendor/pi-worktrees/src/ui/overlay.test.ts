import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import type { WorktreeStatus } from "../git/index.js";
import { WorktreeOverlay, type WorktreeAction } from "./overlay.js";

class FakeTui {
  renderCount = 0;

  requestRender(): void {
    this.renderCount += 1;
  }
}

const theme = {
  fg: (_color: string, text: string): string => text
} as Theme;

const worktree: WorktreeStatus = {
  path: "/repo/feature-one-worktree-20260605",
  head: "abc123",
  branch: "feature-one",
  isBare: false,
  isDetached: false,
  isPrunable: false,
  isCurrent: false,
  isManaged: true,
  isDirty: true
};

describe("worktree overlay", () => {
  it("renders a compact dialog with shortcut badges", () => {
    const overlay = new WorktreeOverlay(new FakeTui(), theme, {
      items: [worktree]
    }, () => undefined);

    const text = overlay.render(80).join("\n");

    expect(text).toContain("Worktrees");
    expect(text).toContain("[Enter] Open");
    expect(text).toContain("[⌘N] New");
    expect(text).toContain("[D] Delete");
    expect(text).toContain("[dirty]");
    expect(text).not.toContain(worktree.path);
  });

  it("renders the original project as a regular list item", () => {
    const overlay = new WorktreeOverlay(new FakeTui(), theme, {
      items: [worktree, { ...worktree, path: "/repo", branch: "main", isDirty: false, isManaged: false }]
    }, () => undefined);

    const text = overlay.render(80).join("\n");

    expect(text).toContain("feature-one-worktree-20260605");
    expect(text).toContain("repo main [clean] [project]");
    expect(text).not.toContain("Back to original project");
  });

  it("returns switch actions for the selected worktree", () => {
    let action: WorktreeAction | undefined;
    const overlay = new WorktreeOverlay(new FakeTui(), theme, {
      items: [worktree]
    }, (result) => {
      action = result;
    });

    overlay.handleInput("\r");

    expect(action).toEqual({ type: "switch", path: worktree.path });
  });

  it("asks for confirmation before deleting the selected worktree", () => {
    let action: WorktreeAction | undefined;
    const overlay = new WorktreeOverlay(new FakeTui(), theme, {
      items: [worktree]
    }, (result) => {
      action = result;
    });

    overlay.handleInput("d");
    const text = overlay.render(80).join("\n");

    expect(action).toBeUndefined();
    expect(text).toContain("Delete worktree?");
    expect(text).toContain("[Enter] Delete");
  });

  it("cancels delete confirmation with escape", () => {
    let action: WorktreeAction | undefined;
    const overlay = new WorktreeOverlay(new FakeTui(), theme, {
      items: [worktree]
    }, (result) => {
      action = result;
    });

    overlay.handleInput("d");
    overlay.handleInput("\u001b");
    const text = overlay.render(80).join("\n");

    expect(action).toBeUndefined();
    expect(text).not.toContain("Delete worktree?");
  });

  it("does not offer delete for unmanaged project items", () => {
    let action: WorktreeAction | undefined;
    const overlay = new WorktreeOverlay(new FakeTui(), theme, {
      items: [{ ...worktree, path: "/repo", isManaged: false }]
    }, (result) => {
      action = result;
    });

    overlay.handleInput("d");

    expect(action).toBeUndefined();
    expect(overlay.render(80).join("\n")).not.toContain("Delete worktree?");
  });

  it("does not offer delete for the current worktree", () => {
    let action: WorktreeAction | undefined;
    const overlay = new WorktreeOverlay(new FakeTui(), theme, {
      items: [{ ...worktree, isCurrent: true }]
    }, (result) => {
      action = result;
    });

    overlay.handleInput("d");

    expect(action).toBeUndefined();
    expect(overlay.render(80).join("\n")).not.toContain("Delete worktree?");
  });

  it("returns delete actions after confirmation", () => {
    let action: WorktreeAction | undefined;
    const overlay = new WorktreeOverlay(new FakeTui(), theme, {
      items: [worktree]
    }, (result) => {
      action = result;
    });

    overlay.handleInput("d");
    overlay.handleInput("\r");

    expect(action).toEqual({ type: "delete", path: worktree.path, confirmed: true });
  });

  it("opens create mode from the new shortcut", () => {
    const tui = new FakeTui();
    const overlay = new WorktreeOverlay(tui, theme, {
      items: [worktree]
    }, () => undefined);

    overlay.handleInput("n");
    const text = overlay.render(80).join("\n");

    expect(tui.renderCount).toBe(1);
    expect(text).toContain("Name");
    expect(text).toContain("[Enter] Create");
  });
});
