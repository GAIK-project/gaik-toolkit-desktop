import { X } from "lucide-react";
import { useState } from "react";
import { gaik, type EngineState } from "../bridge";
import { DOCUMENTS, saveRun, useQueue } from "../lib";
import { ClassifyExports, ClassifyTable, type ClassifyResult } from "../results";
import {
  EngineNotice,
  FileDrop,
  FileName,
  RemoveButton,
  RunButton,
  ViewHeader,
  inputClass,
  usable,
} from "../ui";

export function Classify({ engine, onOpenSettings }: { engine: EngineState; onOpenSettings: () => void }) {
  const queue = useQueue<ClassifyResult>();
  const [classes, setClasses] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const ready = usable(engine, true);
  const pending = queue.items.some((i) => i.status !== "done");

  const addDraft = () => {
    const fresh = draft
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c && !classes.some((x) => x.toLowerCase() === c.toLowerCase()));
    if (fresh.length) setClasses([...classes, ...fresh]);
    setDraft("");
  };

  const run = async () => {
    const rows = await queue.run(
      (file) => gaik.api<ClassifyResult>("/classify", { path: file.path, classes }),
      { onlyPending: pending },
    );
    const finished = rows.filter((r) => r.status === "done" || r.status === "error");
    if (finished.length) {
      saveRun({
        tool: "classify",
        title: classes.join(", "),
        count: finished.length,
        data: { rows: finished.map((r) => ({ id: r.id, name: r.name, status: r.status, result: r.result, error: r.error })) },
      });
    }
  };

  const rows = queue.items.map((item) => ({
    id: item.id,
    name: item.name,
    status: item.status,
    result: item.result,
    error: item.error,
    lead: <FileName item={item} />,
    trail: !queue.running && <RemoveButton onClick={() => queue.remove(item.id)} />,
  }));

  return (
    <>
      <ViewHeader title="Classify">
        <RunButton
          running={queue.running}
          disabled={!ready || classes.length < 2 || !queue.items.length}
          done={queue.done}
          total={queue.items.length}
          onRun={run}
          onStop={queue.stop}
          label={pending ? "Classify" : "Classify again"}
        />
      </ViewHeader>
      {!ready ? (
        <EngineNotice engine={engine} needsModel onOpenSettings={onOpenSettings} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-5">
          <section className="shrink-0 rounded-lg border border-line bg-panel p-3">
            <label htmlFor="classes" className="font-medium">
              Classes
            </label>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {classes.map((c) => (
                <span key={c} className="rise inline-flex items-center gap-1 rounded bg-accent-soft py-0.5 pr-1 pl-2 font-medium text-accent">
                  {c}
                  <button
                    type="button"
                    aria-label={`Remove the class ${c}`}
                    className="press opacity-60 hover:opacity-100"
                    onClick={() => setClasses(classes.filter((x) => x !== c))}
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
              <input
                id="classes"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addDraft();
                  } else if (e.key === "Backspace" && !draft && classes.length) {
                    setClasses(classes.slice(0, -1));
                  }
                }}
                onBlur={addDraft}
                placeholder={classes.length ? "Add a class" : "Type a class and press Enter, for example invoice, contract, CV"}
                className={`${inputClass} h-8 min-w-48 flex-1`}
              />
            </div>
            {classes.length === 1 && <p className="mt-1.5 text-xs text-muted">Add at least two classes.</p>}
          </section>
          <FileDrop
            extensions={DOCUMENTS}
            onAdd={queue.add}
            empty={!queue.items.length}
            hint="Each file gets one of your classes, or unknown when none fits. The start of each document goes to your model."
            toolbar={<ClassifyExports rows={rows} name="classification" />}
          >
            <ClassifyTable rows={rows} />
          </FileDrop>
        </div>
      )}
    </>
  );
}
