import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const root = execFileSync(npm, ["root", "-g"], { encoding: "utf8" }).trim();
const file = join(root, "@earendil-works", "pi-coding-agent", "dist", "modes", "interactive", "components", "tool-execution.js");
const needle = "            if (this.result) {\n                const resultRenderer = this.getResultRenderer();";
const patch = "            if (this.result) {\n                const outputChars = this.result.details?.toolOutputChars;\n                if (typeof outputChars === \"number\") {\n                    renderContainer.addChild(new Text(theme.fg(\"dim\", `↳ ${outputChars.toLocaleString()} chars`), 0, 0));\n                    hasContent = true;\n                }\n                const resultRenderer = this.getResultRenderer();";

if (!existsSync(file)) throw new Error(`Pi renderer not found: ${file}`);
const source = readFileSync(file, "utf8");
if (source.includes("this.result.details?.toolOutputChars")) {
  console.log("Pi tool-output patch is already installed.");
} else {
  if (!source.includes(needle)) throw new Error("Unsupported Pi version: renderer patch location changed.");
  writeFileSync(file, source.replace(needle, patch));
  console.log(`Patched ${file}`);
}
