/**
 * LÉLU — the engine experience, inside the conversation.
 *
 * A four-stroke engine is not a picture: it is a set of layers that only make
 * sense when you can isolate them and turn the crank. This view builds the
 * assembly in three.js from the program (no model call, no network), animates
 * the real slider-crank kinematics, and exposes the layers, the exploded view
 * and the four strokes as controls on the thing itself.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type * as ThreeNS from "three";
import { Eye, EyeOff, Pause, Play, RotateCcw, SkipBack, SkipForward, TriangleAlert } from "lucide-react";
import {
  pistonHeight,
  strokeAt,
  strokeProgress,
  type EnginePart,
  type EngineProgram,
  type EngineStroke,
} from "../../../../core/creative/kit/EngineAssembly";
import "./engineView.css";

type Mode = { playing: boolean; angle: number; explode: number; labels: boolean; hidden: Set<string> };

export default function EngineView({ program }: { program: EngineProgram }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState("Building the assembly…");
  const [playing, setPlaying] = useState(true);
  const [explode, setExplode] = useState(0);
  const [labels, setLabels] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [angle, setAngle] = useState(0);
  const mode = useRef<Mode>({ playing: true, angle: 0, explode: 0, labels: true, hidden: new Set() });
  const scrub = useRef<{ set: (a: number) => void } | null>(null);

  // The controls write into a ref the render loop reads, so changing a layer or
  // dragging the scrubber never restarts the scene.
  useEffect(() => {
    mode.current.playing = playing;
    mode.current.explode = explode;
    mode.current.labels = labels;
    mode.current.hidden = hidden;
    scrub.current?.set(angle);
  }, [playing, explode, labels, hidden, angle]);

  const stroke = useMemo(() => strokeAt(angle, program.strokes), [angle, program.strokes]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};
    void (async () => {
      const T = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (disposed) return;

      const scene = new T.Scene();
      scene.background = new T.Color(program.scene.background);
      const camera = new T.PerspectiveCamera(program.scene.camera.fov, 1, 0.01, 20);
      camera.position.set(...program.scene.camera.position);
      const renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      el.appendChild(renderer.domElement);
      renderer.domElement.style.touchAction = "none";

      for (const light of program.scene.lights) {
        if (light.type === "hemisphere") scene.add(new T.HemisphereLight(light.color, light.ground ?? "#111", light.intensity));
        else scene.add(new T.DirectionalLight(light.color, light.intensity).translateX(light.position[0]).translateY(light.position[1]).translateZ(light.position[2]));
      }
      scene.add(new T.AmbientLight("#ffffff", 0.35));
      const grid = new T.GridHelper(1.6, 16, "#2a2145", "#181227");
      grid.position.y = -0.42;
      scene.add(grid);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(...program.scene.camera.target);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 0.22;
      controls.maxDistance = 3;
      controls.update();

      type Live = {
        part: EnginePart;
        mesh: ThreeNS.Object3D;
        base: ThreeNS.Vector3;
        explodeTo: ThreeNS.Vector3;
        group: ThreeNS.Group;
        material?: ThreeNS.MeshStandardMaterial;
      };
      const live: Live[] = [];
      const groups = new Map<string, ThreeNS.Group>();
      const materials = new Map<string, ThreeNS.MeshStandardMaterial>();

      const geometryFor = (part: EnginePart) => {
        const s = part.size;
        switch (part.shape) {
          case "box":
            return new T.BoxGeometry(s.width, s.height, s.depth);
          case "cylinder":
            return new T.CylinderGeometry(s.radius, s.radius, s.height, 28);
          case "cone":
            return new T.ConeGeometry(s.radius, s.height, 24);
          case "sphere":
            return new T.SphereGeometry(s.radius, 24, 18);
          case "torus":
            return new T.TorusGeometry(s.radius, s.tube ?? 0.004, 12, 40);
        }
      };

      for (const part of program.parts) {
        const key = `${part.color}|${part.metalness ?? 0.35}|${part.roughness ?? 0.45}|${part.opacity ?? 1}|${part.emissive ?? ""}`;
        let material = materials.get(key);
        if (!material) {
          material = new T.MeshStandardMaterial({
            color: new T.Color(part.color),
            metalness: part.metalness ?? 0.35,
            roughness: part.roughness ?? 0.45,
            transparent: (part.opacity ?? 1) < 1,
            opacity: part.opacity ?? 1,
            emissive: new T.Color(part.emissive ?? "#000000"),
            emissiveIntensity: part.emissiveIntensity ?? 0,
          });
          materials.set(key, material);
        }
        const mesh = new T.Mesh(geometryFor(part), material);
        mesh.position.set(...part.position);
        if (part.rotation) mesh.rotation.set(...part.rotation.map((d) => (d * Math.PI) / 180) as [number, number, number]);
        let group = groups.get(part.layer);
        if (!group) {
          group = new T.Group();
          group.name = part.layer;
          groups.set(part.layer, group);
          scene.add(group);
        }
        group.add(mesh);
        /*
         * The exploded view must stay inside the canvas.
         *
         * Unbounded offsets threw the radiator and the exhaust runners off
         * the right edge of the card at 85% explode. Each part keeps its
         * direction, capped so the whole spread fits the framed assembly.
         */
        const knock = new T.Vector3(...part.explode);
        if (knock.length() > 0.16) knock.normalize().multiplyScalar(0.16);
        live.push({ part, mesh, base: mesh.position.clone(), explodeTo: knock, group, material });
      }

      // ---- labels, in the DOM over the canvas ---------------------------
      const labelHost = document.createElement("div");
      labelHost.className = "eng-labels";
      el.appendChild(labelHost);
      const labelEls = new Map<string, HTMLElement>();
      for (const part of program.parts) {
        const div = document.createElement("span");
        div.className = "eng-label";
        div.dataset.engineLabel = part.id;
        div.dataset.layer = part.layer;
        div.textContent = part.name;
        labelHost.appendChild(div);
        labelEls.set(part.id, div);
      }

      const resize = () => {
        const w = el.clientWidth || 640;
        const h = el.clientHeight || 380;
        renderer.setSize(w, h, false);
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        camera.aspect = w / h;
        /*
         * A portrait canvas frames the engine by width, not height.
         *
         * At 390×844 the camera at its authored distance put the radiator
         * and the coolant hoses past the right edge. The camera pulls back by
         * the missing aspect, along whatever direction the person orbited to,
         * so the whole assembly stays in frame on a phone.
         */
        const target = new T.Vector3(...program.scene.camera.target);
        const authored = new T.Vector3(...program.scene.camera.position).sub(target).length();
        const fit = Math.max(1, Math.min(2.4, 1.45 / camera.aspect));
        const dir = camera.position.clone().sub(target);
        if (dir.lengthSq() > 0) {
          dir.setLength(authored * fit);
          camera.position.copy(target).add(dir);
        }
        camera.updateProjectionMatrix();
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(el);

      const cylinderAxisY = 0.145; // crank axis height above part origin
      const R = program.geometry.crankRadius;
      const L = program.geometry.rodLength;
      const clock = new T.Clock();
      const projected = new T.Vector3();
      let lastStrokeId = "";

      scrub.current = {
        set: (value: number) => {
          mode.current.angle = value;
        },
      };

      const animate = () => {
        const dt = Math.min(0.05, clock.getDelta());
        const m = mode.current;
        if (m.playing) {
          m.angle = (m.angle + dt * 108) % 720; // 0.3 rev/s: slow enough to read
        }
        const theta = m.angle;
        const current = strokeAt(theta, program.strokes);
        if (current.id !== lastStrokeId) {
          lastStrokeId = current.id;
          setAngle(Math.round(theta));
        } else if (Math.abs(Math.round(theta) - Math.round(m.angle)) > 1) {
          setAngle(Math.round(theta));
        }

        for (const item of live) {
          const { part, mesh, base } = item;
          const layerHidden = m.hidden.has(part.layer);
          mesh.visible = !layerHidden;
          // Exploded position: base + direction * amount.
          mesh.position.copy(base).addScaledVector(item.explodeTo, m.explode);

          if (!layerHidden && part.moving) {
            const deg = (theta * Math.PI) / 180;
            if (part.moving === "piston") {
              const y = cylinderAxisY + pistonHeight(theta, R, L);
              mesh.position.y = y;
            } else if (part.moving === "crank" || part.moving === "cam") {
              const spin = part.moving === "cam" ? deg / 2 : deg;
              if (part.id === "crankpin") {
                mesh.position.y = cylinderAxisY + R * Math.cos(deg);
                mesh.position.z = -R * Math.sin(deg);
              } else if (part.id === "crank") {
                mesh.rotation.x = deg;
              } else if (part.id === "flywheel") {
                mesh.rotation.x = deg;
              } else {
                mesh.rotation.x = spin;
              }
            } else if (part.moving === "rod") {
              const pinY = cylinderAxisY + pistonHeight(theta, R, L);
              const pinZ = 0;
              const crankY = cylinderAxisY + R * Math.cos(deg);
              const crankZ = -R * Math.sin(deg);
              mesh.position.set(0, (pinY + crankY) / 2, (pinZ + crankZ) / 2);
              mesh.rotation.x = -Math.atan2(pinY - crankY, pinZ - crankZ || 0.0001) + Math.PI / 2;
            } else if (part.moving === "intakeValve" || part.moving === "exhaustValve") {
              const lift = part.moving === "intakeValve" ? current.intakeValveLift : current.exhaustValveLift;
              // A lobe opens the valve over the middle of its window, not the whole of it.
              const p = strokeProgress(theta, current);
              const eased = lift ? Math.sin(Math.PI * Math.min(1, Math.max(0, p))) : 0;
              mesh.position.y = base.y - eased * 0.014 + (m.explode ? 0 : 0);
            } else if (part.moving === "spark") {
              if (item.material) {
                const firing = current.ignition && strokeProgress(theta, current) < 0.3;
                item.material.emissiveIntensity = firing ? 2.4 : 0;
              }
            } else if (part.moving === "injector") {
              if (item.material) {
                item.material.emissiveIntensity = current.injection ? 0.5 + 0.5 * Math.sin(theta / 12) : 0;
              }
            }
          }

          // The burning charge glows through the power stroke.
          if (part.id === "chamber" && item.material) {
            const firing = current.flow === "combustion";
            item.material.emissiveIntensity = firing ? 1.6 + Math.sin(theta / 9) * 0.5 : 0;
            item.material.opacity = firing ? 0.72 : 0.3;
          }
        }

        /*
         * Labels: project each anchor, then place greedily by depth.
         *
         * 33 parts around one small assembly put half the names on top of the
         * other half. A label whose box would collide with one already placed
         * stays hidden — the closest parts win, and rotating the engine brings
         * the rest back. Nothing overlaps; the count is honest because the
         * layer chips say how many parts are hidden.
         */
        const showLabels = m.labels;
        const rect = renderer.domElement.getBoundingClientRect();
        const placed: { x: number; y: number; w: number; h: number }[] = [];
        const shown = new Set<string>();
        const candidates: { id: string; x: number; y: number; z: number; w: number }[] = [];
        for (const part of program.parts) {
          if (!showLabels || m.hidden.has(part.layer)) continue;
          projected.set(...part.label).project(camera);
          if (projected.z > 1) continue;
          candidates.push({
            id: part.id,
            x: (projected.x * 0.5 + 0.5) * rect.width,
            y: (-projected.y * 0.5 + 0.5) * rect.height,
            z: projected.z,
            w: Math.min(150, part.name.length * 5.6 + 16),
          });
        }
        candidates.sort((a, b) => a.z - b.z);
        for (const c of candidates) {
          const box = { x: c.x - c.w / 2, y: c.y - 9, w: c.w, h: 18 };
          const clashes = placed.some(
            (p) => box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y,
          );
          if (clashes) continue;
          placed.push(box);
          shown.add(c.id);
          const div = labelEls.get(c.id);
          if (!div) continue;
          div.style.display = "block";
          div.style.transform = `translate(-50%, -50%) translate(${c.x}px, ${c.y}px)`;
        }
        for (const part of program.parts) {
          if (shown.has(part.id)) continue;
          const div = labelEls.get(part.id);
          if (div) div.style.display = "none";
        }

        controls.update();
        renderer.render(scene, camera);
      };
      renderer.setAnimationLoop(animate);
      setInfo(`${program.parts.length} parts · ${program.layers.length} layers · drag to orbit · pinch or scroll to zoom`);

      cleanup = () => {
        renderer.setAnimationLoop(null);
        observer.disconnect();
        controls.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        labelHost.remove();
        for (const material of materials.values()) material.dispose();
        for (const item of live) (item.mesh as ThreeNS.Mesh).geometry?.dispose?.();
      };
    })().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    return () => {
      disposed = true;
      cleanup();
    };
    // The scene is rebuilt only for a different program.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program]);

  const toggleLayer = (id: string) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const isolate = (id: string) => {
    setHidden(new Set(program.layers.filter((layer) => layer.id !== id).map((layer) => layer.id)));
  };
  const showAll = () => setHidden(new Set());
  const stepStroke = (direction: 1 | -1) => {
    const index = program.strokes.findIndex((s) => s.id === stroke.id);
    const next = (index + direction + program.strokes.length) % program.strokes.length;
    const target = program.strokes[next];
    setPlaying(false);
    setAngle(target.from + 40);
  };
  const active = program.strokes.find((s) => s.id === stroke.id) ?? program.strokes[0];

  return (
    <div className="eng" data-lelu-engine data-engine-stroke={active.id} data-engine-angle={Math.round(angle)}>
      <div className="eng-bar">
        <span className="eng-chip" data-engine-stroke-name>{active.name}</span>
        <button type="button" className="eng-btn" onClick={() => stepStroke(-1)} aria-label="Previous stroke"><SkipBack size={13} aria-hidden /></button>
        <button type="button" className="eng-btn" onClick={() => setPlaying((p) => !p)} data-engine-play aria-pressed={playing}>
          {playing ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />} {playing ? "Pause" : "Play"}
        </button>
        <button type="button" className="eng-btn" onClick={() => stepStroke(1)} aria-label="Next stroke"><SkipForward size={13} aria-hidden /></button>
        <label className="eng-slider">
          <span>Crank</span>
          <input
            type="range"
            min={0}
            max={719}
            value={Math.round(angle)}
            data-engine-angle-input
            onChange={(event) => {
              setPlaying(false);
              setAngle(Number(event.target.value));
            }}
          />
          <em>{Math.round(angle)}°</em>
        </label>
        <label className="eng-slider">
          <span>Explode</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={explode}
            data-engine-explode
            onChange={(event) => setExplode(Number(event.target.value))}
          />
        </label>
        <button type="button" className="eng-btn" onClick={() => setLabels((v) => !v)} data-engine-labels aria-pressed={labels}>
          {labels ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />} Labels
        </button>
        <button type="button" className="eng-btn" onClick={showAll} data-engine-show-all><RotateCcw size={13} aria-hidden /> All layers</button>
      </div>

      <div className="eng-stage">
        <div ref={host} className="eng-canvas" data-lelu-engine-canvas />
        {error ? <p className="eng-error" role="alert"><TriangleAlert size={14} aria-hidden /> The assembly could not start: {error}</p> : null}
        <div className="eng-layers" aria-label="Layers">
          {program.layers.map((layer) => {
            const off = hidden.has(layer.id);
            return (
              <div key={layer.id} className={`eng-layer${off ? " is-off" : ""}`} data-engine-layer={layer.id} data-engine-layer-on={off ? "false" : "true"}>
                <button type="button" className="eng-layer-toggle" aria-pressed={!off} onClick={() => toggleLayer(layer.id)} title={layer.note}>
                  <i style={{ background: layer.color }} aria-hidden />
                  {layer.label}
                  <em>{program.parts.filter((p) => p.layer === layer.id).length}</em>
                </button>
                <button type="button" className="eng-layer-isolate" onClick={() => isolate(layer.id)} aria-label={`Isolate ${layer.label}`}>only</button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="eng-cycle">
        {program.strokes.map((s: EngineStroke) => (
          <button
            key={s.id}
            type="button"
            className={`eng-step${s.id === active.id ? " is-active" : ""}`}
            data-engine-step={s.id}
            onClick={() => {
              setPlaying(false);
              setAngle(s.from + 40);
            }}
          >
            <strong>{s.name}</strong>
            <span>{s.summary}</span>
          </button>
        ))}
      </div>
      <p className="eng-detail" data-engine-detail>{active.detail}</p>
      <p className="eng-note">{info}</p>
    </div>
  );
}
