// Types for the bridge that src/preload.js exposes as window.gaik.

export type EnginePhase = "installing" | "starting" | "ready" | "error";

export interface EngineState {
  phase: EnginePhase;
  error: string | null;
  health: {
    gaik: string;
    configured: boolean;
    model: string | null;
    provider: string | null;
  } | null;
  log: string[];
}

export interface PickedFile {
  path: string;
  name: string;
  size: number;
}

export interface SettingsView {
  provider: "azure" | "openai";
  azureEndpoint: string;
  azureApiVersion: string;
  model: string;
  azureApiKeySet: boolean;
  openaiApiKeySet: boolean;
  extraEnvSet: boolean;
  fromEnvironment?: boolean;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };
export type SaveResult =
  | { ok: true; path: string; count?: number }
  | { ok: false; canceled?: boolean; error?: string };

export interface Sheet {
  name: string;
  columns: string[];
  rows: unknown[][];
}

export interface Bridge {
  engine: {
    get(): Promise<EngineState>;
    restart(): Promise<void>;
    onChange(fn: (state: EngineState) => void): () => void;
  };
  api<T>(route: string, body?: unknown): Promise<ApiResult<T>>;
  settings: {
    get(): Promise<SettingsView>;
    save(form: Record<string, unknown>): Promise<{ ok: boolean; error?: string; settings?: SettingsView }>;
  };
  files: {
    pick(options: { kind: "files" | "folder"; extensions: string[] }): Promise<PickedFile[]>;
    expand(paths: string[], extensions: string[]): Promise<PickedFile[]>;
    reveal(file: string): Promise<void>;
    pathFor(file: File): string;
  };
  save: {
    text(options: { defaultName: string; content: string }): Promise<SaveResult>;
    xlsx(options: { defaultName: string; sheets: Sheet[] }): Promise<SaveResult>;
    folder(options: { files: { name: string; content: string }[] }): Promise<SaveResult>;
  };
  samples(): Promise<{
    files: PickedFile[];
    text: string;
    requirements_json: Record<string, unknown>;
  }>;
  data: {
    get<T>(name: "recipes" | "runs"): Promise<T | null>;
    set(name: "recipes" | "runs", value: unknown): Promise<boolean>;
  };
  app: {
    info(): Promise<{ version: string; dataFolder: string; platform: string }>;
    openLogs(): Promise<void>;
  };
}

declare global {
  interface Window {
    gaik: Bridge;
  }
}

export const gaik = window.gaik;
