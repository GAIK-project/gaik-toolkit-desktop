// Turns picked or dropped paths into a flat list of supported files.
const fs = require("node:fs");
const path = require("node:path");

const MAX_FILES = 1000;
const SKIP_DIRS = new Set(["node_modules", "__pycache__"]);

function expandPaths(paths, extensions) {
  const allowed = new Set(extensions.map((e) => `.${e}`));
  const seen = new Set();
  const out = [];

  const add = (file, size) => {
    const key = process.platform === "win32" ? file.toLowerCase() : file;
    if (seen.has(key) || out.length >= MAX_FILES) return;
    if (allowed.size && !allowed.has(path.extname(file).toLowerCase())) return;
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

module.exports = { expandPaths, MAX_FILES };
