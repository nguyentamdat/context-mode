import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { SessionManager, type ExtensionCommandContext, type SessionEntry } from "@earendil-works/pi-coding-agent";

export async function switchToWorktreeSession(ctx: ExtensionCommandContext, targetPath: string): Promise<void> {
  const sessionPath = await createInheritedSession(ctx.sessionManager, targetPath);
  if (!sessionPath) {
    throw new Error("could not create inherited pi session for worktree");
  }

  await ctx.switchSession(sessionPath, {
    withSession: async (nextCtx) => {
      nextCtx.ui.notify(`Session inherited in ${targetPath}`, "info");
    }
  });
}

interface SessionSource {
  getSessionFile(): string | undefined;
  getEntries(): SessionEntry[];
}

export async function createInheritedSession(source: SessionSource, targetPath: string, sessionDir?: string): Promise<string | undefined> {
  const currentSessionPath = source.getSessionFile();
  const targetSession = SessionManager.create(targetPath, sessionDir, { parentSession: currentSessionPath });
  const targetSessionPath = targetSession.getSessionFile();
  const targetHeader = targetSession.getHeader();

  if (!targetSessionPath || !targetHeader) {
    return undefined;
  }

  const lines = [targetHeader, ...source.getEntries()].map((entry) => JSON.stringify(entry));
  await mkdir(path.dirname(targetSessionPath), { recursive: true });
  await writeFile(targetSessionPath, `${lines.join("\n")}\n`, { encoding: "utf8", flag: "wx" });
  return targetSessionPath;
}
