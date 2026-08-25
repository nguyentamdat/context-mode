import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

type Usage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: { total?: number };
};

type Run = {
  startedAt: number;
  turns: number;
  toolCalls: number;
  toolErrors: number;
  tools: Record<string, number>;
  toolDurationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
};

const telemetryDir = join(homedir(), ".pi", "agent", "telemetry", "events");
const day = (time = Date.now()) => new Date(time).toISOString().slice(0, 10);
const safeProject = (cwd: string) => basename(cwd) || "root";

/** Writes metadata only: never prompt text, tool arguments, tool output, paths, or source code. */
async function record(event: Record<string, unknown>) {
  await mkdir(telemetryDir, { recursive: true });
  await appendFile(join(telemetryDir, `${day()}.jsonl`), `${JSON.stringify(event)}\n`, "utf8");
}

function newRun(): Run {
  return { startedAt: Date.now(), turns: 0, toolCalls: 0, toolErrors: 0, tools: {}, toolDurationMs: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 };
}

function addUsage(run: Run, usage: Usage | undefined) {
  if (!usage) return;
  run.inputTokens += usage.input ?? 0;
  run.outputTokens += usage.output ?? 0;
  run.totalTokens += usage.totalTokens ?? 0;
  run.cost += usage.cost?.total ?? 0;
}

export default function (pi: ExtensionAPI) {
  let run: Run | undefined;
  const toolStarts = new Map<string, number>();
  let session = { id: "unknown", project: "unknown", model: "unknown", thinking: "unknown" };

  pi.on("session_start", async (_event, ctx) => {
    session = {
      id: ctx.sessionManager.getSessionId(),
      project: safeProject(ctx.cwd),
      model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown",
      thinking: ctx.thinkingLevel ?? "unknown",
    };
    await record({ type: "session_start", at: new Date().toISOString(), sessionId: session.id, project: session.project, model: session.model, thinking: session.thinking });
  });

  pi.on("model_select", async (event) => {
    session.model = `${event.model.provider}/${event.model.id}`;
    await record({ type: "model_select", at: new Date().toISOString(), sessionId: session.id, model: session.model, source: event.source });
  });

  pi.on("thinking_level_select", async (event) => {
    session.thinking = event.level;
    await record({ type: "thinking_select", at: new Date().toISOString(), sessionId: session.id, thinking: event.level });
  });

  pi.on("agent_start", () => {
    if (!run) run = newRun();
  });

  pi.on("turn_end", (event) => {
    if (!run) return;
    run.turns++;
    const message = event.message as { role?: string; usage?: Usage };
    if (message.role === "assistant") addUsage(run, message.usage);
    for (const result of event.toolResults) addUsage(run, (result as { usage?: Usage }).usage);
  });

  pi.on("tool_execution_start", (event) => {
    if (!run) run = newRun();
    toolStarts.set(event.toolCallId, Date.now());
    run.toolCalls++;
    run.tools[event.toolName] = (run.tools[event.toolName] ?? 0) + 1;
  });

  pi.on("tool_execution_end", (event) => {
    if (!run) return;
    const startedAt = toolStarts.get(event.toolCallId);
    if (startedAt) run.toolDurationMs += Date.now() - startedAt;
    toolStarts.delete(event.toolCallId);
    if (event.isError) run.toolErrors++;
  });

  pi.on("agent_settled", async () => {
    if (!run) return;
    const finished = run;
    run = undefined;
    await record({
      type: "run",
      at: new Date().toISOString(),
      sessionId: session.id,
      project: session.project,
      model: session.model,
      thinking: session.thinking,
      durationMs: Date.now() - finished.startedAt,
      turns: finished.turns,
      toolCalls: finished.toolCalls,
      toolErrors: finished.toolErrors,
      tools: finished.tools,
      toolDurationMs: finished.toolDurationMs,
      inputTokens: finished.inputTokens,
      outputTokens: finished.outputTokens,
      totalTokens: finished.totalTokens,
      cost: Number(finished.cost.toFixed(6)),
    });
  });

  pi.registerCommand("telemetry", {
    description: "Local telemetry: /telemetry done|partial|failed [lesson], or /telemetry report [days]",
    handler: async (args, ctx) => {
      const [action = "report", ...rest] = args.trim().split(/\s+/);
      if (["done", "partial", "failed"].includes(action)) {
        const lesson = rest.join(" ").slice(0, 500);
        await record({ type: "outcome", at: new Date().toISOString(), sessionId: session.id, project: session.project, outcome: action, lesson: lesson || undefined });
        ctx.ui.notify(`Telemetry saved: ${action}${lesson ? " + lesson" : ""}`, "info");
        return;
      }
      if (action !== "report") {
        ctx.ui.notify("Use: /telemetry done|partial|failed [lesson] | /telemetry report [days]", "warning");
        return;
      }
      const requestedDays = Math.max(1, Math.min(90, Number(rest[0]) || 7));
      const files = (await readdir(telemetryDir).catch(() => []))
        .filter((file) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)).sort().slice(-requestedDays);
      const events = (await Promise.all(files.map(async (file) => {
        const text = await readFile(join(telemetryDir, file), "utf8");
        return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      }))).flat();
      const runs = events.filter(event => event.type === "run");
      const outcomes = events.filter(event => event.type === "outcome");
      const cost = runs.reduce((sum, event) => sum + (Number(event.cost) || 0), 0);
      const tokens = runs.reduce((sum, event) => sum + (Number(event.totalTokens) || 0), 0);
      const errors = runs.reduce((sum, event) => sum + (Number(event.toolErrors) || 0), 0);
      const done = outcomes.filter(event => event.outcome === "done").length;
      ctx.ui.notify(`${requestedDays}d: ${runs.length} runs | ${tokens.toLocaleString()} tokens | $${cost.toFixed(2)} | ${errors} tool errors | outcomes ${done}/${outcomes.length} done`, "info");
    },
  });
}
