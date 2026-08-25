import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const source = process.argv[2] ?? join(homedir(), ".pi", "agent");
const target = join(import.meta.dirname, "..", "config");
const files = ["backlog-md.json", "config.yml", "hindsight.json", "mcp.json", "multi-pass.json", "provider-failover.json", "settings.json"];
const { version } = JSON.parse(await readFile(join(import.meta.dirname, "..", "package.json"), "utf8"));
const secret = /token|secret|password|api[_-]?key|access|refresh|authorization|cookie/i;

function redact(value, key = "") {
  if (secret.test(key)) return "<set-on-target>";
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
  return value;
}

await mkdir(target, { recursive: true });
for (const file of files) {
  const from = join(source, file);
  if (!existsSync(from)) continue;
  if (file.endsWith(".json")) {
    const config = redact(JSON.parse(await readFile(from, "utf8")));
    if (file === "settings.json") config.packages = [`git:github.com/nguyentamdat/pitada@v${version}`];
    await writeFile(join(target, file), `${JSON.stringify(config, null, 2)}\n`);
  } else {
    const yaml = await readFile(from, "utf8");
    await writeFile(join(target, file), yaml.replace(/^(\s*[^#:]+(?:token|secret|password|api[_-]?key|access|refresh|authorization|cookie)[^:]*:\s*).*$/gim, "$1<set-on-target>"));
  }
  console.log(`Saved ${file}`);
}
