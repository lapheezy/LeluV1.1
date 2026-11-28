/** Dev-only lab: /world-lab.html?f=celestial+urban-neon&q=high&mode=combined renders a composed world full-screen. */
import { createRoot } from "react-dom/client";
import { composeWorld } from "../../../core/worlds/ThemeFamilies";
import WorldStage from "./WorldStage";

const q = new URLSearchParams(location.search);
const world = composeWorld((q.get("f") ?? "celestial").split(/[+ ,]/).filter(Boolean));
if (q.get("q")) world.quality = q.get("q") as typeof world.quality;
if (q.get("mode")) world.mode = q.get("mode") as typeof world.mode;
if (q.get("auto") === "0") world.camera.auto = false;
createRoot(document.getElementById("root")!).render(<div style={{ position: "fixed", inset: 0 }}><WorldStage world={world} /></div>);
