/**
 * ==========================================================
 * LÉLU
 * GENESIS VIDEO PANEL — the Video workspace
 *
 * V1 delivers the video architecture: Video Project →
 * Storyboard → Scenes → Assets → Timeline → Audio → Render.
 * Projects, shots, scenes, assets and timeline tracks are
 * fully functional and persistent. Actual video encoding /
 * cloud generation is PROVIDER-DEPENDENT and marked as such.
 * ==========================================================
 */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import GenesisWindowFrame from "./GenesisWindowFrame";
import VideoStore, { type VideoProject, type VideoAsset, type TimelineTrack } from "../../../core/creative/VideoProject";
import RenderEngineRegistry from "../../../core/creative/RenderEngine";

const fieldStyle: CSSProperties = {
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 8,
  padding: "7px 9px",
  color: "white",
  fontSize: 12,
  outline: "none",
  fontFamily: "inherit",
};

const chipButton: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 8,
  background: "rgba(255,255,255,0.06)",
  color: "white",
  padding: "6px 11px",
  fontSize: 11.5,
  cursor: "pointer",
  fontFamily: "inherit",
};

interface GenesisVideoPanelProps {
  onClose: () => void;
}

export default function GenesisVideoPanel({ onClose }: GenesisVideoPanelProps) {
  const store = useMemo(() => VideoStore.getInstance(), []);
  const engines = useMemo(() => RenderEngineRegistry.getInstance().all(), []);

  const [projects, setProjects] = useState<VideoProject[]>(() => store.list());
  const [projectId, setProjectId] = useState<string | null>(() => store.list()[0]?.id ?? null);
  const [newTitle, setNewTitle] = useState("");
  const [shotTitle, setShotTitle] = useState("");
  const [shotDesc, setShotDesc] = useState("");
  const [shotDur, setShotDur] = useState(5);
  const [sceneTitle, setSceneTitle] = useState("");
  const [assetName, setAssetName] = useState("");
  const [assetText, setAssetText] = useState("");
  const [trackAdd, setTrackAdd] = useState<"visual" | "audio" | "text">("visual");
  const [startSec, setStartSec] = useState(0);
  const [durSec, setDurSec] = useState(4);

  useEffect(() => {
    return store.subscribe((next) => {
      setProjects(next);
      setProjectId((current) => (current && next.some((project) => project.id === current) ? current : (next[0]?.id ?? null)));
    });
  }, [store]);

  const project = projects.find((item) => item.id === projectId) ?? null;
  const videoEngines = engines.filter((engine) => engine.supports.includes("generate"));

  function createProject() {
    const name = newTitle.trim() || `Video ${projects.length + 1}`;
    store.create(name);
    setNewTitle("");
  }

  function addAsset(kind: VideoAsset["kind"]) {
    if (!project) {
      return;
    }
    if (kind === "text") {
      if (!assetText.trim()) {
        return;
      }
      store.addAsset(project.id, { kind, name: assetName.trim() || "Text asset", text: assetText.trim() });
      setAssetText("");
      setAssetName("");
    } else {
      // image/video/audio uploads come through a file input (below)
      const input = document.createElement("input");
      input.type = "file";
      input.accept = kind === "image" ? "image/*" : kind === "video" ? "video/*" : "audio/*";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          store.addAsset(project.id, { kind, name: assetName.trim() || file.name, ref: String(reader.result) });
          setAssetName("");
        };
        reader.readAsDataURL(file);
      };
      input.click();
    }
  }

  function addTimelineItem(asset: VideoAsset) {
    if (!project) {
      return;
    }
    const track = project.timeline.find((item) => item.kind === trackAdd);
    if (!track) {
      return;
    }
    const item = { id: `tl-${crypto.randomUUID().slice(0, 8)}`, assetId: asset.id, startSec, durationSec: durSec, note: asset.name };
    store.update(project.id, {
      timeline: project.timeline.map((t) => (t.id === track.id ? { ...t, items: [...t.items, item] } : t)),
    });
    store.refreshStatus(project.id);
  }

  function removeTimelineItem(track: TimelineTrack, itemId: string) {
    if (!project) {
      return;
    }
    store.update(project.id, {
      timeline: project.timeline.map((t) => (t.id === track.id ? { ...t, items: t.items.filter((i) => i.id !== itemId) } : t)),
    });
  }

  const totalDuration = project
    ? Math.max(...project.timeline.flatMap((track) => track.items.map((item) => item.startSec + item.durationSec)), 0)
    : 0;

  return (
    <GenesisWindowFrame
      eyebrow="LÉLU · Motion Studio"
      title="Video · project pipeline"
      onClose={onClose}
      width="min(97vw, 1180px)"
      maxHeight="min(92vh, 940px)"
      elevation="focus"
    >
      <div style={{ display: "flex", gap: 14, minHeight: "min(72vh, 700px)" }}>
        {/* ---------------------------------------------- project list */}
        <div
          style={{
            width: 240,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 14,
            padding: 12,
            background: "rgba(255,255,255,0.03)",
            overflowY: "auto",
          }}
        >
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6 }}>
            Video projects
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Project name" style={{ ...fieldStyle, flex: 1 }} />
            <button type="button" onClick={createProject} style={chipButton}>
              ＋
            </button>
          </div>
          {projects.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setProjectId(item.id)}
              style={{
                textAlign: "left",
                borderRadius: 10,
                padding: "9px 11px",
                border: projectId === item.id ? "1px solid rgba(125, 211, 252, 0.45)" : "1px solid rgba(255,255,255,0.1)",
                background: projectId === item.id ? "rgba(34, 211, 238, 0.1)" : "rgba(255,255,255,0.02)",
                color: "white",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</div>
              <div style={{ fontSize: 10.5, opacity: 0.6, marginTop: 2 }}>
                {item.shots.length} shots · {item.assets.length} assets · <span style={{ color: "#9be8ff" }}>{item.status}</span>
              </div>
            </button>
          ))}
        </div>

        {/* ---------------------------------------------- project detail */}
        {!project ? (
          <div style={{ flex: 1, opacity: 0.6, fontSize: 12.5 }}>Create a video project to begin the pipeline.</div>
        ) : (
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", paddingRight: 4 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{project.name}</div>
                <input
                  value={project.description}
                  onChange={(event) => store.update(project.id, { description: event.target.value })}
                  placeholder="Project description"
                  style={{ ...fieldStyle, marginTop: 6 }}
                />
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" onClick={() => store.update(project.id, { status: "in-progress" })} style={chipButton}>
                  Mark in-progress
                </button>
                <button type="button" onClick={() => store.remove(project.id)} style={{ ...chipButton, color: "#fca5a5" }}>
                  Delete
                </button>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginBottom: 6 }}>
                Concept
              </div>
              <textarea
                value={project.concept}
                onChange={(event) => store.update(project.id, { concept: event.target.value })}
                placeholder='e.g. "20-second promo for the Malachite pendant — candlelit close-ups, gold flashes, slow reveal."'
                rows={2}
                style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.45 }}
              />
            </div>

            {/* storyboard */}
            <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 12 }}>
              <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginBottom: 8 }}>
                Storyboard · {project.shots.length} shots
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                <input value={shotTitle} onChange={(event) => setShotTitle(event.target.value)} placeholder="Shot title" style={{ ...fieldStyle, width: 160 }} />
                <input value={shotDesc} onChange={(event) => setShotDesc(event.target.value)} placeholder="Shot description / camera" style={{ ...fieldStyle, flex: 1, minWidth: 180 }} />
                <input type="number" value={shotDur} min={1} max={60} onChange={(event) => setShotDur(Number(event.target.value))} style={{ ...fieldStyle, width: 70 }} />
                <button
                  type="button"
                  onClick={() => {
                    if (shotTitle.trim()) {
                      store.addStoryboardShot(project.id, shotTitle.trim(), shotDesc.trim(), );
                      setShotTitle("");
                      setShotDesc("");
                    }
                  }}
                  style={chipButton}
                >
                  ＋ Shot
                </button>
              </div>
              {project.shots.length === 0 ? (
                <div style={{ fontSize: 11.5, opacity: 0.5 }}>No shots yet — storyboard frames are structured concepts (visual frames need a render engine).</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {project.shots.map((shot, index) => (
                    <div key={shot.id} style={{ display: "flex", gap: 10, alignItems: "center", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "8px 10px", background: "rgba(255,255,255,0.02)" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.6, width: 22 }}>{index + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{shot.title}</div>
                        {shot.description ? <div style={{ fontSize: 11, opacity: 0.65 }}>{shot.description}</div> : null}
                      </div>
                      <span style={{ fontSize: 10.5, opacity: 0.6, whiteSpace: "nowrap" }}>{shot.durationSec}s</span>
                      <button type="button" onClick={() => store.removeShot(project.id, shot.id)} style={{ ...chipButton, fontSize: 10, padding: "3px 8px", color: "#fca5a5" }}>
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* scenes */}
            <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 12 }}>
              <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginBottom: 8 }}>
                Scenes · {project.scenes.length}
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <input value={sceneTitle} onChange={(event) => setSceneTitle(event.target.value)} placeholder="Scene title" style={{ ...fieldStyle, flex: 1 }} />
                <button
                  type="button"
                  onClick={() => {
                    if (sceneTitle.trim()) {
                      store.addScene(project.id, sceneTitle.trim());
                      setSceneTitle("");
                    }
                  }}
                  style={chipButton}
                >
                  ＋ Scene
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {project.scenes.map((scene) => (
                  <div key={scene.id} style={{ fontSize: 12, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "8px 10px", background: "rgba(255,255,255,0.02)" }}>
                    <strong>{scene.title}</strong>
                    <span style={{ opacity: 0.55 }}> · {scene.shotIds.length} shots · {scene.assetIds.length} assets</span>
                    <textarea
                      value={scene.animationNotes}
                      onChange={(event) =>
                        store.update(project.id, {
                          scenes: project.scenes.map((s) => (s.id === scene.id ? { ...s, animationNotes: event.target.value } : s)),
                        })
                      }
                      placeholder="Animation notes…"
                      rows={1}
                      style={{ ...fieldStyle, marginTop: 6, resize: "vertical" }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* assets */}
            <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 12 }}>
              <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginBottom: 8 }}>
                Assets · {project.assets.length}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                <input value={assetName} onChange={(event) => setAssetName(event.target.value)} placeholder="Asset name" style={{ ...fieldStyle, width: 150 }} />
                {(
                  [
                    ["image", "🖼 Image"],
                    ["video", "🎞 Video"],
                    ["audio", "🎵 Audio"],
                    ["text", "📝 Text"],
                  ] as const
                ).map(([kind, label]) => (
                  <button key={kind} type="button" onClick={() => addAsset(kind)} style={chipButton}>
                    {label}
                  </button>
                ))}
              </div>
              {assetName && <input value={assetText} onChange={(event) => setAssetText(event.target.value)} placeholder="Text content (captions, voice-over…) for text assets" style={{ ...fieldStyle, marginBottom: 8 }} />}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {project.assets.map((asset) => (
                  <div key={asset.id} style={{ display: "flex", gap: 10, alignItems: "center", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "8px 10px", background: "rgba(255,255,255,0.02)", fontSize: 12 }}>
                    <span style={{ opacity: 0.6, width: 52 }}>{asset.kind}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{asset.name}</span>
                    <button
                      type="button"
                      onClick={() => addTimelineItem(asset)}
                      title={`Add to ${trackAdd} track at ${startSec}s`}
                      style={{ ...chipButton, fontSize: 10, padding: "3px 8px" }}
                    >
                      ＋ timeline
                    </button>
                  </div>
                ))}
                {project.assets.length === 0 ? <div style={{ fontSize: 11.5, opacity: 0.5 }}>Add image, video, audio or text assets to the project.</div> : null}
              </div>
            </div>

            {/* timeline */}
            <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 12 }}>
              <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginBottom: 8 }}>
                Timeline · {totalDuration}s total
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8, alignItems: "center", fontSize: 11.5 }}>
                <span style={{ opacity: 0.7 }}>Add to track:</span>
                <select value={trackAdd} onChange={(event) => setTrackAdd(event.target.value as typeof trackAdd)} style={{ ...fieldStyle, width: 110 }}>
                  <option value="visual">Visual</option>
                  <option value="audio">Audio</option>
                  <option value="text">Text</option>
                </select>
                <span style={{ opacity: 0.7 }}>start</span>
                <input type="number" min={0} value={startSec} onChange={(event) => setStartSec(Number(event.target.value))} style={{ ...fieldStyle, width: 64 }} />
                <span style={{ opacity: 0.7 }}>dur</span>
                <input type="number" min={1} value={durSec} onChange={(event) => setDurSec(Number(event.target.value))} style={{ ...fieldStyle, width: 64 }} />
              </div>
              {project.timeline.map((track) => (
                <div key={track.id} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
                    {track.name} · {track.items.length}
                  </div>
                  <div style={{ position: "relative", height: 26, borderRadius: 8, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
                    {track.items.map((item) => {
                      const width = totalDuration > 0 ? (item.durationSec / totalDuration) * 100 : 8;
                      const left = totalDuration > 0 ? (item.startSec / totalDuration) * 100 : 0;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          title={`${item.note ?? "item"} · ${item.startSec}s → ${item.startSec + item.durationSec}s`}
                          onClick={() => removeTimelineItem(track, item.id)}
                          style={{
                            position: "absolute",
                            left: `${left}%`,
                            top: 3,
                            height: 20,
                            width: `calc(${width}% - 2px)`,
                            minWidth: 12,
                            borderRadius: 6,
                            border: "none",
                            background:
                              track.kind === "visual"
                                ? "rgba(34, 211, 238, 0.55)"
                                : track.kind === "audio"
                                  ? "rgba(167, 139, 250, 0.55)"
                                  : "rgba(251, 191, 36, 0.55)",
                            cursor: "pointer",
                            color: "#041018",
                            fontSize: 9,
                            textAlign: "center",
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {item.note?.slice(0, 14)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* render */}
            <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 12 }}>
              <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginBottom: 8 }}>
                Render · <span style={{ color: "#fbbf24" }}>{project.status === "render-ready" ? "render-ready" : project.status}</span>
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.55, opacity: 0.85 }}>
                <div>Engine: <strong>{project.render.engine ?? "none selected"}</strong> · Status: <strong>{project.render.status}</strong></div>
                <div style={{ marginTop: 6, color: "#fbbf24" }}>
                  {videoEngines.length > 0 && videoEngines.some((engine) => engine.providerDependent)
                    ? "Final video encoding is PROVIDER-DEPENDENT — the pipeline, storyboard, scenes, assets and timeline are real and persistent; connecting a video engine to this render stage is the remaining provider work."
                    : "Video rendering architecture is ready for a provider engine."}
                </div>
                <div style={{ marginTop: 6, opacity: 0.75 }}>
                  Pipeline: {project.shots.length} shots → {project.scenes.length} scenes → {project.assets.length} assets → timeline → render
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </GenesisWindowFrame>
  );
}
