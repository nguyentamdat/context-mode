import path from "node:path";

import { Effect } from "effect";

import type { WorktreeError } from "../errors/index.js";
import { errorToMessage } from "../errors/index.js";

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface CommandRunner {
  exec(command: string, args: string[]): Promise<CommandResult>;
}

export interface RepositoryInfo {
  root: string;
}

export interface GitWorktree {
  path: string;
  head: string;
  branch?: string;
  isBare: boolean;
  isDetached: boolean;
  isPrunable: boolean;
}

export interface WorktreeStatus extends GitWorktree {
  isCurrent: boolean;
  isManaged: boolean;
  isDirty: boolean;
}

export function getRepositoryEffect(runner: CommandRunner, cwd: string): Effect.Effect<RepositoryInfo, WorktreeError> {
  return Effect.map(
    runGitEffect(runner, cwd, ["rev-parse", "--show-toplevel"]),
    (root) => ({ root: path.resolve(root.stdout.trim()) })
  );
}

export function listWorktreesEffect(runner: CommandRunner, cwd: string): Effect.Effect<GitWorktree[], WorktreeError> {
  return Effect.map(runGitEffect(runner, cwd, ["worktree", "list", "--porcelain"]), (result) => parseWorktreePorcelain(result.stdout));
}

export function getBranchNameEffect(runner: CommandRunner, cwd: string): Effect.Effect<string, WorktreeError> {
  return Effect.gen(function* () {
    const branch = yield* runGitEffect(runner, cwd, ["branch", "--show-current"]);
    const name = branch.stdout.trim();
    if (name.length > 0) {
      return name;
    }

    const head = yield* runGitEffect(runner, cwd, ["rev-parse", "--short", "HEAD"]);
    return head.stdout.trim();
  });
}

export function hasChangesEffect(runner: CommandRunner, cwd: string): Effect.Effect<boolean, WorktreeError> {
  return Effect.map(runGitEffect(runner, cwd, ["status", "--porcelain=v1", "-uall"]), (result) => result.stdout.trim().length > 0);
}

export function createBranchWorktreeEffect(
  runner: CommandRunner,
  cwd: string,
  targetPath: string,
  branchName: string,
  startPoint = "HEAD"
): Effect.Effect<void, WorktreeError> {
  return Effect.asVoid(runGitEffect(runner, cwd, ["worktree", "add", "-b", branchName, targetPath, startPoint]));
}

export function removeWorktreeEffect(runner: CommandRunner, cwd: string, targetPath: string, force: boolean): Effect.Effect<void, WorktreeError> {
  const forceArgs = force ? ["--force"] : [];
  return Effect.asVoid(runGitEffect(runner, cwd, ["worktree", "remove", ...forceArgs, targetPath]));
}

export function stashPushEffect(runner: CommandRunner, cwd: string, message: string): Effect.Effect<void, WorktreeError> {
  return Effect.asVoid(runGitEffect(runner, cwd, ["stash", "push", "-u", "-m", message]));
}

export function stashPopEffect(runner: CommandRunner, cwd: string): Effect.Effect<void, WorktreeError> {
  return Effect.asVoid(runGitEffect(runner, cwd, ["stash", "pop"]));
}

export function runGitEffect(runner: CommandRunner, cwd: string, args: string[]): Effect.Effect<CommandResult, WorktreeError> {
  const fullArgs = ["-C", cwd, ...args];

  return Effect.flatMap(
    Effect.tryPromise({
      try: () => runner.exec("git", fullArgs),
      catch: (error) => ({
        type: "git",
        command: "git",
        args: fullArgs,
        code: 1,
        stderr: "",
        message: errorToMessage(error)
      })
    }),
    (result) => {
      if (result.code === 0) {
        return Effect.succeed(result);
      }

      return Effect.fail({
        type: "git",
        command: "git",
        args: fullArgs,
        code: result.code,
        stderr: result.stderr,
        message: result.stderr || result.stdout || `exit ${result.code}`
      });
    }
  );
}

export function parseWorktreePorcelain(stdout: string): GitWorktree[] {
  const worktrees: GitWorktree[] = [];
  const records = stdout.split(/\n\s*\n/).map((record) => record.trim()).filter((record) => record.length > 0);

  for (const record of records) {
    const lines = record.split("\n");
    const worktreeLine = lines.find((line) => line.startsWith("worktree "));
    const headLine = lines.find((line) => line.startsWith("HEAD "));
    if (!worktreeLine || !headLine) {
      continue;
    }

    const branchLine = lines.find((line) => line.startsWith("branch "));
    worktrees.push({
      path: path.resolve(worktreeLine.slice("worktree ".length)),
      head: headLine.slice("HEAD ".length),
      branch: branchLine ? branchLine.slice("branch ".length).replace(/^refs\/heads\//, "") : undefined,
      isBare: lines.some((line) => line.startsWith("bare")),
      isDetached: lines.some((line) => line.startsWith("detached")),
      isPrunable: lines.some((line) => line.startsWith("prunable"))
    });
  }

  return worktrees;
}
