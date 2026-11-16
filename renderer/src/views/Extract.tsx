import { BookmarkPlus, ListChecks, Loader2, RotateCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Seed } from "../App";
import { gaik, type EngineState } from "../bridge";
import { DOCUMENTS, label, saveRun, useQueue, type ExtractRow, type SchemaField } from "../lib";
import { ExtractExports, ExtractTable, RecordDetail } from "../results";
import {
  Button,
  EngineNotice,
  FileDrop,
  FileName,
  RemoveButton,
  RunButton,
  Segmented,
  ViewHeader,
  inputClass,
  usable,
} from "../ui";

interface Schema {
  schema_id: string;
  fields: SchemaField[];
  requirements_json: Record<string, unknown>;
}

interface Recipe {
  id: string;
  name: string;
  text: string;
  requirements_json: Record<string, unknown>;
}

type Mode = "auto" | "local" | "vision";
type Result = { record: Record<string, unknown>; read: string };

export const INVOICE_EXAMPLE =
  "Extract the invoice header: invoice number, invoice date (YYYY-MM-DD), due date (YYYY-MM-DD), vendor name, customer name, total amount (number), currency. Extract every line item as a row with these fields: item name, quantity (number), unit price (number), line total (number).";

const EXAMPLES = [
  { name: "Invoice", text: INVOICE_EXAMPLE },
  {
    name: "Contract",
    text: "Contract parties, effective date as YYYY-MM-DD, end date as YYYY-MM-DD, notice period, governing law and total contract value as a number.",
  },
  {
    name: "CV",
    text: "Full name, email, phone, current job title, years of experience as a number, and a list of skills.",
  },
];

export function Extract({
  engine,
  onOpenSettings,
  seed,
}: {
  engine: EngineState;
  onOpenSettings: () => void;
  seed?: Seed | null;
}) {
  const queue = useQueue<Result>();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("auto");
  const [schema, setSchema] = useState<(Schema & { text: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [naming, setNaming] = useState<string | null>(null);

  useEffect(() => {
    gaik.data.get<Recipe[]>("recipes").then((r) => setRecipes(r ?? []));
  }, []);

  // The guide hands over sample files and a description; the user still runs it.
  const addFiles = queue.add;
  useEffect(() => {
    if (!seed) return;
    addFiles(seed.files);
    loadFields(seed.text, seed.requirements_json);
    // Runs once per hand-over; loadFields only reads state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const storeRecipes = (next: Recipe[]) => {
    setRecipes(next);
    gaik.data.set("recipes", next);
  };

  /** Loads a saved field list exactly as it was saved; no model call. */
  async function loadFields(description: string, requirements_json: Record<string, unknown>) {
    setText(description);
    setError(null);
    setBusy(true);
    const answer = await gaik.api<Schema>("/schema/restore", {
      requirements: description,
      requirements_json,
    });
    setBusy(false);
    if (answer.ok) {
      setSchema({ ...answer.data, text: description.trim() });
      queue.reset();
    } else setError(answer.error);
  }

  // The model turns the description into a field list. It is shown before any
  // file is read, because the same description can come back with fewer fields.
  const generate = async () => {
    setError(null);
    setBusy(true);
    const wanted = text.trim();
    const answer = await gaik.api<Schema>("/schema", { requirements: wanted });
    setBusy(false);
    if (answer.ok) {
      setSchema({ ...answer.data, text: wanted });
      queue.reset(); // rows read with the old fields would not match the new columns
    }
    else setError(answer.error);
  };

  const run = async (onlyPending: boolean) => {
    setError(null);
    if (!schema) return;
    // The engine forgets field lists when it restarts, for example after a settings
    // change. Load this one again first: it is rebuilt as saved, with no model call.
    const restored = await gaik.api<Schema>("/schema/restore", {
      requirements: schema.text,
      requirements_json: schema.requirements_json,
    });
    if (!restored.ok) {
      setError(restored.error);
      return;
    }
    const active = { ...restored.data, text: schema.text };
    setSchema(active);
    const schemaId = active.schema_id;
    const rows = await queue.run(
      (file) => gaik.api<Result>("/extract", { schema_id: schemaId, path: file.path, mode }),
      { onlyPending },
    );
    const finished = rows.filter((r) => r.status === "done" || r.status === "error");
    if (finished.length) {
      saveRun({
        tool: "extract",
        title: active.fields.slice(0, 4).map((f) => f.name.replace(/_/g, " ")).join(", "),
        count: finished.length,
        data: {
          fields: active.fields,
          rows: finished.map((r) => ({ name: r.name, path: r.path, record: r.result?.record, error: r.error })),
        },
      });
    }
  };

  const fields = schema?.fields ?? [];
  const rows = queue.items.map((item) => ({
    id: item.id,
    name: item.name,
    path: item.path,
    status: item.status,
    record: item.result?.record,
    error: item.error,
    lead: <FileName item={item} />,
    trail: !queue.running && <RemoveButton onClick={() => queue.remove(item.id)} />,
  }));
  const exportRows: ExtractRow[] = rows;
  const selectedRow = rows.find((r) => r.id === selected && r.record);
  const pending = queue.items.some((i) => i.status !== "done");
  const ready = usable(engine, true);
  const fieldsChanged = !schema || schema.text !== text.trim();

  return (
    <>
      <ViewHeader title="Extract data">
        {fieldsChanged && !queue.running ? (
          <Button
            variant="primary"
            disabled={!ready || busy || text.trim().length < 3}
            onClick={generate}
            icon={busy ? <Loader2 className="spin size-3.5" /> : <ListChecks className="size-4" />}
          >
            {busy ? "Reading your description…" : "Generate fields"}
          </Button>
        ) : (
          <RunButton
            running={queue.running}
            disabled={!ready || busy || !queue.items.length}
            done={queue.done}
            total={queue.items.length}
            onRun={() => run(pending)}
            onStop={queue.stop}
            label={pending ? "Extract" : "Extract again"}
          />
        )}
      </ViewHeader>
      {!ready ? (
        <EngineNotice engine={engine} needsModel onOpenSettings={onOpenSettings} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-5">
          <section className="shrink-0 rounded-lg border border-line bg-panel p-3">
            <label htmlFor="fields" className="font-medium">
              What to extract from each file
            </label>
            <textarea
              id="fields"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="Describe the fields in your own words, for example: invoice number, date as YYYY-MM-DD, vendor and total as a number."
              className={`${inputClass} mt-1.5 resize-none`}
            />
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="text-xs text-muted">Start from</span>
              {EXAMPLES.map((e) => (
                <button
                  key={e.name}
                  type="button"
                  className="press rounded border border-line px-2 py-0.5 text-xs hover:bg-hover"
                  onClick={() =>
                    // The invoice example comes with a saved field list; the others are generated.
                    e.name === "Invoice"
                      ? gaik.samples().then((s) => loadFields(s.text, s.requirements_json))
                      : setText(e.text)
                  }
                >
                  {e.name}
                </button>
              ))}
              {recipes.map((r) => (
                <span key={r.id} className="inline-flex items-center rounded border border-accent/40 bg-accent-soft text-xs text-accent">
                  <button type="button" className="press px-2 py-0.5" onClick={() => loadFields(r.text, r.requirements_json)} title={r.text}>
                    {r.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete the saved field list ${r.name}`}
                    className="press pr-1.5 opacity-60 hover:opacity-100"
                    onClick={() => storeRecipes(recipes.filter((x) => x.id !== r.id))}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <div className="ml-auto flex items-center gap-2">
                {schema && !fieldsChanged && naming === null && (
                  <Button variant="ghost" icon={<BookmarkPlus className="size-4" />} onClick={() => setNaming("")}>
                    Save field list
                  </Button>
                )}
                {naming !== null && schema && (
                  <form
                    className="flex items-center gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!naming.trim()) return;
                      storeRecipes([
                        ...recipes,
                        {
                          id: crypto.randomUUID(),
                          name: naming.trim(),
                          text: schema.text,
                          requirements_json: schema.requirements_json,
                        },
                      ]);
                      setNaming(null);
                    }}
                  >
                    <input
                      autoFocus
                      value={naming}
                      onChange={(e) => setNaming(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && setNaming(null)}
                      placeholder="Name"
                      maxLength={40}
                      className={`${inputClass} h-8 w-40`}
                    />
                    <Button type="submit" variant="primary" disabled={!naming.trim()}>
                      Save
                    </Button>
                  </form>
                )}
                <Segmented
                  label="How files are read"
                  value={mode}
                  onChange={(next) => {
                    setMode(next);
                    queue.reset();
                  }}
                  options={[
                    { value: "auto", label: "Auto", hint: "Text is read on this computer; scans and images go to the model as page images" },
                    { value: "local", label: "Text only", hint: "Only the text layer, read on this computer" },
                    { value: "vision", label: "Vision", hint: "Every page goes to the model as an image: slower, better for tables and scans" },
                  ]}
                />
              </div>
            </div>
            {schema && !fieldsChanged && (
              <div className="rise mt-3 flex items-start gap-3 border-t border-line pt-3">
                <ul className="m-0 flex min-w-0 flex-1 list-none flex-wrap gap-1.5 p-0" aria-label="Fields that will be extracted">
                  {fields.map((f) => (
                    <li
                      key={f.name}
                      title={f.description}
                      className="rounded bg-accent-soft px-2 py-0.5 text-accent"
                    >
                      <span className="font-medium">{label(f.name)}</span>
                      {f.children && (
                        <span className="opacity-80">: {f.children.map((c) => label(c.name).toLowerCase()).join(", ")}</span>
                      )}
                    </li>
                  ))}
                </ul>
                <Button
                  variant="ghost"
                  disabled={busy || queue.running}
                  onClick={generate}
                  icon={busy ? <Loader2 className="spin size-3.5" /> : <RotateCw className="size-3.5" />}
                  title="Ask the model for the field list again, for example when a field is missing"
                >
                  Regenerate
                </Button>
              </div>
            )}
            {error && <p className="selectable mt-2 text-danger">{error}</p>}
          </section>

          <div className="flex min-h-0 flex-1 gap-3">
            <FileDrop
              extensions={DOCUMENTS}
              onAdd={queue.add}
              empty={!queue.items.length}
              hint="PDF, Word, text and image files. Files are read where they are; only their text or page images go to your model."
              toolbar={<ExtractExports fields={fields} rows={exportRows} name="extraction" />}
            >
              <ExtractTable fields={fields} rows={rows} selected={selected} onSelect={setSelected} />
            </FileDrop>
            {selectedRow && <RecordDetail fields={fields} row={selectedRow} />}
          </div>
        </div>
      )}
    </>
  );
}
