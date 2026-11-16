const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createStore,
  isConfigured,
  mergeForm,
  parseEnvLines,
  publicView,
  settingsToEnv,
} = require("../src/settings");

test("parseEnvLines keeps valid pairs and skips the rest", () => {
  const env = parseEnvLines(
    '# note\nDOCLING_API_BASE=https://x.example/a=b\n\nbad line\n1X=no\nQ="quoted value"\n',
  );
  assert.deepEqual(env, {
    DOCLING_API_BASE: "https://x.example/a=b",
    Q: "quoted value",
  });
});

test("azure settings become gaik's environment", () => {
  const env = settingsToEnv({
    provider: "azure",
    azureApiKey: "k",
    azureEndpoint: "https://r.openai.azure.com/",
    model: "gpt-6-luna",
  });
  assert.equal(env.LLM_PROVIDER, "azure");
  assert.equal(env.AZURE_API_KEY, "k");
  assert.equal(env.AZURE_API_VERSION, "latest");
  assert.equal(env.AZURE_DEPLOYMENT, "gpt-6-luna");
  assert.equal(env.OPENAI_API_KEY, undefined);
});

test("extra lines override generated values", () => {
  const env = settingsToEnv({
    provider: "openai",
    openaiApiKey: "k",
    extraEnv: "LLM_PROVIDER=aitta",
  });
  assert.equal(env.OPENAI_API_KEY, "k");
  assert.equal(env.LLM_PROVIDER, "aitta");
});

test("isConfigured needs the chosen provider's credentials", () => {
  assert.equal(isConfigured({}), false);
  assert.equal(isConfigured({ provider: "azure", azureApiKey: "k" }), false);
  assert.equal(
    isConfigured({ provider: "azure", azureApiKey: "k", azureEndpoint: "https://e" }),
    true,
  );
  assert.equal(isConfigured({ provider: "openai", openaiApiKey: "k" }), true);
});

test("a blank secret in the form keeps the saved one", () => {
  const next = mergeForm(
    { provider: "azure", azureApiKey: "old", azureEndpoint: "https://e" },
    { provider: "azure", azureApiKey: "", azureEndpoint: " https://new " },
  );
  assert.equal(next.azureApiKey, "old");
  assert.equal(next.azureEndpoint, "https://new");
});

test("publicView never carries a secret", () => {
  const view = publicView({ provider: "openai", openaiApiKey: "sk-secret", extraEnv: "A=b" });
  assert.equal(JSON.stringify(view).includes("sk-secret"), false);
  assert.equal(view.openaiApiKeySet, true);
  assert.equal(view.extraEnvSet, true);
  assert.equal(view.azureApiKeySet, false);
});

test("the store writes secrets encrypted and reads them back", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gaik-")), "settings.json");
  const fakeSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s, "utf8").reverse(),
    decryptString: (b) => Buffer.from(b).reverse().toString("utf8"),
  };
  const store = createStore(file, fakeSafeStorage);
  store.save({ provider: "openai", openaiApiKey: "sk-secret", model: "m" });
  assert.equal(fs.readFileSync(file, "utf8").includes("sk-secret"), false);
  assert.deepEqual(store.load(), { provider: "openai", model: "m", openaiApiKey: "sk-secret" });
});

test("extra variables cannot change what the engine runs", () => {
  const env = parseEnvLines("PATH=C:/evil\nPYTHONPATH=x\nGAIK_DESKTOP_TOKEN=y\nUV_INDEX=z\nHTTPS_PROXY=http://proxy:8080\nAITTA_API_KEY=k");
  assert.deepEqual(env, { HTTPS_PROXY: "http://proxy:8080", AITTA_API_KEY: "k" });
});
