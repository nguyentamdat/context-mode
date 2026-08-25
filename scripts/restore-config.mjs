import { cp, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

if (!process.argv.includes("--apply")) {
  console.log("This overwrites Pi configuration after making backups. Run again with --apply.");
  process.exit(0);
}

const source = join(import.meta.dirname, "..", "config");
const target = join(homedir(), ".pi", "agent");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
await mkdir(target, { recursive: true });
for (const file of ["backlog-md.json", "config.yml", "hindsight.json", "mcp.json", "multi-pass.json", "provider-failover.json", "settings.json"]) {
  const from = join(source, file);
  if (!existsSync(from)) continue;
  const to = join(target, file);
  if (existsSync(to)) await cp(to, `${to}.bak-${stamp}`);
  await cp(from, to);
  console.log(`Restored ${file}`);
}
console.log("Restart Pi, then log in again and replace any <set-on-target> values.");
