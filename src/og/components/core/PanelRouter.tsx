import { useWindows, type PanelInstance } from "./WindowManager";
import { CorePanel } from "./CorePanel";
import { ChatPanelWrap } from "./panels/ChatPanelWrap";
import { MemoryPanel } from "./panels/MemoryPanel";
import { MemoryLogPanel } from "./panels/MemoryLogPanel";
import { LogsPanel } from "./panels/LogsPanel";
import { SettingsPanel } from "./panels/SettingsPanel";
import { ExecutivePanel } from "./panels/ExecutivePanel";
import { ResearchPanel } from "./panels/ResearchPanel";
import { VoicePanel } from "./panels/VoicePanel";
import { ProjectsPanel } from "./panels/ProjectsPanel";
import { FilesPanel } from "./panels/FilesPanel";
import { AgentsPanel } from "./panels/AgentsPanel";

function renderPanel(p: PanelInstance) {
  switch (p.id) {
    case "chat":      return <ChatPanelWrap initialThreadId={p.props?.threadId as string | undefined} />;
    case "memory":    return <MemoryPanel />;
    case "memory-log": return <MemoryLogPanel />;
    case "logs":      return <LogsPanel />;
    case "settings":  return <SettingsPanel />;
    case "executive": return <ExecutivePanel />;
    case "research":  return <ResearchPanel />;
    case "voice":     return <VoicePanel />;
    case "projects":  return <ProjectsPanel />;
    case "files":     return <FilesPanel />;
    case "agents":    return <AgentsPanel />;
    default:          return null;
  }
}

export function PanelRouter() {
  const panels = useWindows((s) => s.panels);
  return (
    <>
      {panels.map((p) => (
        <CorePanel key={p.key} panel={p}>{renderPanel(p)}</CorePanel>
      ))}
    </>
  );
}