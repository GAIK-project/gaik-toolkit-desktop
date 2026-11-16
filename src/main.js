// GAIK Desktop: main process.
//
// Owns the window, the local engine (a Python process running the gaik toolkit,
// bound to 127.0.0.1 with a per-run token), the model settings and the files
// the user picks. The renderer never gets Node access: it talks to this process
// through the bridge in preload.js.
const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  nativeTheme,
  safeStorage,
  shell,
} = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const {
  createStore,
  mergeForm,
  publicView,
  settingsToEnv,
} = require("./settings");
const { expandPaths, writeAll } = require("./files");

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";
const sidecarDir = app.isPackaged
  ? path.join(process.resourcesPath, "sidecar")
  : path.join(__dirname, "..", "sidecar");

let store;
let win = null;
let logStream = null;
let quitting = false;
let startToken = 0;
const children = new Set();
const engine = {
  phase: "starting", // installing | starting | ready | error
  error: null,
  health: null,
  port: null,
  token: null,
  log: [],
};

const userPath = (...parts) => path.join(app.getPath("userData"), ...parts);
// The engine is uv's own Python plus a folder of packages on PYTHONPATH. There is
// no virtual environment on purpose: its python.exe is a launcher generated per
// install, and managed Windows computers refuse to run such unsigned launchers.
const engineDir = () => userPath("engine");
const sitePackages = () => path.join(engineDir(), "site");
const engineMarker = () => path.join(engineDir(), "engine.json");

function uvCommand() {
  const bundled = path.join(process.resourcesPath || "", "bin", isWin ? "uv.exe" : "uv");
  return app.isPackaged && fs.existsSync(bundled) ? bundled : "uv";
}

// ---------------------------------------------------------------------------
// Engine state and log
// ---------------------------------------------------------------------------
function engineView() {
  return {
    phase: engine.phase,
    error: engine.error,
    health: engine.health,
    log: engine.log.slice(-200),
  };
}

function setPhase(phase, error = null) {
  engine.phase = phase;
  engine.error = error;
  if (win && !win.isDestroyed()) win.webContents.send("engine", engineView());
}

function log(source, text) {
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const entry = `[${source}] ${line}`;
    engine.log.push(entry);
    if (engine.log.length > 500) engine.log.shift();
    logStream?.write(`${new Date().toISOString()} ${entry}\n`);
  }
}

// ---------------------------------------------------------------------------
// Child processes
// ---------------------------------------------------------------------------
function track(child, name) {
  children.add(child);
  child.stdout?.on("data", (d) => log(name, d));
  child.stderr?.on("data", (d) => log(name, d));
  child.on("exit", () => children.delete(child));
  return child;
}

function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (isWin) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    child.kill("SIGTERM");
  }
}

function stopChildren() {
  for (const child of [...children]) killTree(child);
  children.clear();
}

function runStep(name, cmd, args) {
  return new Promise((resolve, reject) => {
    // uv brings its own Python: the engine must not depend on whatever Python
    // the computer has (none, an old one, or the Microsoft Store placeholder).
    const env = { ...process.env, UV_PYTHON_PREFERENCE: "only-managed" };
    const child = track(spawn(cmd, args, { windowsHide: true, env }), name);
    let out = "";
    child.stdout.setEncoding("utf8"); // a path may hold multi-byte characters
    child.stdout.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${name} failed (exit code ${code})`)),
    );
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** One JSON request to the engine. No timeout: a long recording can take a while. */
function engineRequest(method, route, body) {
  return new Promise((resolve) => {
    if (!engine.port) {
      resolve({ ok: false, error: "The engine is not running." });
      return;
    }
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: "127.0.0.1",
        port: engine.port,
        path: route,
        method,
        headers: {
          authorization: `Bearer ${engine.token}`,
          ...(payload
            ? { "content-type": "application/json", "content-length": payload.length }
            : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          let data = null;
          try {
            data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            // fall through with null
          }
          if (res.statusCode === 200) resolve({ ok: true, data });
          else {
            const detail = data?.error ?? data?.detail;
            resolve({
              ok: false,
              error:
                typeof detail === "string"
                  ? detail
                  : `The engine answered ${res.statusCode}.`,
            });
          }
        });
      },
    );
    req.on("error", (err) =>
      resolve({ ok: false, error: `The engine did not answer (${err.code || err.message}).` }),
    );
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForEngine(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let exited = null;
  child.on("exit", (code) => (exited = code ?? -1));
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`The engine stopped during start (exit code ${exited}).`);
    const result = await engineRequest("GET", "/health");
    if (result.ok) return result.data;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("The engine did not start in time.");
}

// ---------------------------------------------------------------------------
// Engine start-up
// ---------------------------------------------------------------------------
/** Returns the engine's Python, or null when a newer start has taken over. */
async function ensurePython(current) {
  const requirements = path.join(sidecarDir, "requirements.txt");
  const wanted = crypto.createHash("sha256").update(fs.readFileSync(requirements)).digest("hex");
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(engineMarker(), "utf8"));
  } catch {
    // no finished install yet
  }
  if (saved.requirements === wanted && saved.python && fs.existsSync(saved.python)) {
    return saved.python;
  }

  setPhase("installing");
  const uv = uvCommand();
  try {
    await runStep("uv", uv, ["python", "install", "3.12"]);
    if (!current()) return null;
    const found = await runStep("uv", uv, ["python", "find", "3.12"]);
    if (!current()) return null; // never delete a folder a newer start is installing into
    const python = found.trim().split(/\r?\n/).pop();
    if (!python || !fs.existsSync(python)) throw new Error("uv did not report a Python to use.");
    // The marker is written last, so an install that was interrupted or belongs
    // to other requirements is replaced as a whole, never patched.
    fs.rmSync(engineDir(), { recursive: true, force: true });
    await runStep("uv", uv, [
      "pip",
      "install",
      "--python",
      python,
      "--target",
      sitePackages(),
      "-r",
      requirements,
    ]);
    if (!current()) return null;
    fs.writeFileSync(engineMarker(), JSON.stringify({ requirements: wanted, python }));
    return python;
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error("uv was not found. Install it from https://docs.astral.sh/uv/ and start again.");
    }
    throw new Error(
      `The engine could not be installed (${err.message}). It is downloaded on the first start: check the internet connection and try again. The log has the details.`,
    );
  }
}

async function startEngine() {
  const token = ++startToken;
  const current = () => token === startToken && !quitting;
  stopChildren();
  engine.port = null;
  engine.health = null;
  setPhase("starting");

  try {
    const python = await ensurePython(current);
    if (!current() || !python) return;
    setPhase("starting");

    // GAIK_DESKTOP_USE_ENV=1 (development): model variables come from the shell
    // the app was started in, not from the settings page.
    const modelEnv =
      process.env.GAIK_DESKTOP_USE_ENV === "1" ? {} : settingsToEnv(store.load());
    const port = await freePort();
    if (!current()) return; // a newer start, or quitting: do not spawn a second engine
    engine.token = crypto.randomBytes(24).toString("hex");
    const child = track(
      spawn(python, [path.join(sidecarDir, "server.py")], {
        cwd: app.getPath("temp"),
        windowsHide: true,
        env: {
          ...process.env,
          ...modelEnv,
          GAIK_DESKTOP_TOKEN: engine.token,
          GAIK_DESKTOP_PORT: String(port),
          GAIK_DESKTOP_WATCH_PARENT: "1",
          // Only the engine's own packages: nothing from the user's Python setup.
          PYTHONPATH: sitePackages(),
          PYTHONHOME: undefined,
          PYTHONNOUSERSITE: "1",
          PYTHONUNBUFFERED: "1",
          PYTHONUTF8: "1",
        },
      }),
      "engine",
    );
    engine.port = port;
    const health = await waitForEngine(child, 120_000);
    if (!current()) return;
    child.on("exit", (code) => {
      if (!current()) return;
      engine.port = null;
      setPhase("error", `The engine stopped (exit code ${code}).`);
    });
    engine.health = health;
    setPhase("ready");
  } catch (err) {
    if (!current()) return;
    log("app", err.message);
    stopChildren();
    engine.port = null;
    setPhase("error", err.message);
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function overlayColors() {
  return {
    color: "#00000000",
    symbolColor: nativeTheme.shouldUseDarkColors ? "#e8eaea" : "#1c2222",
    height: 40,
  };
}

// Development: GAIK_DESKTOP_RECORD_DIR=<folder> renders the window offscreen and
// writes every painted frame there, for demo recordings that do not depend on
// the desktop being visible. Drive the app over --remote-debugging-port.
const recordDir = process.env.GAIK_DESKTOP_RECORD_DIR;

function recordFrames(target) {
  fs.mkdirSync(recordDir, { recursive: true });
  const index = fs.createWriteStream(path.join(recordDir, "frames.jsonl"), { flags: "w" });
  let count = 0;
  target.webContents.setFrameRate(30);
  target.webContents.on("paint", (_event, _dirty, image) => {
    const file = `${String(count++).padStart(6, "0")}.jpg`;
    fs.writeFileSync(path.join(recordDir, file), image.toJPEG(92));
    index.write(JSON.stringify({ file, t: Date.now() / 1000 }) + "\n");
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: recordDir ? 1440 : 1280,
    height: recordDir ? 810 : 860,
    useContentSize: true,
    show: !recordDir,
    minWidth: 860,
    minHeight: 600,
    title: "GAIK Desktop",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#121616" : "#f6f7f7",
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    ...(isMac ? {} : { titleBarOverlay: overlayColors() }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: Boolean(recordDir),
    },
  });
  if (recordDir) recordFrames(win);
  win.loadFile(path.join(__dirname, "..", "dist", "renderer", "index.html"));
  win.on("closed", () => (win = null));
  // The window shows only the app itself; links open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  nativeTheme.on("updated", () => {
    if (win && !win.isDestroyed() && !isMac) win.setTitleBarOverlay(overlayColors());
  });
}

function buildMenu() {
  // The window has no visible menu bar; this keeps the standard shortcuts.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: "appMenu" }] : []),
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "toggleDevTools" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "togglefullscreen" },
        ],
      },
    ]),
  );
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
const fromApp = (event) => Boolean(win && event.sender === win.webContents);
const API_ROUTES = new Set([
  "/test-model",
  "/schema",
  "/schema/restore",
  "/extract",
  "/parse",
  "/classify",
  "/transcribe",
]);
const DATA_FILES = new Set(["recipes", "runs"]);

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => (fromApp(event) ? fn(...args) : null));
}

handle("engine:get", () => engineView());
handle("engine:restart", () => {
  startEngine();
});
handle("api", (route, body) => {
  if (!API_ROUTES.has(route)) return { ok: false, error: "Unknown request." };
  return engineRequest("POST", route, body ?? {});
});

handle("settings:get", () => ({
  ...publicView(store.load()),
  fromEnvironment: process.env.GAIK_DESKTOP_USE_ENV === "1",
}));
handle("settings:save", (form) => {
  try {
    const next = mergeForm(store.load(), form || {});
    store.save(next);
    startEngine();
    return { ok: true, settings: publicView(next) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

handle("files:pick", async (options) => {
  const folder = options?.kind === "folder";
  const extensions = cleanExtensions(options?.extensions);
  const result = await dialog.showOpenDialog(win, {
    properties: folder ? ["openDirectory"] : ["openFile", "multiSelections"],
    filters: folder ? undefined : [{ name: "Supported files", extensions }],
  });
  return result.canceled ? [] : expandPaths(result.filePaths, extensions);
});
handle("files:expand", (paths, extensions) =>
  expandPaths(
    (Array.isArray(paths) ? paths : []).filter((p) => typeof p === "string"),
    cleanExtensions(extensions),
  ),
);
handle("files:reveal", (file) => {
  if (typeof file === "string" && fs.existsSync(file)) shell.showItemInFolder(file);
});

function cleanExtensions(list) {
  return (Array.isArray(list) ? list : [])
    .filter((e) => typeof e === "string" && /^[a-z0-9]{1,5}$/i.test(e))
    .map((e) => e.toLowerCase());
}

handle("save:text", async (options) => {
  const result = await dialog.showSaveDialog(win, {
    defaultPath: String(options?.defaultName || "result.txt"),
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(result.filePath, String(options?.content ?? ""), "utf8");
    return { ok: true, path: result.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
handle("save:xlsx", async (options) => {
  const result = await dialog.showSaveDialog(win, {
    defaultPath: String(options?.defaultName || "results.xlsx"),
    filters: [{ name: "Excel workbook", extensions: ["xlsx"] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  const saved = await engineRequest("POST", "/export/xlsx", {
    path: result.filePath,
    sheets: options?.sheets ?? [],
  });
  return saved.ok ? { ok: true, path: result.filePath } : saved;
});

handle("save:folder", async (options) => {
  const files = (Array.isArray(options?.files) ? options.files : []).filter(
    (f) => f && typeof f.name === "string" && typeof f.content === "string",
  );
  if (!files.length) return { ok: false, error: "Nothing to save." };
  const result = await dialog.showOpenDialog(win, {
    title: "Save all results to a folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  try {
    const saved = writeAll(result.filePaths[0], files);
    return { ok: true, path: saved[0], count: saved.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

handle("data:get", (name) => {
  if (!DATA_FILES.has(name)) return null;
  try {
    return JSON.parse(fs.readFileSync(userPath("data", `${name}.json`), "utf8"));
  } catch {
    return null;
  }
});
handle("data:set", (name, value) => {
  if (!DATA_FILES.has(name)) return false;
  fs.mkdirSync(userPath("data"), { recursive: true });
  fs.writeFileSync(userPath("data", `${name}.json`), JSON.stringify(value));
  return true;
});

// Made-up invoices and a saved field list for them, so a first try does not
// depend on what the model makes of a description.
handle("samples", () => {
  const folder = app.isPackaged
    ? path.join(process.resourcesPath, "samples")
    : path.join(__dirname, "..", "samples");
  const fields = JSON.parse(fs.readFileSync(path.join(folder, "invoice-fields.json"), "utf8"));
  return { files: expandPaths([path.join(folder, "invoices")], ["pdf"]), ...fields };
});

handle("app:info", () => ({
  version: app.getVersion(),
  dataFolder: app.getPath("userData"),
  platform: process.platform,
}));
handle("app:openLogs", () => {
  shell.openPath(userPath("logs"));
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    fs.mkdirSync(userPath("logs"), { recursive: true });
    logStream = fs.createWriteStream(userPath("logs", "desktop.log"), { flags: "w" });
    store = createStore(userPath("settings.json"), safeStorage);
    buildMenu();
    createWindow();
    startEngine();
  });

  app.on("before-quit", () => {
    quitting = true;
    stopChildren();
  });
  app.on("window-all-closed", () => app.quit());
}
