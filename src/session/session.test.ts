import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { createInheritedSession } from "./index.js";

class FakeSessionSource {
  constructor(
    private readonly sessionFile: string,
    private readonly entries: SessionEntry[]
  ) {}

  getSessionFile(): string {
    return this.sessionFile;
  }

  getEntries(): SessionEntry[] {
    return this.entries;
  }
}

describe("session inheritance", () => {
  it("creates a target session with current entries and new cwd", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "pi-worktrees-session-test-"));
    const targetPath = path.join(tmp, "worktree");
    const sourcePath = path.join(tmp, "source.jsonl");
    const entry: SessionEntry = {
      type: "custom",
      id: "entry-1",
      parentId: null,
      timestamp: "2026-06-05T01:02:03.000Z",
      customType: "pi-worktrees-test",
      data: { ready: true }
    };

    const sessionPath = await createInheritedSession(new FakeSessionSource(sourcePath, [entry]), targetPath, path.join(tmp, "sessions"));

    expect(sessionPath).toBeDefined();
    const content = await readFile(sessionPath ?? "", "utf8");
    const lines = content.trim().split("\n").map((line) => JSON.parse(line) as { type: string; cwd?: string; parentSession?: string; customType?: string });

    expect(lines[0]).toMatchObject({ type: "session", cwd: targetPath, parentSession: sourcePath });
    expect(lines[1]).toMatchObject({ type: "custom", customType: "pi-worktrees-test" });
  });
});
