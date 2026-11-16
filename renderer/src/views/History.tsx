import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useRuns, when, type ExtractRow, type Run, type SchemaField, type Tool } from "../lib";
import {
  ClassifyExports,
  ClassifyTable,
  ExtractExports,
  ExtractTable,
  RecordDetail,
  SaveAllButton,
  TextPane,
  type ClassifyRow,
} from "../results";
import { TOOLS } from "../tools";
import { IconButton, ViewHeader, cx } from "../ui";

export function History() {
  const { runs, remove } = useRuns();
  const [selected, setSelected] = useState<string | null>(null);
  const current = runs.find((r) => r.id === selected) ?? runs[0];

  return (
    <>
      <ViewHeader title="History" />
      {!runs.length ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-muted">
          Finished runs are kept here, on this computer.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 px-5 pb-5">
          <ul className="scroll m-0 w-72 shrink-0 list-none rounded-lg border border-line bg-panel p-0">
            {runs.map((run) => {
              const Icon = TOOLS[run.tool].icon;
              return (
                <li key={run.id} className="group border-b border-line last:border-b-0">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelected(run.id)}
                    onKeyDown={(e) => e.key === "Enter" && setSelected(run.id)}
                    className={cx(
                      "flex items-center gap-2.5 px-3 py-2",
                      current?.id === run.id ? "bg-accent-soft" : "hover:bg-hover",
                    )}
                  >
                    <Icon className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{run.title || TOOLS[run.tool].label}</span>
                      <span className="block text-xs text-muted">
                        {when(run.at)}, {run.count} {run.count === 1 ? "file" : "files"}
                      </span>
                    </span>
                    <IconButton
                      label="Delete this run"
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(run.id);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
          {current && <RunView key={current.id} run={current} />}
        </div>
      )}
    </>
  );
}

function RunView({ run }: { run: Run }) {
  const viewers: Record<Tool, () => React.ReactNode> = {
    extract: () => <ExtractRun run={run} />,
    classify: () => <ClassifyRun run={run} />,
    parse: () => <TextRun run={run} extension="md" />,
    transcribe: () => <TextRun run={run} extension="txt" />,
  };
  return <>{viewers[run.tool]()}</>;
}

function ExtractRun({ run }: { run: Run }) {
  const data = run.data as { fields: SchemaField[]; rows: ExtractRow[] };
  const [selected, setSelected] = useState<string | null>(null);
  const rows = data.rows.map((r, i) => ({
    ...r,
    id: String(i),
    status: r.record ? ("done" as const) : ("error" as const),
  }));
  const selectedRow = rows.find((r) => r.id === selected && r.record);
  return (
    <>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-line bg-panel">
        <div className="flex shrink-0 items-center justify-end gap-2 border-b border-line px-3 py-2">
          <ExtractExports fields={data.fields} rows={data.rows} name="extraction" />
        </div>
        <ExtractTable fields={data.fields} rows={rows} selected={selected} onSelect={setSelected} />
      </section>
      {selectedRow && <RecordDetail fields={data.fields} row={selectedRow} />}
    </>
  );
}

function ClassifyRun({ run }: { run: Run }) {
  const data = run.data as { rows: ClassifyRow[] };
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-line bg-panel">
      <div className="flex shrink-0 items-center justify-end gap-2 border-b border-line px-3 py-2">
        <ClassifyExports rows={data.rows} name="classification" />
      </div>
      <ClassifyTable rows={data.rows} />
    </section>
  );
}

function TextRun({ run, extension }: { run: Run; extension: "md" | "txt" }) {
  const data = run.data as { rows: { name: string; text: string }[] };
  const [index, setIndex] = useState(0);
  const row = data.rows[index] ?? data.rows[0];
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      {data.rows.length > 1 && (
        <div className="scroll flex shrink-0 items-center gap-1">
          {data.rows.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              className={cx(
                "press max-w-48 shrink-0 truncate rounded-md px-2.5 py-1",
                i === index ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-hover",
              )}
            >
              {r.name}
            </button>
          ))}
          <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
            <SaveAllButton rows={data.rows} extension={extension} />
          </div>
        </div>
      )}
      {row && <TextPane name={row.name} text={row.text} extension={extension} />}
    </div>
  );
}
