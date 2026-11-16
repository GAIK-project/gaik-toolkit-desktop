import { Check, Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { gaik, type EngineState, type SettingsView } from "../bridge";
import { Button, ViewHeader, cx, inputClass } from "../ui";

const SAVED = "Saved. Leave blank to keep it.";

export function Settings({ engine }: { engine: EngineState }) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [form, setForm] = useState({
    provider: "azure",
    azureEndpoint: "",
    azureApiVersion: "",
    model: "",
    azureApiKey: "",
    openaiApiKey: "",
    extraEnv: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ state: "idle" | "running" | "ok" | "bad"; text?: string }>({ state: "idle" });
  const [info, setInfo] = useState<{ version: string; dataFolder: string } | null>(null);

  const fill = (s: SettingsView) => {
    setSettings(s);
    setForm((f) => ({
      ...f,
      provider: s.provider,
      azureEndpoint: s.azureEndpoint,
      azureApiVersion: s.azureApiVersion,
      model: s.model,
      azureApiKey: "",
      openaiApiKey: "",
      extraEnv: "",
    }));
  };

  useEffect(() => {
    gaik.settings.get().then(fill);
    gaik.app.info().then(setInfo);
  }, []);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setTest({ state: "idle" });
    const result = await gaik.settings.save(form);
    setSaving(false);
    if (result.ok && result.settings) fill(result.settings);
    else setError(result.error ?? "Could not save the settings.");
  };

  const runTest = async () => {
    setTest({ state: "running" });
    const answer = await gaik.api<{ model: string }>("/test-model");
    setTest(
      answer.ok
        ? { state: "ok", text: `${answer.data.model} answered.` }
        : { state: "bad", text: answer.error },
    );
  };

  if (!settings) return <ViewHeader title="Settings" />;
  const azure = form.provider === "azure";
  const health = engine.health;

  return (
    <>
      <ViewHeader title="Settings" />
      <div className="scroll min-h-0 flex-1 px-5 pb-8">
        <div className="mx-auto grid max-w-2xl gap-4">
          <form onSubmit={save} className="grid gap-4 rounded-lg border border-line bg-panel p-5">
            <div>
              <h2 className="text-[15px] font-semibold">Model</h2>
              <p className="mt-1 text-muted">
                GAIK Desktop calls the model with your own key. The key is encrypted with this computer's secure
                storage and sent only to the provider you choose.
              </p>
              {settings.fromEnvironment && (
                <p className="mt-2 text-muted">
                  Started with GAIK_DESKTOP_USE_ENV=1: the engine uses the model variables of the shell, not this form.
                </p>
              )}
            </div>
            <Field label="Provider">
              <select value={form.provider} onChange={set("provider")} className={inputClass}>
                <option value="azure">Azure OpenAI</option>
                <option value="openai">OpenAI</option>
              </select>
            </Field>
            {azure ? (
              <>
                <Field label="Endpoint">
                  <input
                    value={form.azureEndpoint}
                    onChange={set("azureEndpoint")}
                    placeholder="https://<resource>.openai.azure.com/"
                    className={inputClass}
                  />
                </Field>
                <Field label="API key">
                  <input
                    type="password"
                    autoComplete="off"
                    value={form.azureApiKey}
                    onChange={set("azureApiKey")}
                    placeholder={settings.azureApiKeySet ? SAVED : ""}
                    className={inputClass}
                  />
                </Field>
                <Field label="API version" hint='Leave empty for "latest".'>
                  <input value={form.azureApiVersion} onChange={set("azureApiVersion")} placeholder="latest" className={inputClass} />
                </Field>
              </>
            ) : (
              <Field label="API key">
                <input
                  type="password"
                  autoComplete="off"
                  value={form.openaiApiKey}
                  onChange={set("openaiApiKey")}
                  placeholder={settings.openaiApiKeySet ? SAVED : ""}
                  className={inputClass}
                />
              </Field>
            )}
            <Field label="Model" hint={azure ? "The deployment name. Empty uses gpt-6-luna." : "Empty uses gpt-6-luna."}>
              <input value={form.model} onChange={set("model")} placeholder="gpt-6-luna" className={inputClass} />
            </Field>
            <Field
              label="Other environment variables"
              hint="Optional, one KEY=VALUE per line. For another gaik provider, set LLM_PROVIDER and its variables here."
            >
              <textarea
                value={form.extraEnv}
                onChange={set("extraEnv")}
                rows={3}
                spellCheck={false}
                placeholder={settings.extraEnvSet ? SAVED : ""}
                className={`${inputClass} resize-y font-mono text-xs`}
              />
            </Field>
            {error && <p className="selectable text-danger">{error}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving…" : "Save and restart engine"}
              </Button>
              <Button onClick={runTest} disabled={engine.phase !== "ready" || !health?.configured || test.state === "running"}>
                Test connection
              </Button>
              {test.state === "running" && <Loader2 className="spin size-4 text-accent" />}
              {test.text && (
                <span className={cx("rise selectable flex items-center gap-1", test.state === "ok" ? "text-ok" : "text-danger")}>
                  {test.state === "ok" && <Check className="size-4" />}
                  {test.text}
                </span>
              )}
            </div>
          </form>

          <section className="rounded-lg border border-line bg-panel p-5">
            <h2 className="text-[15px] font-semibold">Engine</h2>
            <dl className="selectable mt-3 grid grid-cols-[9rem_1fr] gap-y-1.5">
              <dt className="text-muted">Status</dt>
              <dd className={engine.phase === "error" ? "text-danger" : undefined}>
                {engine.phase === "ready" ? "Running" : engine.phase === "error" ? engine.error : "Starting"}
              </dd>
              <dt className="text-muted">GAIK toolkit</dt>
              <dd>{health ? health.gaik : "—"}</dd>
              <dt className="text-muted">Model</dt>
              <dd>{health?.configured ? `${health.model} (${health.provider})` : "No model key"}</dd>
              <dt className="text-muted">App version</dt>
              <dd>{info?.version}</dd>
              <dt className="text-muted">Data folder</dt>
              <dd className="break-all">{info?.dataFolder}</dd>
            </dl>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => gaik.engine.restart()}>Restart engine</Button>
              <Button onClick={() => gaik.app.openLogs()}>Open log folder</Button>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="font-medium">
        {label}
        {hint && <span className="ml-2 font-normal text-muted">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
