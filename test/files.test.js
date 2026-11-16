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
