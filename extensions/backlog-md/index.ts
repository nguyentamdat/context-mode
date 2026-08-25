import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, DynamicBorder } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Container, type SelectItem, SelectList, Text, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { parseTaskList, type BacklogTask } from "./parser.ts";

const ACTIONS = ["list", "show", "create", "update"] as const;
const STATUSES = ["To Do", "In Progress", "Done"] as const;
const STATUS_ICON: Record<BacklogTask["status"], string> = { "To Do": "○", "In Progress": "◐", "Done": "✓" };
const globalConfigPath = join(homedir(), ".pi", "agent", "backlog-md.json");

type GlobalConfig = { repo?: string; folder?: string };
type ProjectConfig = { folder?: string };
type BacklogSource = { cwd: string; label: "project" | "global" };

class TaskViewer {
  private top = 0;
  private readonly pageSize = 18;

  constructor(
    private readonly title: string,
    private readonly content: string,
    private readonly close: () => void,
    private readonly requestRender: () => void,
  ) {}

  render(width: number): string[] {
    const lines = wrapTextWithAnsi(this.content, Math.max(1, width - 2));
    const maxTop = Math.max(0, lines.length - this.pageSize);
    this.top = Math.min(this.top, maxTop);
    const shown = lines.slice(this.top, this.top + this.pageSize).map(line => ` ${line}`);
    return [
      truncateToWidth(this.title, width),
      ...shown,
      `${this.top + 1}-${Math.min(this.top + this.pageSize, lines.length)}/${lines.length} · ↑↓ scroll · Esc close`,
    ];
  }

  invalidate() {}

  handleInput(data: string) {
    if (matchesKey(data, "escape")) return this.close();
    const delta = matchesKey(data, "up") ? -1
      : matchesKey(data, "down") ? 1
      : matchesKey(data, "pageup") ? -this.pageSize
      : matchesKey(data, "pagedown") || matchesKey(data, "space") ? this.pageSize
      : 0;
    if (matchesKey(data, "home")) this.top = 0;
    else if (matchesKey(data, "end")) this.top = Number.MAX_SAFE_INTEGER;
    else if (delta) this.top = Math.max(0, this.top + delta);
    else return;
    this.requestRender();
  }
}
function taskLabel(task: BacklogTask): string {
  return `${STATUS_ICON[task.status]} ${task.id} · ${task.title}`;
}

function sortTasks(tasks: BacklogTask[]): BacklogTask[] {
  return tasks.sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || a.id.localeCompare(b.id, undefined, { numeric: true }));
}


function text(result: { stdout: string; stderr: string; code: number }): string {
  if (result.code !== 0) throw new Error(result.stderr.trim() || `backlog exited with code ${result.code}`);
  return result.stdout.trim();
}

async function readJson<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {} as T;
    throw new Error(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeJson(path: string, value: object) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function projectConfigPath(cwd: string) {
  return join(cwd, CONFIG_DIR_NAME, "backlog-md.json");
}

export default function backlogMdExtension(pi: ExtensionAPI) {
  async function run(args: string[], cwd: string, signal?: AbortSignal) {
    return pi.exec("backlog", args, { cwd, timeout: 15_000, signal });
  }

  async function git(args: string[], cwd: string, signal?: AbortSignal) {
    const result = await pi.exec("git", args, { cwd, timeout: 30_000, signal });
    if (result.code !== 0) throw new Error(result.stderr.trim() || `git exited with code ${result.code}`);
  }

  async function pushGlobal(backlog: BacklogSource, signal?: AbortSignal) {
    if (backlog.label === "global") await git(["push"], backlog.cwd, signal);
  }
  async function globalConfig() {
    return readJson<GlobalConfig>(globalConfigPath);
  }

  async function projectConfig(ctx: ExtensionContext) {
    if (!ctx.isProjectTrusted()) return {} as ProjectConfig;
    return readJson<ProjectConfig>(projectConfigPath(ctx.cwd));
  }

  async function syncGlobal(): Promise<BacklogSource | undefined> {
    const config = await globalConfig();
    if (!config.repo) return undefined;
    const folder = resolve(config.folder ?? join(homedir(), ".pi", "backlog"));
    if (await exists(join(folder, ".git"))) {
      await git(["pull", "--ff-only"], folder);
    } else {
      await mkdir(dirname(folder), { recursive: true });
      await git(["clone", config.repo, folder], dirname(folder));
    }
    return { cwd: folder, label: "global" };
  }

  async function projectSource(ctx: ExtensionContext): Promise<BacklogSource | undefined> {
    const config = await projectConfig(ctx);
    if (!config.folder) return undefined;
    const folder = resolve(ctx.cwd, config.folder);
    return { cwd: folder, label: "project" };
  }

  async function source(ctx: ExtensionContext): Promise<BacklogSource> {
    const project = await projectSource(ctx);
    if (project) {
      try {
        await list(project);
        return project;
      } catch {
        // An unavailable project backlog intentionally falls back to global.
      }
    }
    const global = await syncGlobal();
    if (global) return global;
    throw new Error("No configured project backlog and no global backlog. Use /backlog config global <git-url> or /backlog config project <folder>.");
  }

  async function list(backlog: BacklogSource, signal?: AbortSignal): Promise<BacklogTask[]> {
    const output = text(await run(["task", "list", "--plain"], backlog.cwd, signal));
    return sortTasks(parseTaskList(output));
  }

  async function show(backlog: BacklogSource, id: string, signal?: AbortSignal): Promise<string> {
    return text(await run(["task", "view", id, "--plain"], backlog.cwd, signal));
  }

  async function configuredSource(ctx: ExtensionContext, signal?: AbortSignal) {
    const backlog = await source(ctx);
    return { backlog, tasks: await list(backlog, signal) };
  }

  pi.on("session_start", async (_event, ctx) => {
    try {
      const global = await syncGlobal();
      const project = await projectSource(ctx);
      if (project) {
        try {
          await list(project);
          ctx.ui.setStatus("backlog", "project backlog");
          return;
        } catch {
          // Fall back to the already-synced global backlog.
        }
      }
      ctx.ui.setStatus("backlog", global ? "global backlog" : undefined);
    } catch {
      ctx.ui.setStatus("backlog", undefined);
    }
  });
  async function selectTask(ctx: ExtensionCommandContext, title: string, tasks: BacklogTask[]) {
    if (ctx.mode !== "tui") {
      const choice = await ctx.ui.select(title, tasks.map(taskLabel));
      return tasks.find(task => taskLabel(task) === choice);
    }
    const items: SelectItem[] = tasks.map(task => ({ value: task.id, label: taskLabel(task) }));
    const id = await ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
      const container = new Container();
      container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
      container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
      const list = new SelectList(items, Math.min(items.length, 12), {
        selectedPrefix: (value) => theme.fg("accent", value),
        selectedText: (value) => theme.fg("accent", value),
        scrollInfo: (value) => theme.fg("dim", value),
        noMatch: (value) => theme.fg("warning", value),
      });
      list.onSelect = (item) => done(item.value);
      list.onCancel = () => done(undefined);
      container.addChild(list);
      container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel"), 1, 0));
      container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
      return {
        render: (width) => container.render(width),
        invalidate: () => container.invalidate(),
        handleInput: (data) => { list.handleInput(data); tui.requestRender(); },
      };
    });
    return tasks.find(task => task.id === id);
  }

  async function viewTask(ctx: ExtensionCommandContext, title: string, details: string) {
    if (ctx.mode !== "tui") {
      ctx.ui.notify(details, "info");
      return;
    }
    await ctx.ui.custom<void>((tui, _theme, _keybindings, done) =>
      new TaskViewer(title, details, () => done(), () => tui.requestRender()),
    );
  }

  async function openTaskPicker(ctx: ExtensionCommandContext) {
    const { backlog, tasks } = await configuredSource(ctx);
    if (!tasks.length) {
      ctx.ui.notify(`No tasks in ${backlog.label} backlog.`, "info");
      return;
    }
    while (true) {
      const task = await selectTask(ctx, `${backlog.label} backlog tasks`, tasks);
      if (!task) return;
      const details = await show(backlog, task.id);
      await viewTask(ctx, `${task.id} · ${task.title}`, details);
    }
  }

  async function createTask(ctx: ExtensionCommandContext) {
    const title = await ctx.ui.input("New task title:");
    if (!title?.trim()) return;
    const description = await ctx.ui.editor("Description (optional):", "");
    const backlog = await source(ctx);
    const args = ["task", "create", title.trim(), "--plain"];
    if (description?.trim()) args.push("--description", description.trim());
    const output = text(await run(args, backlog.cwd));
    await pushGlobal(backlog);
    ctx.ui.notify(`${backlog.label}: ${output}`, "info");
  }

  async function updateTask(ctx: ExtensionCommandContext) {
    const { backlog, tasks } = await configuredSource(ctx);
    const task = await selectTask(ctx, "Choose task to update:", tasks);
    if (!task) return;
    const field = await ctx.ui.select("Update:", ["Status", "Title"]);
    if (!field) return;
    const args = ["task", "edit", task.id, "--plain"];
    if (field === "Status") {
      const status = await ctx.ui.select("Status:", [...STATUSES]);
      if (!status) return;
      args.push("--status", status);
    } else {
      const title = await ctx.ui.input("Title:", task.title);
      if (!title?.trim()) return;
      args.push("--title", title.trim());
    }
    const output = text(await run(args, backlog.cwd));
    await pushGlobal(backlog);
    ctx.ui.notify(`${backlog.label}: ${output}`, "info");
  }

  async function openBacklogMenu(ctx: ExtensionCommandContext) {
    const choice = await ctx.ui.select("Backlog", ["Browse tasks", "Create task", "Update task", "Configure", "Status"]);
    if (choice === "Browse tasks") return openTaskPicker(ctx);
    if (choice === "Create task") return createTask(ctx);
    if (choice === "Update task") return updateTask(ctx);
    if (choice === "Configure") return configure("", ctx);
    if (choice === "Status") return configure("status", ctx);
  }

  async function configure(args: string, ctx: ExtensionCommandContext) {
    const [scope, value] = args.trim().split(/\s+/, 2);
    if (!scope) {
      const choice = await ctx.ui.select("Backlog configuration", ["Global Git repository", "Project backlog folder", "Clear project backlog", "Status"]);
      if (choice === "Global Git repository") {
        const config = await globalConfig();
        const repo = await ctx.ui.input("Global Git repository:", config.repo ?? "");
        if (repo?.trim()) return configure(`global ${repo.trim()}`, ctx);
        return;
      }
      if (choice === "Project backlog folder") {
        const config = await projectConfig(ctx);
        const folder = await ctx.ui.input("Project backlog folder:", config.folder ?? "backlog");
        if (folder?.trim()) return configure(`project ${folder.trim()}`, ctx);
        return;
      }
      if (choice === "Clear project backlog") return configure("clear-project", ctx);
      if (choice === "Status") return configure("status", ctx);
      return;
    }
    if (scope === "global" && value) {
      const config = await globalConfig();
      await writeJson(globalConfigPath, { ...config, repo: value });
      await syncGlobal();
      ctx.ui.notify("Global backlog connected.", "info");
      return;
    }
    if (scope === "project" && value) {
      if (!ctx.isProjectTrusted()) throw new Error("Trust the project before configuring its backlog.");
      const folder = resolve(ctx.cwd, value);
      await writeJson(projectConfigPath(ctx.cwd), { folder: relative(ctx.cwd, folder) || "." });
      ctx.ui.notify(`Project backlog: ${relative(ctx.cwd, folder) || "."}`, "info");
      return;
    }
    if (scope === "clear-project") {
      if (!ctx.isProjectTrusted()) throw new Error("Trust the project before changing its backlog.");
      await writeJson(projectConfigPath(ctx.cwd), {});
      ctx.ui.notify("Project backlog cleared; using global backlog.", "info");
      return;
    }
    if (scope === "status") {
      const project = await projectConfig(ctx);
      const global = await globalConfig();
      ctx.ui.notify(`Project: ${project.folder ?? "not configured"}\nGlobal: ${global.repo ?? "not configured"}`, "info");
      return;
    }
    ctx.ui.notify("Usage: /backlog config global <git-url> | project <folder> | clear-project | status", "info");
  }

  pi.registerCommand("backlog", {
    description: "Browse the project backlog, falling back to the configured global Git backlog",
    handler: async (args, ctx) => {
      try {
        if (!ctx.hasUI) return;
        if (!args.trim()) return openBacklogMenu(ctx);
        if (args.trim().startsWith("config")) return configure(args.trim().slice("config".length), ctx);
        const [command, id] = args.trim().split(/\s+/, 2);
        if (command === "list") {
          const { backlog, tasks } = await configuredSource(ctx);
          ctx.ui.notify(`${backlog.label}:\n${tasks.map(task => `${task.id} ${task.title}`).join("\n") || "No tasks"}`, "info");
          return;
        }
        if (command === "show" && id) {
          await viewTask(ctx, id, await show(await source(ctx), id));
          return;
        }
        ctx.ui.notify("Usage: /backlog, /backlog list, /backlog show TASK-1, /backlog config ...", "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerTool({
    name: "backlog_tasks",
    label: "Backlog Tasks",
    description: "Manage the configured project backlog, falling back to the global Git backlog.",
    promptSnippet: "Manage the project backlog, falling back to the global Git backlog",
    parameters: Type.Object({
      action: StringEnum(ACTIONS),
      id: Type.Optional(Type.String({ description: "Task ID, such as TASK-26" })),
      title: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
      status: Type.Optional(StringEnum(STATUSES)),
      priority: Type.Optional(Type.String()),
      type: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const backlog = await source(ctx);
      if (params.action === "list") {
        return { content: [{ type: "text", text: JSON.stringify(await list(backlog, signal), null, 2) }], details: { source: backlog.label } };
      }
      if (params.action === "show") {
        if (!params.id) throw new Error("id is required for show");
        return { content: [{ type: "text", text: await show(backlog, params.id, signal) }], details: { source: backlog.label } };
      }
      if (params.action === "create") {
        if (!params.title?.trim()) throw new Error("title is required for create");
        const args = ["task", "create", params.title.trim(), "--plain"];
        if (params.description) args.push("--description", params.description);
        if (params.status) args.push("--status", params.status);
        if (params.priority) args.push("--priority", params.priority);
        if (params.type) args.push("--type", params.type);
        const output = text(await run(args, backlog.cwd, signal));
        await pushGlobal(backlog, signal);
        return { content: [{ type: "text", text: output }], details: { source: backlog.label } };
      }
      if (!params.id) throw new Error("id is required for update");
      const args = ["task", "edit", params.id, "--plain"];
      if (params.title) args.push("--title", params.title);
      if (params.description) args.push("--description", params.description);
      if (params.status) args.push("--status", params.status);
      if (params.priority) args.push("--priority", params.priority);
      if (params.type) args.push("--type", params.type);
      const output = text(await run(args, backlog.cwd, signal));
      await pushGlobal(backlog, signal);
      return { content: [{ type: "text", text: output }], details: { source: backlog.label } };
    },
  });
}
