// Model settings: stored in the user-data folder, secrets encrypted with the
// operating system's keychain through Electron's safeStorage.
const fs = require("node:fs");
const path = require("node:path");

const PLAIN_FIELDS = ["provider", "azureEndpoint", "azureApiVersion", "model"];
const SECRET_FIELDS = ["azureApiKey", "openaiApiKey", "extraEnv"];

// Variables that decide which programs and modules the engine runs are not
// accepted from the settings page.
const BLOCKED_ENV =
  /^(PATH|PATHEXT|COMSPEC|SYSTEMROOT|WINDIR|TEMP|TMP|LD_\w+|DYLD_\w+|PYTHON\w*|GAIK_DESKTOP_\w*|NODE_\w*|ELECTRON_\w*|UV_\w*)$/i;

/** Parses KEY=VALUE lines; blank lines, # comments and blocked names are skipped. */
function parseEnvLines(text) {
  const env = {};
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || BLOCKED_ENV.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

/** The environment variables gaik reads its provider and model from. */
function settingsToEnv(settings) {
  const env = {};
  const s = settings || {};
  if (s.provider === "openai") {
    env.LLM_PROVIDER = "openai";
    if (s.openaiApiKey) env.OPENAI_API_KEY = s.openaiApiKey;
    if (s.model) env.OPENAI_MODEL = s.model;
  } else {
    env.LLM_PROVIDER = "azure";
    if (s.azureApiKey) env.AZURE_API_KEY = s.azureApiKey;
    if (s.azureEndpoint) env.AZURE_ENDPOINT = s.azureEndpoint;
    env.AZURE_API_VERSION = s.azureApiVersion || "latest";
    if (s.model) env.AZURE_DEPLOYMENT = s.model;
  }
  // Extra lines win, so anything above can be overridden by hand.
  return { ...env, ...parseEnvLines(s.extraEnv) };
}

function isConfigured(settings) {
  const s = settings || {};
  if (s.provider === "openai") return Boolean(s.openaiApiKey);
  return Boolean(s.azureApiKey && s.azureEndpoint);
}

/** What the settings page may see: plain fields, and whether each secret is set. */
function publicView(settings) {
  const s = settings || {};
  const view = { provider: s.provider || "azure" };
  for (const f of PLAIN_FIELDS) if (f !== "provider") view[f] = s[f] || "";
  for (const f of SECRET_FIELDS) view[`${f}Set`] = Boolean(s[f]);
  return view;
}

/** A blank secret in the form keeps the stored one; `clear` removes those named. */
function mergeForm(current, form) {
  const next = { ...(current || {}) };
  for (const f of PLAIN_FIELDS) {
    if (typeof form[f] === "string") next[f] = form[f].trim();
  }
  for (const f of SECRET_FIELDS) {
    if (typeof form[f] === "string" && form[f].trim()) next[f] = form[f].trim();
  }
  for (const f of form.clear || []) {
    if (SECRET_FIELDS.includes(f)) delete next[f];
  }
  if (next.provider !== "openai") next.provider = "azure";
  return next;
}

function createStore(file, safeStorage) {
  function load() {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
    const settings = { ...(raw.plain || {}) };
    if (raw.secrets && safeStorage.isEncryptionAvailable()) {
      try {
        Object.assign(
          settings,
          JSON.parse(safeStorage.decryptString(Buffer.from(raw.secrets, "base64"))),
        );
      } catch {
        // Unreadable secrets (another user profile, a reset keychain): ask again.
      }
    }
    return settings;
  }

  function save(settings) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        "The operating system's secure storage is not available, so keys cannot be saved.",
      );
    }
    const plain = {};
    const secrets = {};
    for (const f of PLAIN_FIELDS) if (settings[f]) plain[f] = settings[f];
    for (const f of SECRET_FIELDS) if (settings[f]) secrets[f] = settings[f];
    const body = {
      plain,
      secrets: safeStorage.encryptString(JSON.stringify(secrets)).toString("base64"),
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(body, null, 2));
  }

  return { load, save };
}

module.exports = {
  parseEnvLines,
  settingsToEnv,
  isConfigured,
  publicView,
  mergeForm,
  createStore,
};
