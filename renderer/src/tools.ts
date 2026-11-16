import { AudioLines, FileText, Table2, Tags, type LucideIcon } from "lucide-react";
import type { Tool } from "./lib";

export const TOOLS: Record<Tool, { label: string; icon: LucideIcon }> = {
  extract: { label: "Extract data", icon: Table2 },
  parse: { label: "Parse to text", icon: FileText },
  classify: { label: "Classify", icon: Tags },
  transcribe: { label: "Transcribe", icon: AudioLines },
};
