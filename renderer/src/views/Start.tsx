import { Check, Loader2, AlertCircle } from "lucide-react";
import type { ReactNode } from "react";
import { gaik, type EngineState } from "../bridge";
import { Button, ViewHeader, cx } from "../ui";

type StepState = "done" | "working" | "todo" | "failed";

/** First-run guide: the three things that must be true before a first result. */
export function Start({
  engine,
  onOpenSettings,
  onTrySamples,
  onOpenExtract,
}: {
  engine: EngineState;
  onOpenSettings: () => void;
  onTrySamples: () => void;
  onOpenExtract: () => void;
}) {
  const ready = engine.phase === "ready";
  const configured = ready && Boolean(engine.health?.configured);
  const engineState: StepState = ready ? "done" : engine.phase === "error" ? "failed" : "working";

  return (
    <>
      <ViewHeader title="Get started" />
      <div className="scroll min-h-0 flex-1 px-5 pb-8">
        <div className="mx-auto max-w-2xl">
          <h2 className="mt-6 text-[22px] font-semibold tracking-tight">Run the GAIK Toolkit on your own files</h2>
          <p className="mt-1.5 text-muted">
            Files are read on this computer. Only their text or page images go to the model provider you choose.
          </p>

          <ol className="m-0 mt-6 grid list-none gap-3 p-0">
            <Step
              number={1}
              state={engineState}
              title={
                ready
                  ? "The engine is ready"
                  : engine.phase === "installing"
                    ? "Installing the engine"
                    : engine.phase === "error"
                      ? "The engine could not start"
                      : "Starting the engine"
              }
              body={
                ready
                  ? `GAIK toolkit ${engine.health?.gaik ?? ""} runs locally.`
                  : engine.phase === "installing"
                    ? "First start only: Python and the GAIK toolkit are downloaded, about 300 MB. This takes a few minutes."
                    : engine.phase === "error"
                      ? (engine.error ?? "See the log for details.")
                      : "This takes a few seconds."
              }
              action={
                engine.phase === "error" && (
                  <>
                    <Button variant="primary" onClick={() => gaik.engine.restart()}>
                      Try again
                    </Button>
                    <Button onClick={() => gaik.app.openLogs()}>Open log folder</Button>
                  </>
                )
              }
            />
            <Step
              number={2}
              state={configured ? "done" : "todo"}
              title={configured ? "Your model is connected" : "Add your model key"}
              body={
                configured
                  ? `${engine.health?.model} (${engine.health?.provider}). Change it in Settings.`
                  : "Azure OpenAI or OpenAI. The key is stored encrypted on this computer. Parsing documents that have a text layer works without a key."
              }
              action={
                !configured && (
                  <Button variant="primary" onClick={onOpenSettings}>
                    Open settings
                  </Button>
                )
              }
            />
            <Step
              number={3}
              state="todo"
              title="Try it with three sample invoices"
              body="Opens Extract data with made-up invoices and a ready field list. Press Extract."
              action={
                <>
                  <Button variant={configured ? "primary" : "secondary"} disabled={!configured} onClick={onTrySamples}>
                    Try with sample invoices
                  </Button>
                  <Button variant="ghost" onClick={onOpenExtract}>
                    Use my own files
                  </Button>
                </>
              }
            />
          </ol>
          <p className="mt-6 text-muted">
            Every toolkit component and use case can be tried in the{" "}
            <a
              href="https://gaik-demo.2.rahtiapp.fi/"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline underline-offset-2"
            >
              hosted demo
            </a>
            , and the{" "}
            <a
              href="https://gaik-project.github.io/gaik-toolkit/"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline underline-offset-2"
            >
              documentation
            </a>{" "}
            explains them.
          </p>
        </div>
      </div>
    </>
  );
}

function Step({
  number,
  state,
  title,
  body,
  action,
}: {
  number: number;
  state: StepState;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <li className="flex gap-4 rounded-lg border border-line bg-panel p-4">
      <span
        className={cx(
          "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
          state === "done" && "bg-ok/15 text-ok",
          state === "working" && "bg-accent-soft text-accent",
          state === "failed" && "bg-danger/15 text-danger",
          state === "todo" && "border border-line text-muted",
        )}
        aria-hidden
      >
        {state === "done" ? (
          <Check className="size-4" />
        ) : state === "working" ? (
          <Loader2 className="spin size-4" />
        ) : state === "failed" ? (
          <AlertCircle className="size-4" />
        ) : (
          number
        )}
      </span>
      <div className="min-w-0 flex-1" aria-live="polite">
        <h3 className="font-semibold">{title}</h3>
        <p className="selectable mt-0.5 text-muted">{body}</p>
        {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
      </div>
    </li>
  );
}
