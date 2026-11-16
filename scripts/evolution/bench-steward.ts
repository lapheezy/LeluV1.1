import { planWorkspace, parseWorkspaceCommand } from "../../src/core/interface/WorkspaceSteward";
const ids = ["chat:a", "projects", "browser", "eng-studio", "voice-studio", "security-center", "infra-monitor", "agents"];
const windows = ids.map((id, i) => ({ id, label: id, order: i, presentation: "inline" as const }));
for (const [w, h, mode] of [[1440, 900, "auto"], [1440, 900, "tile"], [393, 852, "auto"]] as const) {
  const n = 5000; const t = performance.now();
  for (let i = 0; i < n; i++) planWorkspace({ viewport: { width: w, height: h }, windows, mode });
  console.log(`planWorkspace 8 windows ${w}x${h} ${mode}: ${(((performance.now() - t) / n) * 1000).toFixed(1)} µs/plan`);
}
const n = 20000; const t = performance.now();
for (let i = 0; i < n; i++) parseWorkspaceCommand("put the browser beside the chat");
console.log(`parseWorkspaceCommand: ${(((performance.now() - t) / n) * 1000).toFixed(2)} µs/call`);
