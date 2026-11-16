// Result views shared by the tools and the history.
import { Download, FolderDown } from "lucide-react";
import type { ReactNode } from "react";
import { gaik } from "./bridge";
import {
  cellText,
  extractSheets,
  label,
  stem,
  toCsv,
  type ExtractRow,
  type SchemaField,
  type Status,
} from "./lib";
import { Button, CopyButton, StatusIcon, cx, useSaved } from "./ui";

export interface TableRow extends ExtractRow {
  id: string;
  status: Status;
  lead?: ReactNode; // file name cell
  trail?: ReactNode; // row action
}

export function ExtractTable({
  fields,
  rows,
  selected,
  onSelect,
}: {
  fields: SchemaField[];
  rows: TableRow[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="scroll min-h-0 flex-1">
      <table className="w-full border-separate border-spacing-0 text-left">
        <thead className="sticky top-0 z-10 bg-panel">
          <tr className="text-xs text-muted">
            <th className="w-9 border-b border-line" />
            <th className="border-b border-line px-2 py-2 font-medium">File</th>
            {fields.map((f) => (
              <th key={f.name} className="border-b border-line px-3 py-2 font-medium whitespace-nowrap" title={f.description}>
                {label(f.name)}
              </th>
            ))}
            <th className="w-9 border-b border-line" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => onSelect(row.id)}
              aria-selected={selected === row.id}
              className={cx(
                "group cursor-default",
                selected === row.id ? "bg-accent-soft" : "hover:bg-hover",
              )}
            >
              <td className="border-b border-line pl-3">
                <StatusIcon status={row.status} />
              </td>
              <td className="max-w-56 border-b border-line px-2 py-2">{row.lead ?? <span className="font-medium">{row.name}</span>}</td>
              {row.error ? (
                <td colSpan={Math.max(fields.length, 1)} className="selectable border-b border-line px-3 py-2 text-danger">
                  {row.error}
                </td>
              ) : (
                fields.map((f) => {
                  const text = row.record ? cellText(row.record[f.name]) : "";
                  return (
                    <td key={f.name} className="selectable max-w-60 border-b border-line px-3 py-2">
                      <span className={cx("block truncate", !text && "text-muted")} title={text}>
                        {text || (row.record ? "—" : "")}
                      </span>
                    </td>
                  );
                })
              )}
              {!row.error && fields.length === 0 && <td className="border-b border-line" />}
              <td className="border-b border-line pr-2">{row.trail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RecordDetail({
  fields,
  row,
}: {
  fields: SchemaField[];
  row: ExtractRow;
}) {
  const record = row.record ?? {};
  return (
    <aside className="rise scroll selectable w-90 shrink-0 rounded-lg border border-line bg-panel p-4">
      <button
        type="button"
        className="mb-3 block max-w-full truncate text-left font-semibold hover:text-accent"
        title="Show in folder"
        onClick={() => gaik.files.reveal(row.path)}
      >
        {row.name}
      </button>
      <dl className="grid gap-3">
        {fields.map((f) => {
          const value = record[f.name];
          const group = f.children && Array.isArray(value);
          return (
            <div key={f.name}>
              <dt className="text-xs text-muted">{label(f.name)}</dt>
              <dd className="mt-0.5 break-words">
                {group ? (
                  <NestedTable fields={f.children!} rows={value as Record<string, unknown>[]} />
                ) : (
                  cellText(value) || <span className="text-muted">—</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </aside>
  );
}

function NestedTable({ fields, rows }: { fields: SchemaField[]; rows: Record<string, unknown>[] }) {
  if (!rows.length) return <span className="text-muted">—</span>;
  return (
    <div className="scroll mt-1 rounded-md border border-line">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-muted">
            {fields.map((f) => (
              <th key={f.name} className="border-b border-line px-2 py-1.5 font-medium whitespace-nowrap">
                {label(f.name)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {fields.map((f) => (
                <td key={f.name} className="border-b border-line px-2 py-1.5 last:border-b-0">
                  {cellText(r?.[f.name]) || "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExtractExports({
  fields,
  rows,
  name,
}: {
  fields: SchemaField[];
  rows: ExtractRow[];
  name: string;
}) {
  const saved = useSaved();
  const done = rows.filter((r) => r.record);
  if (!done.length) return null;
  const sheets = () => extractSheets(fields, rows);
  return (
    <>
      {saved.element}
      <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
        <Download className="size-3.5" /> Export
      </span>
      <Button onClick={async () => saved.report(await gaik.save.xlsx({ defaultName: `${name}.xlsx`, sheets: sheets() }))}>
        Excel
      </Button>
      <Button onClick={async () => saved.report(await gaik.save.text({ defaultName: `${name}.csv`, content: toCsv(sheets()[0]) }))}>
        CSV
      </Button>
      <Button
        onClick={async () =>
          saved.report(
            await gaik.save.text({
              defaultName: `${name}.json`,
              content: JSON.stringify(done.map((r) => ({ file: r.name, ...r.record })), null, 2),
            }),
          )
        }
      >
        JSON
      </Button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------
export interface ClassifyResult {
  label: string;
  confidence: number | null;
  reasoning: string;
}

export interface ClassifyRow {
  id: string;
  name: string;
  status: Status;
  result?: ClassifyResult;
  error?: string;
  lead?: ReactNode;
  trail?: ReactNode;
}

export function ClassifyTable({ rows }: { rows: ClassifyRow[] }) {
  return (
    <div className="scroll min-h-0 flex-1">
      <table className="w-full border-separate border-spacing-0 text-left">
        <thead className="sticky top-0 z-10 bg-panel">
          <tr className="text-xs text-muted">
            <th className="w-9 border-b border-line" />
            <th className="border-b border-line px-2 py-2 font-medium">File</th>
            <th className="border-b border-line px-3 py-2 font-medium">Class</th>
            <th className="w-28 border-b border-line px-3 py-2 font-medium">Confidence</th>
            <th className="border-b border-line px-3 py-2 font-medium">Why</th>
            <th className="w-9 border-b border-line" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="group hover:bg-hover">
              <td className="border-b border-line pl-3">
                <StatusIcon status={row.status} />
              </td>
              <td className="max-w-56 border-b border-line px-2 py-2">{row.lead ?? <span className="font-medium">{row.name}</span>}</td>
              {row.error ? (
                <td colSpan={3} className="selectable border-b border-line px-3 py-2 text-danger">
                  {row.error}
                </td>
              ) : (
                <>
                  <td className="border-b border-line px-3 py-2">
                    {row.result && (
                      <span className="rise inline-block rounded bg-accent-soft px-2 py-0.5 font-medium whitespace-nowrap text-accent">
                        {row.result.label}
                      </span>
                    )}
                  </td>
                  <td className="border-b border-line px-3 py-2">
                    {row.result && row.result.confidence !== null && <Confidence value={row.result.confidence} />}
                  </td>
                  <td className="selectable border-b border-line px-3 py-2 text-muted">
                    <span className="line-clamp-2 min-w-40" title={row.result?.reasoning}>
                      {row.result?.reasoning}
                    </span>
                  </td>
                </>
              )}
              <td className="border-b border-line pr-2">{row.trail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Confidence({ value }: { value: number }) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
      </span>
      <span className="w-9 text-right text-xs text-muted tabular-nums">{percent} %</span>
    </span>
  );
}

export function ClassifyExports({ rows, name }: { rows: ClassifyRow[]; name: string }) {
  const saved = useSaved();
  const done = rows.filter((r) => r.result);
  if (!done.length) return null;
  const sheet = {
    name: "Classes",
    columns: ["File", "Class", "Confidence", "Why"],
    rows: done.map((r) => [r.name, r.result!.label, r.result!.confidence ?? "", r.result!.reasoning]),
  };
  return (
    <>
      {saved.element}
      <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
        <Download className="size-3.5" /> Export
      </span>
      <Button onClick={async () => saved.report(await gaik.save.xlsx({ defaultName: `${name}.xlsx`, sheets: [sheet] }))}>
        Excel
      </Button>
      <Button onClick={async () => saved.report(await gaik.save.text({ defaultName: `${name}.csv`, content: toCsv(sheet) }))}>
        CSV
      </Button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Text results (parsed documents, transcripts)
// ---------------------------------------------------------------------------
/** Saves every text result into one folder, one file per source file. */
export function SaveAllButton({
  rows,
  extension,
}: {
  rows: { name: string; text: string }[];
  extension: "md" | "txt";
}) {
  const saved = useSaved();
  if (rows.length < 2) return null;
  return (
    <>
      {saved.element}
      <Button
        icon={<FolderDown className="size-4" />}
        onClick={async () =>
          saved.report(
            await gaik.save.folder({
              files: rows.map((r) => ({ name: `${stem(r.name)}.${extension}`, content: r.text })),
            }),
          )
        }
      >
        Save all
      </Button>
    </>
  );
}

export function TextPane({
  name,
  text,
  extension,
  note,
}: {
  name: string;
  text: string;
  extension: "md" | "txt";
  note?: string;
}) {
  const saved = useSaved();
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-line bg-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <span className="truncate font-medium">{name}</span>
        {note && <span className="shrink-0 text-xs text-muted">{note}</span>}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {saved.element}
          <CopyButton text={text} />
          <Button
            icon={<Download className="size-4" />}
            onClick={async () =>
              saved.report(await gaik.save.text({ defaultName: `${stem(name)}.${extension}`, content: text }))
            }
          >
            Save
          </Button>
        </div>
      </div>
      <pre className="scroll selectable m-0 min-h-0 flex-1 p-4 font-mono text-[12.5px] leading-relaxed break-words whitespace-pre-wrap">
        {text}
      </pre>
    </section>
  );
}
