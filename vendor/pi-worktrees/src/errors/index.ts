export type WorktreeError =
  | {
      type: "git";
      command: string;
      args: string[];
      code: number;
      message: string;
      stderr: string;
    }
  | {
      type: "fs";
      path: string;
      message: string;
    }
  | {
      type: "validation";
      message: string;
    };

export function errorToMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  return "unexpected error";
}

export function formatError(value: unknown): string {
  const error = toWorktreeError(value);
  if (error) {
    return formatWorktreeError(error);
  }

  const message = errorToMessage(value);
  return message === "unexpected error" ? "pi-worktrees failed" : message;
}

export function formatWorktreeError(error: WorktreeError): string {
  if (error.type !== "git") {
    return error.message;
  }

  const detail = error.stderr || error.message;
  return `git ${error.args.join(" ")} failed: ${detail}`;
}

function toWorktreeError(value: unknown): WorktreeError | undefined {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return undefined;
  }

  const type = value.type;
  if (type === "git" || type === "fs" || type === "validation") {
    return value as WorktreeError;
  }

  return undefined;
}
