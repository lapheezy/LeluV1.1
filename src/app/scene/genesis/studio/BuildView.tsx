/**
 * LÉLU — a constructed artifact, inside the conversation.
 *
 * One viewer for every domain: the build program says what the parts are,
 * which layer each belongs to, where it drifts when exploded, what each
 * step is about and which parameters produced it. The viewer turns those
 * into an assembly you can orbit, explode, isolate by layer, step through —
 * and re-parameterise. A parameter change rebuilds the artifact with the
 * same builder (dependants recomputed), and saving it writes a new revision
 * of the SAME artifact, so its identity survives.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type * as ThreeNS from "three";
import { BookOpen, Eye, EyeOff, Layers, RotateCcw, Save, Scissors, TriangleAlert } from "lucide-react";
import StudioStore from "../../../../core/studio/StudioStore";
import { builderById } from "../../../../core/creative/kit/build";
import type { BuildProgram } from "../../../../core/creative/kit/build";
import "./engineView.css";

type Mode = {
  explode: number;
  labels: boolean;
  hidden: Set<string>;
  focus: string[] | null;
  highlight: boolean;
};

function buildWith(builderId: string, params: Record<string, number | string>, title: string): BuildProgram | null {
  const builder = builderById(builderId);
  if (!builder) return null;
  const outcome = builder.build(params, title);
  return outcome.ok && outcome.program ? outcome.program : null;
}

export default function BuildView({ program, artifactId }: { program: BuildProgram; artifactId?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState(true);
  const [explode, setExplode] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, number | string>>(program.params);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mode = useRef<Mode>({ explode: 0, labels: true, hidden: new Set(), focus: null, highlight: false });

  // A parameter change rebuilds the artifact in place (no model, no network).
  const live = useMemo(() => {
    const identical = Object.entries(program.params).every(([k, v]) => String(draft[k]) === String(v));
    if (identical) return program;
    return buildWith(program.builder, draft, program.title) ?? program;
  }, [program, draft]);

  const activeStep = step !== null ? live.steps[step] ?? null : null;

  useEffect(() => {
    mode.current.explode = explode;
    mode.current.labels = labels;
    mode.current.hidden = hidden;
    mode.current.focus = activeStep ? activeStep.focus : null;
    mode.current.highlight = activeStep !== null;
  }, [explode, labels, hidden, activeStep]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};
    setError(null);
    void (async () => {
      const T = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (disposed) return;
      try {
        const scene = new T.Scene();
        scene.background = new T.Color(live.scene.background);
        const camera = new T.PerspectiveCamera(live.scene.camera.fov, 1, 0.01, 200);
        camera.position.set(...live.scene.camera.position);
        const renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        el.appendChild(renderer.domElement);
        renderer.domElement.style.touchAction = "none";

        for (const light of live.scene.lights) {
          if (light.type === "hemisphere") scene.add(new T.HemisphereLight(light.color, light.ground ?? "#111", light.intensity));
          else if (light.type === "ambient") scene.add(new T.AmbientLight(light.color, light.intensity));
          else scene.add(new T.DirectionalLight(light.color, light.intensity).translateX(light.position[0]).translateY(light.position[1]).translateZ(light.position[2]));
        }
        scene.add(new T.AmbientLight("#ffffff", 0.28));

        const controls = new OrbitControls(camera, renderer.domElement);
        const target = new T.Vector3(...live.scene.camera.target);
        controls.target.copy(target);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.update();

        const geometryFor = (part: BuildProgram["parts"][number]) => {
          const s = part.size;
          switch (part.shape) {
            case "box":
              return new T.BoxGeometry(s.width ?? 0.1, s.height ?? 0.1, s.depth ?? 0.1);
            case "cylinder":
              return new T.CylinderGeometry(s.radius ?? 0.05, s.radiusTop ?? s.radius ?? 0.05, s.height ?? 0.1, 28);
            case "cone":
              return new T.ConeGeometry(s.radius ?? 0.05, s.height ?? 0.1, 24);
            case "sphere":
              return new T.SphereGeometry(s.radius ?? 0.05, 24, 18);
            case "torus":
              return new T.TorusGeometry(s.radius ?? 0.05, s.tube ?? 0.01, 16, 40);
            default:
              return new T.BoxGeometry(0.1, 0.1, 0.1);
          }
        };

        type Live = {
          part: BuildProgram["parts"][number];
          mesh: ThreeNS.Mesh;
          base: ThreeNS.Vector3;
          explodeTo: ThreeNS.Vector3;
          material: ThreeNS.MeshStandardMaterial;
        };
        const items: Live[] = [];
        for (const part of live.parts) {
          const material = new T.MeshStandardMaterial({
            color: new T.Color(part.color),
            metalness: part.metalness ?? 0.35,
            roughness: part.roughness ?? 0.45,
            transparent: (part.opacity ?? 1) < 1,
            opacity: part.opacity ?? 1,
            emissive: new T.Color(part.emissive ?? "#000000"),
            emissiveIntensity: part.emissiveIntensity ?? 0,
          });
          const mesh = new T.Mesh(geometryFor(part), material);
          mesh.position.set(...part.position);
          if (part.rotation) mesh.rotation.set(...part.rotation.map((d) => (d * Math.PI) / 180) as [number, number, number]);
          scene.add(mesh);
          const knock = new T.Vector3(...part.explode);
          const cap = Math.max(...live.parts.map((p) => Math.hypot(p.position[0], p.position[1], p.position[2])), 0.4);
          if (knock.length() > cap) knock.setLength(cap);
          items.push({ part, mesh, base: mesh.position.clone(), explodeTo: knock, material });
        }

        const labelHost = document.createElement("div");
        labelHost.className = "eng-labels";
        el.appendChild(labelHost);
        const labelEls = new Map<string, HTMLElement>();
        for (const part of live.parts) {
          const div = document.createElement("span");
          div.className = "eng-label";
          div.textContent = part.name;
          labelHost.appendChild(div);
          labelEls.set(part.id, div);
        }

        const resize = () => {
          const w = el.clientWidth || 640;
          const h = el.clientHeight || 360;
          renderer.setSize(w, h, false);
          renderer.domElement.style.width = "100%";
          renderer.domElement.style.height = "100%";
          camera.aspect = w / h;
          const authored = new T.Vector3(...live.scene.camera.position).sub(target).length();
          const fit = Math.max(1, Math.min(2.6, 1.5 / camera.aspect));
          const dir = camera.position.clone().sub(target);
          if (dir.lengthSq() > 0) camera.position.copy(target).add(dir.setLength(authored * fit));
          camera.updateProjectionMatrix();
        };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(el);

        const clock = new T.Clock();
        const projected = new T.Vector3();
        const animate = () => {
          const dt = Math.min(0.06, clock.getDelta());
          const m = mode.current;
          const rect = renderer.domElement.getBoundingClientRect();
          for (const item of items) {
            const { part, mesh, material } = item;
            const hiddenLayer = m.hidden.has(part.layer);
            mesh.visible = !hiddenLayer;
            if (!mesh.visible) continue;
            mesh.position.copy(item.base).addScaledVector(item.explodeTo, m.explode);
            if (part.spin) {
              const axis = part.spin.axis;
              mesh.rotation[axis] += ((part.spin.speed * Math.PI) / 180) * dt;
            } else if (part.rotation) {
              mesh.rotation.set(...part.rotation.map((d) => (d * Math.PI) / 180) as [number, number, number]);
            }
            if (m.highlight) {
              const focused = m.focus?.includes(part.id) ?? false;
              material.emissiveIntensity = focused ? 0.55 : 0;
              material.emissive = new T.Color(focused ? "#b98cff" : "#000000");
              material.opacity = focused ? Math.max(0.75, part.opacity ?? 1) : Math.max(0.12, (part.opacity ?? 1) * 0.3);
              material.transparent = true;
            } else {
              material.emissiveIntensity = part.emissiveIntensity ?? 0;
              material.emissive = new T.Color(part.emissive ?? "#000000");
              material.opacity = part.opacity ?? 1;
              material.transparent = (part.opacity ?? 1) < 1;
            }
          }

          // Labels: place by depth, skip any that would collide.
          const placed: { x: number; y: number; w: number; h: number }[] = [];
          const shown = new Set<string>();
          const candidates: { id: string; x: number; y: number; z: number; w: number }[] = [];
          for (const part of live.parts) {
            const item = items.find((i) => i.part.id === part.id);
            if (!m.labels || !item || !item.mesh.visible) continue;
            projected.set(...part.label).project(camera);
            if (projected.z > 1) continue;
            candidates.push({
              id: part.id,
              x: (projected.x * 0.5 + 0.5) * rect.width,
              y: (-projected.y * 0.5 + 0.5) * rect.height,
              z: projected.z,
              w: Math.min(140, part.name.length * 5.6 + 16),
            });
          }
          candidates.sort((a, b) => a.z - b.z);
          for (const c of candidates) {
            const box = { x: c.x - c.w / 2, y: c.y - 9, w: c.w, h: 18 };
            const clash = placed.some((p) => box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y);
            if (clash) continue;
            placed.push(box);
            shown.add(c.id);
            const div = labelEls.get(c.id);
            if (!div) continue;
            div.style.display = "block";
            div.style.transform = `translate(-50%, -50%) translate(${c.x}px, ${c.y}px)`;
          }
          for (const part of live.parts) {
            if (shown.has(part.id)) continue;
            const div = labelEls.get(part.id);
            if (div) div.style.display = "none";
          }

          controls.update();
          renderer.render(scene, camera);
        };
        renderer.setAnimationLoop(animate);

        cleanup = () => {
          renderer.setAnimationLoop(null);
          observer.disconnect();
          controls.dispose();
          renderer.dispose();
          renderer.domElement.remove();
          labelHost.remove();
          for (const item of items) {
            item.material.dispose();
            item.mesh.geometry.dispose();
          }
        };
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, [live]);

  const toggleLayer = (id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const isolate = (id: string) => {
    setHidden(new Set(live.layers.filter((l) => l.id !== id).map((l) => l.id)));
  };
  const showAll = () => setHidden(new Set());

  const changed = Object.entries(draft).some(([k, v]) => String(v) !== String(program.params[k]));
  const setParam = (key: string, value: number | string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSaved(null);
  };
  const resetDraft = () => {
    setDraft(program.params);
    setSaved(null);
  };
  const saveRevision = async () => {
    if (!artifactId) return;
    setSaving(true);
    const store = StudioStore.getInstance();
    const r = store.revise(artifactId, {
      spec: { kind: "visual", title: live.title, medium: "scene3d", program: { ...live.scene, build: live }, notes: live.notes.join(" ") },
      note: `viewer parameters: ${live.paramSpecs.map((p) => `${p.key}=${p.value}`).join(", ")}`,
      by: "user",
    });
    setSaving(false);
    if (r.ok) {
      setSaved(`Saved as revision ${r.revision.rev} of this artifact.`);
      setDraft(live.params);
    } else {
      setSaved(`Not saved: ${r.reason}`);
    }
  };

  return (
    <div className="eng" data-lelu-construction={live.builder} data-build-domain={live.domain}>
      <div className="eng-bar">
        <span className="eng-chip" data-build-count>
          {live.domain} · {live.parts.length} parts · {live.layers.length} layers
        </span>
        <button type="button" className="eng-btn" onClick={() => setLabels((v) => !v)} aria-pressed={labels} data-build-labels>
          {labels ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />} Labels
        </button>
        <button type="button" className="eng-btn" onClick={showAll} data-build-show-all>
          <RotateCcw size={13} aria-hidden /> All layers
        </button>
      </div>

      <div className="eng-bar">
        <label className="eng-slider">
          <span>Explode</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={explode}
            onChange={(e) => setExplode(Number(e.target.value))}
            data-build-explode
          />
          <em>{Math.round(explode * 100)}%</em>
        </label>
      </div>

      <div className="eng-stage">
        <div className="eng-canvas" ref={host} data-lelu-construction-canvas>
          {error ? (
            <p className="eng-error" role="alert">
              <TriangleAlert size={13} aria-hidden /> {error}
            </p>
          ) : null}
        </div>
        <div className="eng-layers" aria-label="Layers">
          {live.layers.map((layer) => {
            const off = hidden.has(layer.id);
            return (
              <div key={layer.id} className={`eng-layer${off ? " is-off" : ""}`} data-build-layer={layer.id} data-build-layer-on={off ? "false" : "true"}>
                <button type="button" className="eng-layer-toggle" onClick={() => toggleLayer(layer.id)} title={layer.note}>
                  <i style={{ background: layer.color }} aria-hidden />
                  {layer.label} <em>{layer.parts.length}</em>
                </button>
                <button type="button" className="eng-layer-isolate" onClick={() => isolate(layer.id)} aria-label={`Isolate ${layer.label}`}>
                  only
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="eng-cycle" data-build-steps>
        {live.steps.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`eng-step${step === i ? " is-active" : ""}`}
            onClick={() => setStep(step === i ? null : i)}
            data-build-step={s.id}
          >
            <strong>{s.name}</strong>
            <span>{s.summary}</span>
          </button>
        ))}
      </div>
      {activeStep ? <p className="eng-detail" data-build-detail>{activeStep.detail}</p> : null}

      <div className="eng-bar" data-build-derived>
        {live.derived.map((fact) => (
          <span key={fact.label} className="eng-chip">
            {fact.label}: {fact.value}
          </span>
        ))}
      </div>

      <details className="eng-params" open={changed}>
        <summary>
          <Layers size={13} aria-hidden /> Parameters <em>{changed ? "(changed — not saved)" : ""}</em>
        </summary>
        <div className="eng-params-grid">
          {live.paramSpecs.map((spec) =>
            spec.kind === "choice" ? (
              <label key={spec.key} className="eng-param">
                <span>{spec.label}</span>
                <select value={String(draft[spec.key] ?? spec.value)} onChange={(e) => setParam(spec.key, e.target.value)} data-build-param={spec.key}>
                  {(spec.choices ?? []).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label key={spec.key} className="eng-param">
                <span>
                  {spec.label} <em>{String(spec.value)}{spec.unit ? ` ${spec.unit}` : ""}</em>
                </span>
                <input
                  type="range"
                  min={spec.min ?? 0}
                  max={spec.max ?? 1}
                  step={spec.step ?? 0.01}
                  value={Number(draft[spec.key] ?? spec.value)}
                  onChange={(e) => setParam(spec.key, Number(e.target.value))}
                  data-build-param={spec.key}
                />
              </label>
            ),
          )}
        </div>
        <div className="eng-bar">
          <button type="button" className="eng-btn" onClick={saveRevision} disabled={!artifactId || !changed || saving} data-build-save>
            <Save size={13} aria-hidden /> {saving ? "Saving…" : "Save as a revision"}
          </button>
          <button type="button" className="eng-btn" onClick={resetDraft} disabled={!changed} data-build-reset>
            <RotateCcw size={13} aria-hidden /> Reset
          </button>
          {!artifactId ? <span className="eng-note">Open this artifact to save parameter changes.</span> : null}
        </div>
        {saved ? <p className="eng-note" data-build-saved>{saved}</p> : null}
      </details>

      {live.sources?.length ? (
        <div className="eng-sources" data-build-sources>
          {live.sources.map((src) => (
            <p key={`${src.url}-${src.used}`} className="eng-note">
              <BookOpen size={11} aria-hidden /> {src.basis === "verified" ? "From the source" : "Assumed, not sourced"}: {src.used}
              {src.title ? ` — ${src.title}` : ""}
            </p>
          ))}
        </div>
      ) : null}

      <p className="eng-note">
        <Scissors size={11} aria-hidden /> {live.notes[0]}
      </p>
    </div>
  );
}
