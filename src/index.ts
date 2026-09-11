import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";

import type { CommandRunner, WorktreeStatus } from "./git/index.js";
import { hasChangesEffect } from "./git/index.js";
import { formatError } from "./errors/index.js";
import { WorktreeOverlay, type WorktreeAction } from "./ui/overlay.js";
import { switchToWorktreeSession } from "./session/index.js";
import { createWorktreeEffect, deleteWorktreeEffect, getOverlayDataEffect, returnFromWorktreeEffect } from "./worktree/index.js";

type ParsedArgs =
  | { action: "overlay"; moveChanges: boolean }
  | { action: "create"; moveChanges: boolean; name?: string }
  | { action: "delete"; moveChanges: boolean; targetPath?: string }
  | { action: "return"; moveChanges: boolean };

export default function piWorktreeExtension(pi: ExtensionAPI): void {
  pi.registerCommand("wt", {
    description: "Create, return, and switch managed git worktrees",
    getArgumentCompletions: (prefix) => {
      const options = ["create", "delete", "return", "--move"];
      return options.filter((option) => option.startsWith(prefix)).map((value) => ({ value, label: value }));
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const runner = createPiRunner(pi);
      const parsed = parseArgs(args);

      try {
        if (parsed.action === "create") {
          await createAndSwitch(runner, ctx, parsed.name, parsed.moveChanges);
          return;
        }

        if (parsed.action === "return") {
          await returnAndSwitch(runner, ctx, parsed.moveChanges);
          return;
        }

        if (parsed.action === "delete") {
          await deleteWorktree(runner, ctx, parsed.targetPath);
          return;
        }

        await runOverlay(runner, ctx);
      } catch (error) {
        ctx.ui.notify(formatError(error), "error");
      }
    }
  });
}

export function parseArgs(args: string): ParsedArgs {
  const parts = args.split(/\s+/).map((part) => part.trim()).filter((part) => part.length > 0);
  const moveChanges = parts.includes("--move") || parts.includes("-m");
  const positional = parts.filter((part) => part !== "--move" && part !== "-m");
  const action = positional[0];

  if (action === "create" || action === "new") {
    return { action: "create", name: positional.slice(1).join(" ") || undefined, moveChanges };
  }

  if (action === "return" || action === "back") {
    return { action: "return", moveChanges };
  }

  if (action === "delete" || action === "remove" || action === "rm") {
    return { action: "delete", targetPath: positional.slice(1).join(" ") || undefined, moveChanges };
  }

  return { action: "overlay", moveChanges };
}

function createPiRunner(pi: ExtensionAPI): CommandRunner {
  return { exec: (command, args) => pi.exec(command, args) };
}

async function runOverlay(runner: CommandRunner, ctx: ExtensionCommandContext): Promise<void> {
  const data = await Effect.runPromise(getOverlayDataEffect(runner, ctx.cwd));

  if (ctx.mode !== "tui") {
    await runNonTuiPicker(runner, ctx, data.items, data.returnMetadata?.originalPath);
    return;
  }

  const action = await ctx.ui.custom<WorktreeAction | undefined>(
    (tui, theme, _keybindings, done) => new WorktreeOverlay(tui, theme, {
      items: data.items
    }, done),
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: 68,
        minWidth: 42,
        maxHeight: "70%",
        margin: 2,
        visible: (termWidth: number) => termWidth >= 44
      }
    }
  );

  if (!action || action.type === "cancel") {
    return;
  }

  await applyAction(runner, ctx, action, data.returnMetadata?.originalPath);
}

async function runNonTuiPicker(runner: CommandRunner, ctx: ExtensionCommandContext, items: WorktreeStatus[], originalPath: string | undefined): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/wt needs TUI or interactive UI", "warning");
    return;
  }

  const choices = items.map((item) => `${item.isCurrent ? "*" : " "} ${item.branch ?? "detached"} ${item.path}`);
  const choice = await ctx.ui.select("Managed worktrees", choices);
  if (!choice) {
    return;
  }

  const index = choices.indexOf(choice);
  const item = items[index];
  if (!item) {
    return;
  }

  if (originalPath && item.path === originalPath) {
    await returnAndSwitch(runner, ctx, false);
    return;
  }

  await switchToWorktreeSession(ctx, item.path);
}

async function applyAction(runner: CommandRunner, ctx: ExtensionCommandContext, action: WorktreeAction, originalPath: string | undefined): Promise<void> {
  if (action.type === "switch") {
    if (originalPath && action.path === originalPath) {
      await returnAndSwitch(runner, ctx, false);
      return;
    }

    await switchToWorktreeSession(ctx, action.path);
    return;
  }

  if (action.type === "create") {
    await createAndSwitch(runner, ctx, action.name, false);
    return;
  }

  if (action.type === "delete") {
    await deleteWorktree(runner, ctx, action.path, action.confirmed);
  }
}

async function createAndSwitch(runner: CommandRunner, ctx: ExtensionCommandContext, name: string | undefined, preferredMoveChanges: boolean): Promise<void> {
  const moveChanges = await askMoveChanges(runner, ctx, "create", preferredMoveChanges);
  const result = await Effect.runPromise(createWorktreeEffect(runner, { cwd: ctx.cwd, name, moveChanges }));
  await switchToWorktreeSession(ctx, result.path);
}

async function returnAndSwitch(runner: CommandRunner, ctx: ExtensionCommandContext, preferredMoveChanges: boolean): Promise<void> {
  const moveChanges = await askMoveChanges(runner, ctx, "return", preferredMoveChanges);
  const result = await Effect.runPromise(returnFromWorktreeEffect(runner, { cwd: ctx.cwd, moveChanges }));
  await switchToWorktreeSession(ctx, result.originalPath);
}

async function deleteWorktree(runner: CommandRunner, ctx: ExtensionCommandContext, targetPath: string | undefined, confirmed = false): Promise<void> {
  if (!targetPath) {
    throw new Error("Select a worktree to delete");
  }

  const isDirty = await Effect.runPromise(hasChangesEffect(runner, targetPath));
  const detail = isDirty ? " This worktree has uncommitted changes." : "";
  const shouldDelete = confirmed || (ctx.hasUI && await ctx.ui.confirm("Delete worktree?", `This cannot be undone.${detail}`));
  if (!shouldDelete) {
    return;
  }

  await Effect.runPromise(deleteWorktreeEffect(runner, { cwd: ctx.cwd, path: targetPath, force: isDirty }));
  ctx.ui.notify(`Deleted ${targetPath}`, "info");
}

async function askMoveChanges(runner: CommandRunner, ctx: ExtensionCommandContext, action: "create" | "return", preferred: boolean): Promise<boolean> {
  const hasChanges = await Effect.runPromise(hasChangesEffect(runner, ctx.cwd));
  if (!hasChanges) {
    return false;
  }

  if (!ctx.hasUI) {
    return preferred;
  }

  const destination = action === "create" ? "to the new worktree" : "back to the original project";
  return ctx.ui.confirm(
    "Move changes?",
    `Move uncommitted changes ${destination}? Choose No to keep them here.`
  );
}

