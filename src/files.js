// Turns picked or dropped paths into a flat list of supported files.
const fs = require("node:fs");
const path = require("node:path");

const MAX_FILES = 1000;
const SKIP_DIRS = new Set(["node_modules", "__pycache__"]);

function expandPaths(paths, extensions) {
  const allowed = new Set(extensions.map((e) => `.${e}`));
  const seen = new Set();
  const out = [];
  if (!allowed.size) return out;

  const add = (file, size) => {
    const key = process.platform === "win32" ? file.toLowerCase() : file;
    if (seen.has(key) || out.length >= MAX_FILES) return;
    if (!allowed.has(path.extname(file).toLowerCase())) return;
    seen.add(key);
    out.push({ path: file, name: path.basename(file), size });
  };

  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const entry of entries) {
      if (out.length >= MAX_FILES) return;
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        add(full, safeSize(full));
      }
    }
  };

  for (const p of paths) {
    let stat;
    try {
      stat = fs.statSync(p);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walk(p);
    else if (stat.isFile()) add(p, stat.size);
  }
  return out;
}

function safeSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * Writes text files into a folder and returns their paths. A name is reduced to
 * its base name, and an existing file is never overwritten: the new one gets
 * " (2)", " (3)" and so on before its extension.
 */
function writeAll(folder, files) {
  const written = [];
  const taken = new Set();
  for (const file of files) {
    const base = path.basename(String(file.name).replace(/[<>:"|?*\u0000-\u001f]/g, "_")) || "result.txt";
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    let target = path.join(folder, base);
    for (let n = 2; taken.has(target.toLowerCase()) || fs.existsSync(target); n++) {
      target = path.join(folder, `${stem} (${n})${ext}`);
    }
    taken.add(target.toLowerCase());
    fs.writeFileSync(target, file.content, "utf8");
    written.push(target);
  }
  return written;
}

module.exports = { expandPaths, writeAll, MAX_FILES };
