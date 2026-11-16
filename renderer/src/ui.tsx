import {
  AlertCircle,
  Check,
  Copy,
  FilePlus2,
  FolderOpen,
  Loader2,
  Play,
  Square,
  X,
} from "lucide-react";
import { useState, type ButtonHTMLAttributes, type DragEvent, type ReactNode } from "react";
import { gaik, type EngineState, type SaveResult } from "./bridge";
import { formatSize, type Item, type Status } from "./lib";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  icon?: ReactNode;
};

export function Button({ variant = "secondary", icon, className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "press inline-flex h-8 items-center gap-1.5 rounded-md px-3 font-medium whitespace-nowrap disabled:opacity-45",
        variant === "primary" && "bg-accent text-accent-ink hover:brightness-110",
        variant === "secondary" && "border border-line bg-panel hover:bg-hover",
        variant === "ghost" && "text-muted hover:bg-hover hover:text-ink",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        "press inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; hint?: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-panel p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cx(
            "press h-7 rounded px-2.5 font-medium",
            value === o.value ? "bg-accent-soft text-accent" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const inputClass =
  "selectable w-full rounded-md border border-line bg-panel px-2.5 py-1.5 placeholder:text-muted/70 focus-visible:outline-2";

export function StatusIcon({ status }: { status: Status }) {
  if (status === "running") return <Loader2 className="spin size-4 text-accent" aria-label="Working" />;
  if (status === "done") return <Check className="size-4 text-ok" aria-label="Done" />;
  if (status === "error") return <AlertCircle className="size-4 text-danger" aria-label="Failed" />;
  return <span className="block size-1.5 rounded-full bg-line" aria-label="Waiting" />;
}

/** Header of every tool: title on the left, the tool's main actions on the right. */
export function ViewHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="drag flex h-10 shrink-0 items-center gap-3 pr-36 pl-5">
      <h1 className="text-[13px] font-semibold">{title}</h1>
      <div className="no-drag ml-auto flex items-center gap-2">{children}</div>
    </header>
  );
}

export function RunButton({
  running,
  disabled,
  done,
  total,
  onRun,
  onStop,
  label,
}: {
  running: boolean;
  disabled: boolean;
  done: number;
  total: number;
  onRun: () => void;
  onStop: () => void;
  label: string;
}) {
  return running ? (
    <Button onClick={onStop} icon={<Square className="size-3.5" />}>
      Stop after {done}/{total}
    </Button>
  ) : (
    <Button variant="primary" disabled={disabled} onClick={onRun} icon={<Play className="size-3.5" />}>
      {label}
    </Button>
  );
}

/** Add files by dropping them, or with the file and folder pickers. */
export function FileDrop({
  extensions,
  onAdd,
  empty,
  children,
  toolbar,
  hint,
}: {
  extensions: string[];
  onAdd: (files: Awaited<ReturnType<typeof gaik.files.pick>>) => void;
  empty: boolean;
  children?: ReactNode;
  toolbar?: ReactNode;
  hint: string;
}) {
  const [over, setOver] = useState(false);
  const pick = async (kind: "files" | "folder") => onAdd(await gaik.files.pick({ kind, extensions }));
  const drop = async (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const paths = Array.from(event.dataTransfer.files).map((f) => gaik.files.pathFor(f));
    if (paths.length) onAdd(await gaik.files.expand(paths, extensions));
  };
  const buttons = (
    <>
      <Button onClick={() => pick("files")} icon={<FilePlus2 className="size-4" />}>
        Add files
      </Button>
      <Button onClick={() => pick("folder")} icon={<FolderOpen className="size-4" />}>
        Add folder
      </Button>
    </>
  );
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={cx(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-panel transition-colors",
        over ? "border-accent bg-accent-soft" : "border-line",
      )}
    >
      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-[15px] font-medium">Drop files or a folder here</p>
          <p className="max-w-sm text-muted">{hint}</p>
          <div className="mt-1 flex gap-2">{buttons}</div>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
            {buttons}
            <div className="ml-auto flex min-w-0 items-center gap-2">{toolbar}</div>
          </div>
          {children}
        </>
      )}
    </div>
  );
}

export function FileName({ item }: { item: Pick<Item<unknown>, "name" | "size" | "path"> }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="truncate font-medium" title={item.path}>
        {item.name}
      </span>
      <span className="shrink-0 text-xs text-muted tabular-nums">{formatSize(item.size)}</span>
    </span>
  );
}

export function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton
      label="Remove from the list"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
    >
      <X className="size-3.5" />
    </IconButton>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      icon={copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

/** Shows where a file was saved, or why it was not. */
export function useSaved() {
  const [note, setNote] = useState<{ text: string; path?: string; bad?: boolean } | null>(null);
  const report = (result: SaveResult) => {
    if (result.ok) setNote({ text: result.count ? `Saved ${result.count} files` : "Saved", path: result.path });
    else if (!result.canceled) setNote({ text: result.error ?? "Could not save the file.", bad: true });
  };
  const element = note && (
    <span className={cx("rise flex min-w-0 items-center gap-1.5 text-xs", note.bad ? "text-danger" : "text-muted")}>
      <span className="truncate">{note.text}</span>
      {note.path && (
        <button type="button" className="shrink-0 text-accent hover:underline" onClick={() => gaik.files.reveal(note.path!)}>
          Show in folder
        </button>
      )}
    </span>
  );
  return { report, element };
}

/** What a tool shows instead of its content while the engine is not usable. */
export function usable(engine: EngineState, needsModel: boolean): boolean {
  return engine.phase === "ready" && (!needsModel || Boolean(engine.health?.configured));
}

export function EngineNotice({
  engine,
  needsModel,
  onOpenSettings,
}: {
  engine: EngineState;
  needsModel: boolean;
  onOpenSettings: () => void;
}) {
  if (engine.phase === "ready") {
    if (!needsModel || engine.health?.configured) return null;
    return (
      <Notice
        title="Add a model key to use this tool"
        body="GAIK Desktop calls Azure OpenAI or OpenAI with your own key. The key stays on this computer."
        action={<Button variant="primary" onClick={onOpenSettings}>Open settings</Button>}
      />
    );
  }
  if (engine.phase === "error") {
    return (
      <Notice
        bad
        title="The engine could not start"
        body={engine.error ?? "See the log for details."}
        action={
          <>
            <Button variant="primary" onClick={() => gaik.engine.restart()}>Try again</Button>
            <Button onClick={() => gaik.app.openLogs()}>Open log folder</Button>
          </>
        }
      />
    );
  }
  return (
    <Notice
      spinner
      title={engine.phase === "installing" ? "Installing the engine" : "Starting the engine"}
      body={
        engine.phase === "installing"
          ? "First start only: downloading Python and the GAIK toolkit, about 300 MB."
          : "This takes a few seconds."
      }
    />
  );
}

function Notice({
  title,
  body,
  action,
  spinner,
  bad,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  spinner?: boolean;
  bad?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center" aria-live="polite">
      {spinner && <Loader2 className="spin mb-1 size-5 text-accent" />}
      {bad && <AlertCircle className="mb-1 size-5 text-danger" />}
      <p className="text-[15px] font-medium">{title}</p>
      <p className="selectable max-w-md text-muted">{body}</p>
      {action && <div className="mt-2 flex gap-2">{action}</div>}
    </div>
  );
}
