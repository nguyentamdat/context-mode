import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const AGENT_DIR = join(process.env.HOME ?? "~", ".pi", "agent");
const USAGE_URL = (process.env.CHATGPT_BASE_URL ?? "https://chatgpt.com/backend-api").replace(/\/+$/, "") + "/wham/usage";
const STATUS_KEY = "codex-usage";
const REFRESH_MS = 5 * 60_000;
const CACHE_FILE = join(AGENT_DIR, "codex-usage-cache.json");

type Auth = { type?: string; access?: string; accountId?: string };
type Account = { provider: string; label: string; auth?: Auth };
type Usage = { provider: string; email: string; quotaLabel?: string; weekly?: number; weeklyResetsAt?: number; error?: string };
type Cache = Record<string, { cachedAt: number; usage: Usage }>;

function json(path: string): Record<string, unknown> {
  try { return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; } catch { return {}; }
}
function jwt(token: string): Record<string, unknown> {
  try { return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); } catch { return {}; }
}
function get(obj: unknown, key: string): Record<string, unknown> | undefined {
  return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>)[key] as Record<string, unknown> : undefined;
}
function emailFrom(auth: Auth): string {
  const payload = jwt(auth.access ?? "");
  const profile = get(payload, "https://api.openai.com/profile");
  return typeof profile?.email === "string" ? profile.email : "unknown";
}
function accounts(): Account[] {
  const auth = json(join(AGENT_DIR, "auth.json")) as Record<string, Auth>;
  const config = json(join(AGENT_DIR, "multi-pass.json"));
  const subs = Array.isArray(config.subscriptions) ? config.subscriptions : [];
  const configured = new Map<string, string>();
  configured.set("openai-codex", "default");
  for (const raw of subs) {
    const sub = raw as { provider?: string; index?: number; label?: string };
    if (sub.provider === "openai-codex" && typeof sub.index === "number") configured.set(`openai-codex-${sub.index}`, sub.label ?? `#${sub.index}`);
  }
  return [...configured].map(([provider, label]) => ({ provider, label, auth: auth[provider] }));
}
function remaining(value: unknown): number | undefined {
  const win = value as { used_percent?: unknown } | undefined;
  return typeof win?.used_percent === "number" ? Math.max(0, Math.round(100 - win.used_percent)) : undefined;
}
function resetAt(value: unknown): number | undefined {
  const reset = (value as { reset_at?: unknown } | undefined)?.reset_at;
  return typeof reset === "number" && Number.isFinite(reset) && reset > 0 ? reset : undefined;
}
function formatReset(epochSeconds: number | undefined): string {
  if (!epochSeconds) return "?";
  const date = new Date(epochSeconds * 1_000);
  if (Number.isNaN(date.getTime())) return "?";
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString() ? time : `${time} ${date.toLocaleDateString([], { day: "numeric", month: "short" })}`;
}
function cache(): Cache { return json(CACHE_FILE) as Cache; }
function saveCache(data: Cache): void { try { writeFileSync(CACHE_FILE, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 }); } catch {} }
async function fetchUsage(account: Account): Promise<Usage> {
  const cached = cache()[account.provider];
  if (cached?.usage.weekly !== undefined && Date.now() - cached.cachedAt < REFRESH_MS) return cached.usage;
  if (!account.auth?.access) return { provider: account.provider, email: account.label, error: "login" };
  const claims = jwt(account.auth.access);
  const authClaim = get(claims, "https://api.openai.com/auth");
  const accountId = account.auth.accountId ?? authClaim?.chatgpt_account_id;
  try {
    const response = await fetch(USAGE_URL, { headers: {
      Authorization: `Bearer ${account.auth.access}`, Accept: "application/json", "User-Agent": "pi-codex-usage-status",
      ...(typeof accountId === "string" ? { "chatgpt-account-id": accountId } : {}),
    }});
    if (!response.ok) return { provider: account.provider, email: emailFrom(account.auth), error: `HTTP ${response.status}` };
    const data = await response.json() as { email?: unknown; rate_limit?: { primary_window?: unknown; secondary_window?: unknown } };
    const windows = [data.rate_limit?.primary_window, data.rate_limit?.secondary_window].filter(Boolean) as Array<{ limit_window_seconds?: number; used_percent?: number; reset_at?: number }>;
    const quotaWindow = windows.find(w => Math.abs((w.limit_window_seconds ?? 0) - 604_800) <= 120)
      ?? windows.sort((a, b) => (b.limit_window_seconds ?? 0) - (a.limit_window_seconds ?? 0))[0];
    const seconds = quotaWindow?.limit_window_seconds;
    const quotaLabel = seconds && seconds % 86_400 === 0 ? `${seconds / 86_400}d` : "quota";
    const usage = { provider: account.provider, email: typeof data.email === "string" ? data.email : emailFrom(account.auth), quotaLabel, weekly: remaining(quotaWindow), weeklyResetsAt: resetAt(quotaWindow) };
    saveCache({ ...cache(), [account.provider]: { cachedAt: Date.now(), usage } });
    return usage;
  } catch (error) { return { provider: account.provider, email: emailFrom(account.auth), error: error instanceof Error ? error.message : "fetch failed" }; }
}
function renderAccount(r: Usage, activeProvider?: string): string {
  const active = r.provider === activeProvider ? "*" : "";
  const quota = r.error ? r.error : `${r.quotaLabel ?? "7d"}:${r.weekly ?? "?"}% ↻ ${formatReset(r.weeklyResetsAt)}`;
  return `${active}${r.email} ${quota}`;
}
function render(results: Usage[], activeProvider?: string): string {
  const rows = results.map(r => renderAccount(r, activeProvider));
  const columns = process.stdout.columns ?? 0;
  if (columns < 100 || rows.length < 2) return rows.join("\n");

  const columnWidth = Math.max(...rows.map(row => row.length)) + 4;
  const columnsPerRow = Math.max(2, Math.floor(columns / columnWidth));
  return Array.from({ length: Math.ceil(rows.length / columnsPerRow) }, (_, rowIndex) =>
    rows.slice(rowIndex * columnsPerRow, (rowIndex + 1) * columnsPerRow).map((row, index, group) =>
      index === group.length - 1 ? row : row.padEnd(columnWidth),
    ).join(""),
  ).join("\n");
}
async function switchToBest(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  if (!ctx.model || !ctx.model.provider.startsWith("openai-codex")) return;
  const results = await Promise.all(accounts().map(fetchUsage));
  const best = results.filter((item) => !item.error && item.weekly !== undefined).sort((a, b) => (b.weekly ?? -1) - (a.weekly ?? -1))[0];
  if (!best || best.provider === ctx.model.provider) return;
  const model = ctx.modelRegistry.find(best.provider, ctx.model.id);
  if (model) await pi.setModel(model);
}

export default function (pi: ExtensionAPI) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let currentCtx: ExtensionContext | undefined;
  let activeProvider: string | undefined;
  let refreshing = false;
  const refresh = async () => {
    if (!currentCtx || refreshing) return;
    refreshing = true;
    try {
      const results = await Promise.all(accounts().map(fetchUsage));
      currentCtx.ui.setStatus(STATUS_KEY, `Codex: ${results.find((item) => item.provider === activeProvider)?.email ?? "no active account"}`);
      currentCtx.ui.setWidget(STATUS_KEY, ["Codex usage", ...render(results, activeProvider).split("\n")]);
    }
    finally { refreshing = false; }
  };
  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx; activeProvider = ctx.model?.provider; await switchToBest(pi, ctx); await refresh();
    timer = setInterval(() => { void refresh(); }, REFRESH_MS);
  });
  pi.on("model_select", async (event, ctx) => { currentCtx = ctx; activeProvider = event.model.provider; await refresh(); });
  pi.on("session_shutdown", () => { if (timer) clearInterval(timer); timer = undefined; currentCtx = undefined; });
  pi.registerCommand("codex-usage", { description: "Refresh Codex account usage in the status bar", handler: async (_args, ctx) => { currentCtx = ctx; activeProvider = ctx.model?.provider; await refresh(); } });
}
