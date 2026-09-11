import { describe, expect, it } from "vitest";

import { parseArgs } from "./index.js";

describe("command args", () => {
  it("opens the overlay by default", () => {
    expect(parseArgs("")).toEqual({ action: "overlay", moveChanges: false });
  });

  it("parses create commands with names and move flags", () => {
    expect(parseArgs("create Feature One --move")).toEqual({
      action: "create",
      name: "Feature One",
      moveChanges: true
    });
  });

  it("parses aliases for create, delete, and return", () => {
    expect(parseArgs("new quick-fix -m")).toEqual({ action: "create", name: "quick-fix", moveChanges: true });
    expect(parseArgs("rm /tmp/worktree")).toEqual({ action: "delete", targetPath: "/tmp/worktree", moveChanges: false });
    expect(parseArgs("back --move")).toEqual({ action: "return", moveChanges: true });
  });
});
