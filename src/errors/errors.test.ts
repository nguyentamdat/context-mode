import { describe, expect, it } from "vitest";

import { errorToMessage, formatError, formatWorktreeError } from "./index.js";

describe("errors", () => {
  it("formats git errors with command details", () => {
    const message = formatWorktreeError({
      type: "git",
      command: "git",
      args: ["-C", "/repo", "status"],
      code: 128,
      stderr: "not a git repository",
      message: "failed"
    });

    expect(message).toBe("git -C /repo status failed: not a git repository");
  });

  it("keeps validation messages readable", () => {
    expect(formatWorktreeError({ type: "validation", message: "name is required" })).toBe("name is required");
  });

  it("converts common error values to messages", () => {
    expect(errorToMessage(new Error("boom"))).toBe("boom");
    expect(errorToMessage("plain text")).toBe("plain text");
    expect(errorToMessage(null)).toBe("unexpected error");
  });

  it("formats unknown runtime errors for the UI", () => {
    expect(formatError(new Error("boom"))).toBe("boom");
    expect(formatError({ type: "validation", message: "bad path" })).toBe("bad path");
    expect(formatError(null)).toBe("pi-worktrees failed");
  });
});
