import { History as HistoryIcon, Rocket, Settings as SettingsIcon, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { gaik, type EngineState, type PickedFile } from "./bridge";
import type { Run, Tool } from "./lib";
import { TOOLS } from "./tools";
import { cx } from "./ui";
import { Classify } from "./views/Classify";
import { Extract } from "./views/Extract";
import { History } from "./views/History";
import { Settings } from "./views/Settings";
import { Start } from "./views/Start";
import { Parse, Transcribe } from "./views/TextTool";

type View = Tool | "start" | "history" | "settings";
const TOOL_ORDER: Tool[] = ["extract", "parse", "classify", "transcribe"];

export interface Seed {
  nonce: number;
  files: PickedFile[];
  text: string;
  requirements_json: Record<string, unknown>;
}

export function App() {
  // A first-time user lands on the guide; someone with finished runs on Extract.
  const [view, setView] = useState<View | null>(null);
  const [engine, setEngine] = useState<EngineState>({ phase: "starting", error: null, health: null, log: [] });
  const [seed, setSeed] = useState<Seed | null>(null);

  useEffect(() => {
    gaik.engine.get().then(setEngine);
    gaik.data.get<Run[]>("runs").then((runs) => setView((v) => v ?? (runs?.length ? "extract" : "start")));
    return gaik.engine.onChange(setEngine);
  }, []);

  const openSettings = () => setView("settings");
  const shared = { engine, onOpenSettings: openSettings };
  const trySamples = async () => {
    setSeed({ nonce: Date.now(), ...(await gaik.samples()) });
    setView("extract");
  };

  if (view === null) return null;

  return (
    <div className="grid h-full grid-cols-[13.5rem_1fr]">
      <nav className="flex min-h-0 flex-col border-r border-line bg-rail" aria-label="Tools">
        <div className="drag flex h-10 shrink-0 items-center px-4 text-[13px] font-semibold tracking-tight">
          GAIK Desktop
        </div>
        <div className="flex flex-1 flex-col gap-0.5 px-2 pt-1">
          <NavItem icon={Rocket} label="Get started" active={view === "start"} onClick={() => setView("start")} />
          <div className="my-2 border-t border-line" />
          {TOOL_ORDER.map((tool) => (
            <NavItem
              key={tool}
              icon={TOOLS[tool].icon}
              label={TOOLS[tool].label}
              active={view === tool}
              onClick={() => setView(tool)}
            />
          ))}
          <div className="my-2 border-t border-line" />
          <NavItem icon={HistoryIcon} label="History" active={view === "history"} onClick={() => setView("history")} />
          <div className="mt-auto pb-2">
            <EngineStatus engine={engine} onClick={openSettings} />
            <NavItem icon={SettingsIcon} label="Settings" active={view === "settings"} onClick={openSettings} />
          </div>
        </div>
      </nav>

      {/* Every view stays mounted, so a run keeps going while you look at another tool. */}
      <main className="relative min-w-0">
        <Pane show={view === "start"}>
          <Start
            engine={engine}
            onOpenSettings={openSettings}
            onTrySamples={trySamples}
            onOpenExtract={() => setView("extract")}
          />
        </Pane>
        <Pane show={view === "extract"}><Extract {...shared} seed={seed} /></Pane>
        <Pane show={view === "parse"}><Parse {...shared} /></Pane>
        <Pane show={view === "classify"}><Classify {...shared} /></Pane>
        <Pane show={view === "transcribe"}><Transcribe {...shared} /></Pane>
        <Pane show={view === "history"}><History /></Pane>
        <Pane show={view === "settings"}><Settings engine={engine} /></Pane>
      </main>
    </div>
  );
}

function Pane({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div className={cx("absolute inset-0 flex-col", show ? "flex" : "hidden")} aria-hidden={!show}>
      {children}
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cx(
        "press flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left",
        active ? "bg-panel font-medium text-ink shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:bg-hover hover:text-ink",
      )}
    >
      <Icon className={cx("size-4", active && "text-accent")} />
      {label}
    </button>
  );
}

function EngineStatus({ engine, onClick }: { engine: EngineState; onClick: () => void }) {
  const ready = engine.phase === "ready";
  const configured = Boolean(engine.health?.configured);
  const text = !ready
    ? engine.phase === "error"
      ? "Engine stopped"
      : engine.phase === "installing"
        ? "Installing engine"
        : "Starting engine"
    : configured
      ? engine.health!.model
      : "No model key";
  const color = engine.phase === "error" ? "bg-danger" : ready && configured ? "bg-ok" : "bg-muted";
  return (
    <button
      type="button"
      onClick={onClick}
      title={ready && configured ? `Model: ${engine.health!.model} (${engine.health!.provider})` : undefined}
      className="press mb-1 flex h-7 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-xs text-muted hover:bg-hover"
    >
      <span className="flex w-4 justify-center">
        <span className={cx("block size-2 rounded-full", color, !ready && engine.phase !== "error" && "animate-pulse")} />
      </span>
      <span className="truncate">{text}</span>
    </button>
  );
}
