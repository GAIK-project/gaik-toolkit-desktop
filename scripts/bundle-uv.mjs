// Copies the uv on this machine into build/bin, so the packaged app can install
// its engine on a computer that has neither Python nor uv.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const isWin = process.platform === "win32";
const name = isWin ? "uv.exe" : "uv";
let found = "";
try {
  found = execFileSync(isWin ? "where" : "which", ["uv"], { encoding: "utf8" })
    .split(/\r?\n/)[0]
    .trim();
} catch {
  // handled below
}
if (!found || !fs.existsSync(found)) {
  console.error("uv was not found on PATH. Install it from https://docs.astral.sh/uv/ and run this again.");
  process.exit(1);
}
const outDir = path.join(import.meta.dirname, "..", "build", "bin");
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(fs.realpathSync(found), path.join(outDir, name));
const version = execFileSync(path.join(outDir, name), ["--version"], { encoding: "utf8" }).trim();
console.log(`bundled ${version} from ${found}`);
