// Parse and Transcribe share one shape: a file list on the left, the text of the
// selected file on the right.
import { useState, type ReactNode } from "react";
import { gaik, type ApiResult, type EngineState } from "../bridge";
import { saveRun, useQueue, type Item, type Tool } from "../lib";
import { TextPane } from "../results";
import {
  EngineNotice,
  FileDrop,
  FileName,
  RemoveButton,
  RunButton,
  StatusIcon,
  ViewHeader,
  cx,
  usable,
} from "../ui";

export interface TextResult {
  text: string;
  note?: string;
}

export function TextTool({
  engine,
  onOpenSettings,
  tool,
  title,
  runLabel,
  extensions,
  hint,
  extension,
  needsModel,
  options,
  work,
  concurrency,
}: {
  engine: EngineState;
  onOpenSettings: () => void;
  tool: Tool;
  title: string;
  runLabel: string;
  extensions: string[];
  hint: string;
  extension: "md" | "txt";
  needsModel: boolean;
  options?: ReactNode;
  work: (file: Item<TextResult>) => Promise<ApiResult<TextResult>>;
  concurrency?: number;
}) {
  const queue = useQueue<TextResult>();
  const [selected, setSelected] = useState<string | null>(null);
  const ready = usable(engine, needsModel);
  const pending = queue.items.some((i) => i.status !== "done");
  const current =
    queue.items.find((i) => i.id === selected && i.result) ?? queue.items.find((i) => i.result);

  const run = async () => {
    const rows = await queue.run(work, { onlyPending: pending, concurrency });
    const done = rows.filter((r) => r.result);
    if (done.length) {
      saveRun({
        tool,
        title: done.length === 1 ? done[0].name : `${done[0].name} and ${done.length - 1} more`,
        count: done.length,
        data: { rows: done.map((r) => ({ name: r.name, text: r.result!.text })) },
      });
    }
  };

  return (
    <>
      <ViewHeader title={title}>
        {options}
        <RunButton
          running={queue.running}
          disabled={!ready || !queue.items.length}
          done={queue.done}
          total={queue.items.length}
          onRun={run}
          onStop={queue.stop}
          label={pending ? runLabel : `${runLabel} again`}
        />
      </ViewHeader>
      {!ready ? (
        <EngineNotice engine={engine} needsModel={needsModel} onOpenSettings={onOpenSettings} />
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 px-5 pb-5">
          <div className={cx("flex min-h-0 flex-col", current ? "w-80 shrink-0" : "flex-1")}>
            <FileDrop extensions={extensions} onAdd={queue.add} empty={!queue.items.length} hint={hint}>
              <ul className="scroll m-0 min-h-0 flex-1 list-none p-0">
                {queue.items.map((item) => (
                  <li key={item.id} className="group border-b border-line">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => item.result && setSelected(item.id)}
                      onKeyDown={(e) => e.key === "Enter" && item.result && setSelected(item.id)}
                      className={cx(
                        "flex items-center gap-2.5 px-3 py-2",
                        current?.id === item.id ? "bg-accent-soft" : "hover:bg-hover",
                      )}
                    >
                      <span className="flex w-4 shrink-0 justify-center">
                        <StatusIcon status={item.status} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <FileName item={item} />
                        {item.error && <span className="selectable block text-xs text-danger">{item.error}</span>}
                      </span>
                      {!queue.running && <RemoveButton onClick={() => queue.remove(item.id)} />}
                    </div>
                  </li>
                ))}
              </ul>
            </FileDrop>
          </div>
          {current?.result && (
            <TextPane name={current.name} text={current.result.text} extension={extension} note={current.result.note} />
          )}
        </div>
      )}
    </>
  );
}

export function Parse(props: { engine: EngineState; onOpenSettings: () => void }) {
  return (
    <TextTool
      {...props}
      tool="parse"
      title="Parse to text"
      runLabel="Parse"
      extensions={["pdf", "docx", "txt", "md", "png", "jpg", "jpeg", "webp", "tif", "tiff"]}
      hint="PDF and Word files with a text layer are read on this computer without a model. Scans and images are read by your model."
      extension="md"
      needsModel={false}
      work={async (file) => {
        const answer = await gaik.api<{ markdown: string; read: string; characters: number }>("/parse", {
          path: file.path,
          mode: "auto",
        });
        return answer.ok
          ? {
              ok: true,
              data: {
                text: answer.data.markdown,
                note: answer.data.read === "local" ? "Read on this computer" : "Read by the model",
              },
            }
          : answer;
      }}
    />
  );
}

const LANGUAGES = [
  { value: "auto", label: "Detect language" },
  { value: "fi", label: "Finnish" },
  { value: "en", label: "English" },
  { value: "sv", label: "Swedish" },
];

export function Transcribe(props: { engine: EngineState; onOpenSettings: () => void }) {
  const [language, setLanguage] = useState("auto");
  const [enhance, setEnhance] = useState(false);
  return (
    <TextTool
      {...props}
      tool="transcribe"
      title="Transcribe"
      runLabel="Transcribe"
      extensions={["mp3", "wav", "m4a", "mp4", "webm", "ogg", "flac"]}
      hint="Audio and video recordings. The recording is sent to your model provider's speech-to-text model."
      extension="txt"
      needsModel
      concurrency={2}
      options={
        <>
          <select
            aria-label="Language of the recording"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="h-8 rounded-md border border-line bg-panel px-2"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5" title="A second pass where the model corrects recognition errors">
            <input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} className="accent-[var(--accent)]" />
            Correct errors
          </label>
        </>
      }
      work={async (file) => {
        const answer = await gaik.api<{ text: string; enhanced: boolean }>("/transcribe", {
          path: file.path,
          language,
          enhance,
        });
        return answer.ok
          ? { ok: true, data: { text: answer.data.text, note: answer.data.enhanced ? "Corrected by the model" : undefined } }
          : answer;
      }}
    />
  );
}
