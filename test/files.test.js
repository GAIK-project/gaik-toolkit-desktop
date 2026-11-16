const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { expandPaths } = require("../src/files");

test("expandPaths walks folders, filters by extension and skips hidden entries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gaik-files-"));
  fs.mkdirSync(path.join(root, "sub"));
  fs.mkdirSync(path.join(root, ".hidden"));
  fs.writeFileSync(path.join(root, "a.pdf"), "x");
  fs.writeFileSync(path.join(root, "b.exe"), "x");
  fs.writeFileSync(path.join(root, "sub", "c.PDF"), "xy");
  fs.writeFileSync(path.join(root, ".hidden", "d.pdf"), "x");

  const found = expandPaths([root, path.join(root, "a.pdf")], ["pdf"]);
  assert.deepEqual(found.map((f) => f.name), ["a.pdf", "c.PDF"]);
  assert.equal(found[1].size, 2);
});

test("writeAll never overwrites and keeps files inside the folder", () => {
  const { writeAll } = require("../src/files");
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "gaik-save-"));
  fs.writeFileSync(path.join(folder, "a.md"), "old");
  const written = writeAll(folder, [
    { name: "a.md", content: "one" },
    { name: "a.md", content: "two" },
    { name: "../../escape.md", content: "three" },
  ]);
  assert.deepEqual(written.map((f) => path.basename(f)), ["a (2).md", "a (3).md", "escape.md"]);
  assert.ok(written.every((f) => path.dirname(f) === folder));
  assert.equal(fs.readFileSync(path.join(folder, "a.md"), "utf8"), "old");
  assert.equal(fs.readFileSync(path.join(folder, "a (3).md"), "utf8"), "two");
});
