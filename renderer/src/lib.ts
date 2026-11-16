import { useCallback, useEffect, useRef, useState } from "react";
import { gaik, type ApiResult, type PickedFile, type Sheet } from "./bridge";

export const DOCUMENTS = ["pdf", "docx", "txt", "md", "png", "jpg", "jpeg", "webp", "tif", "tiff"];
export const AUDIO = ["mp3", "wav", "m4a", "mp4", "webm", "ogg", "flac"];

export type Status = "queued" | "running" | "done" | "error";

export interface Item<R> extends PickedFile {
  id: string;
  status: Status;
  result?: R;
  error?: string;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function stem(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** A list of files processed a few at a time; rows update in place. */
export function useQueue<R>() {
  const [items, setItems] = useState<Item<R>[]>([]);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const add = useCallback((files: PickedFile[]) => {
    setItems((current) => {
      const known = new Set(current.map((i) => i.path));
      const fresh = files
        .filter((f) => !known.has(f.path))
        .map((f) => ({ ...f, id: crypto.randomUUID(), status: "queued" as const }));
      return [...current, ...fresh];
    });
  }, []);

  const remove = useCallback((id: string) => {
    setItems((current) => current.filter((i) => i.id !== id));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  /** Forgets every result, so old answers are not shown under new settings. */
  const reset = useCallback(() => {
    setItems((current) =>
      current.map((i) => ({ ...i, status: "queued", result: undefined, error: undefined })),
    );
  }, []);

  const patch = (id: string, change: Partial<Item<R>>) =>
    setItems((current) => current.map((i) => (i.id === id ? { ...i, ...change } : i)));

  /** Runs `work` over every file (or only the unfinished ones) and returns the final rows. */
  const run = useCallback(
    async (
      work: (file: Item<R>) => Promise<ApiResult<R>>,
      options: { onlyPending?: boolean; concurrency?: number } = {},
    ): Promise<Item<R>[]> => {
      const todo = itemsRef.current.filter((i) => !options.onlyPending || i.status !== "done");
      if (!todo.length) return itemsRef.current;
      stopRef.current = false;
      setRunning(true);
      const ids = new Set(todo.map((i) => i.id));
      setItems((current) =>
        current.map((i) =>
          ids.has(i.id) ? { ...i, status: "queued", result: undefined, error: undefined } : i,
        ),
      );
      const final = new Map<string, Partial<Item<R>>>();
      let next = 0;
      const worker = async () => {
        while (!stopRef.current && next < todo.length) {
          const file = todo[next++];
          patch(file.id, { status: "running" });
          let change: Partial<Item<R>>;
          try {
            const answer = await work(file);
            change = answer.ok
              ? { status: "done", result: answer.data }
              : { status: "error", error: answer.error };
          } catch (err) {
            change = { status: "error", error: err instanceof Error ? err.message : String(err) };
          }
          final.set(file.id, change);
          patch(file.id, change);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(options.concurrency ?? 3, todo.length) }, worker),
      );
      setRunning(false);
      return itemsRef.current.map((i) => {
        const change = final.get(i.id);
        return change ? { ...i, ...change } : ids.has(i.id) ? { ...i, status: "queued" } : i;
      });
    },
    [],
  );

  const stop = useCallback(() => {
    stopRef.current = true;
  }, []);

  const done = items.filter((i) => i.status === "done" || i.status === "error").length;
  return { items, add, remove, clear, reset, run, stop, running, done };
}

// ---------------------------------------------------------------------------
// History of finished runs, kept in the app's data folder
// ---------------------------------------------------------------------------
export type Tool = "extract" | "parse" | "classify" | "transcribe";

export interface Run {
  id: string;
  tool: Tool;
  at: string;
  title: string;
  count: number;
  data: unknown;
}

const MAX_RUNS = 100;
const listeners = new Set<() => void>();

export async function saveRun(run: Omit<Run, "id" | "at">): Promise<void> {
  const runs = (await gaik.data.get<Run[]>("runs")) ?? [];
  runs.unshift({ ...run, id: crypto.randomUUID(), at: new Date().toISOString() });
  await gaik.data.set("runs", runs.slice(0, MAX_RUNS));
  listeners.forEach((fn) => fn());
}

export function useRuns() {
  const [runs, setRuns] = useState<Run[]>([]);
  const load = useCallback(() => {
    gaik.data.get<Run[]>("runs").then((r) => setRuns(r ?? []));
  }, []);
  useEffect(() => {
    load();
    listeners.add(load);
    return () => {
      listeners.delete(load);
    };
  }, [load]);
  const remove = async (id: string) => {
    const next = runs.filter((r) => r.id !== id);
    setRuns(next);
    await gaik.data.set("runs", next);
  };
  return { runs, remove };
}

// ---------------------------------------------------------------------------
// Extraction results: fields, cells and exports
// ---------------------------------------------------------------------------
export interface SchemaField {
  name: string;
  type: string;
  description: string;
  children: SchemaField[] | null;
}

export interface ExtractRow {
  name: string;
  path: string;
  record?: Record<string, unknown>;
  error?: string;
}

export function label(name: string): string {
  const text = name.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) {
    return value.every((v) => typeof v !== "object")
      ? value.join("; ")
      : `${value.length} ${value.length === 1 ? "item" : "items"}`;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const flat = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map((v) => (typeof v === "object" ? JSON.stringify(v) : v)).join("; ")
    : value !== null && typeof value === "object"
      ? JSON.stringify(value)
      : (value ?? "");

/** One sheet of results plus one sheet per repeated group (line items and the like). */
export function extractSheets(fields: SchemaField[], rows: ExtractRow[]): Sheet[] {
  const done = rows.filter((r) => r.record);
  const scalars = fields.filter((f) => !f.children);
  const sheets: Sheet[] = [
    {
      name: "Results",
      columns: ["File", ...scalars.map((f) => label(f.name))],
      rows: done.map((r) => [r.name, ...scalars.map((f) => flat(r.record![f.name]))]),
    },
  ];
  for (const group of fields.filter((f) => f.children)) {
    const children = group.children!;
    const groupRows: unknown[][] = [];
    for (const r of done) {
      const list = r.record![group.name];
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        const record = (entry ?? {}) as Record<string, unknown>;
        groupRows.push([r.name, ...children.map((c) => flat(record[c.name]))]);
      }
    }
    sheets.push({
      name: label(group.name),
      columns: ["File", ...children.map((c) => label(c.name))],
      rows: groupRows,
    });
  }
  return sheets;
}

export function toCsv(sheet: Sheet): string {
  const cell = (value: unknown) => {
    const text = String(value ?? "");
    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  // BOM so Excel reads UTF-8; semicolons so it splits columns in Finnish locales too.
  return (
    "﻿" +
    [sheet.columns, ...sheet.rows].map((row) => row.map(cell).join(";")).join("\r\n") +
    "\r\n"
  );
}

export function when(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
