import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";

const DEFAULT_MAX_CONTEXT_CHARS = 20_000;
const OUTPUT_DIR = join(tmpdir(), "pi-tool-output");
type OutputChars = { chars: number };
type TurnUsage = { input: number; output: number; cached: number };

function configuredThreshold(cwd: string): number {
  let value = DEFAULT_MAX_CONTEXT_CHARS;
  const paths = [
    join(homedir(), ".pi", "tool-output-chars.json"),
    join(homedir(), ".pi", "tool-output-chars.yaml"),
    join(homedir(), ".pi", "tool-output-chars.yml"),
    join(cwd, ".pi", "tool-output-chars.json"),
    join(cwd, ".pi", "tool-output-chars.yaml"),
    join(cwd, ".pi", "tool-output-chars.yml"),
  ];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      const source = readFileSync(path, "utf8");
      const candidate = path.endsWith(".json")
        ? (JSON.parse(source) as { maxContextChars?: unknown }).maxContextChars
        : source.match(/^\s*maxContextChars\s*:\s*(\d+)/m)?.[1];
      if (typeof candidate === "number" && candidate > 0) value = candidate;
      if (typeof candidate === "string" && /^\d+$/.test(candidate) && Number(candidate) > 0) value = Number(candidate);
    } catch { /* Ignore invalid optional config. */ }
  }
  const env = Number(process.env.PI_TOOL_OUTPUT_MAX_CHARS);
  return env > 0 ? env : value;
}

function textFrom(content: unknown[]): string {
  return content
    .filter((block): block is { type: "text"; text: string } =>
      typeof block === "object" && block !== null &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("");
}

export default function (pi: ExtensionAPI) {
  pi.registerEntryRenderer<OutputChars | TurnUsage>("tool-output-chars", (entry, _options, theme) => {
    const data = entry.data as OutputChars | TurnUsage | undefined;
    const text = data && "chars" in data
      ? `↳ ${data.chars.toLocaleString()} chars`
      : data && "input" in data
        ? `↳ turn usage: in ${data.input.toLocaleString()} · out ${data.output.toLocaleString()} · cached ${data.cached.toLocaleString()}`
        : "↳ turn usage: unavailable";
    return new Text(theme.fg("dim", text), 0, 0);
  });
  pi.on("turn_end", (event) => {
    const usage = (event.message as { usage?: { input?: number; output?: number; cacheRead?: number } }).usage;
    if (!usage) return;
    pi.appendEntry("tool-output-chars", {
      input: usage.input ?? 0,
      output: usage.output ?? 0,
      cached: usage.cacheRead ?? 0,
    });
  });

  pi.on("tool_result", async (event, ctx) => {
    const text = textFrom(event.content);
    const chars = Array.from(text).length;
    const details = event.details && typeof event.details === "object" ? { ...event.details, toolOutputChars: chars } : { toolOutputChars: chars };
    if (chars <= configuredThreshold(ctx.cwd)) return { details };

    await mkdir(OUTPUT_DIR, { recursive: true });
    const path = join(OUTPUT_DIR, `${event.toolName}-${randomUUID()}.txt`);
    await writeFile(path, text, { mode: 0o600 });
    return {
      content: [{
        type: "text" as const,
        text: `Tool output (${chars.toLocaleString()} chars) was saved outside context: ${path}\nUse Context Mode's ctx_execute_file to extract only the needed findings.`,
      }],
      details,
    };
  });
}
