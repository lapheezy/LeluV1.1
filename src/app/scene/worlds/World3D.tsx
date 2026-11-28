/**
 * ==========================================================
 * LÉLU — WORLD 3D ADAPTER (WP21 · WP02)
 *
 * Draws a world's foundation, atmosphere and 3D-object layers as real
 * geometry in one WebGL scene. Everything is procedural (shaders,
 * instancing, generated meshes): no copied artwork, no image backdrops.
 * Particles move on the GPU (time uniform), so a frame costs one draw per
 * layer, not per particle. Counts scale with the world's density and the
 * quality tier.
 * ==========================================================
 */

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { layersOf, type WorldConfig, type WorldLayer } from "../../../core/worlds/WorldSchema";
import { fbm, riverX, rng, terrainHeight } from "../../../core/worlds/noise";

export interface RenderBudget {
  /** Multiplies particle and instance counts. */
  scale: number;
  /** Seconds since start, scaled by the world's motion (0 = still). */
  motion: number;
}

const num = (l: WorldLayer, k: string, d: number) => (typeof l.params[k] === "number" ? (l.params[k] as number) : d);
const str = (l: WorldLayer, k: string, d: string) => (typeof l.params[k] === "string" ? (l.params[k] as string) : d);
const col = (c: string) => new THREE.Color(c);

/** One shared clock uniform, advanced by the world's motion setting. */
function useClock(motion: number) {
  const u = useMemo(() => ({ value: 0 }), []);
  useFrame((_, dt) => {
    u.value += Math.min(dt, 0.1) * motion;
  });
  return u;
}

/* ------------------------------------------------------------------ *
 * Foundation
 * ------------------------------------------------------------------ */

function Sky({ world, layer, time }: { world: WorldConfig; layer: WorldLayer; time: { value: number } }) {
  const uniforms = useMemo(
    () => ({
      uTime: time,
      uTop: { value: col(world.palette.sky[0]) },
      uMid: { value: col(world.palette.sky[1]) },
      uLow: { value: col(world.palette.sky[2]) },
      uGlow: { value: col(world.palette.glow) },
      uSun: { value: num(layer, "sun", 0) },
      uGrid: { value: num(layer, "grid", 0) },
      uRays: { value: num(layer, "rays", 0) },
      uPaper: { value: num(layer, "paper", 0) },
      uFlash: { value: 0 },
    }),
    [world.palette, layer, time],
  );
  return (
    <mesh renderOrder={-10} userData={{ sky: uniforms }}>
      <sphereGeometry args={[400, 48, 24]} />
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
        uniforms={uniforms}
        vertexShader={`varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`}
        fragmentShader={`
          uniform vec3 uTop, uMid, uLow, uGlow; uniform float uSun, uGrid, uRays, uPaper, uTime, uFlash;
          varying vec3 vDir;
          float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
          void main(){
            float y = vDir.y;
            vec3 c = mix(uLow, uMid, smoothstep(-0.05, 0.25, y));
            c = mix(c, uTop, smoothstep(0.25, 0.85, y));
            // sun / moon glow low on the horizon
            float s = max(0.0, dot(vDir, normalize(vec3(0.3, 0.08, -1.0))));
            c += uGlow * uSun * (pow(s, 64.0) * 1.4 + pow(s, 6.0) * 0.25);
            // god rays from above (water)
            if (uRays > 0.0) { float r = pow(max(0.0, sin(atan(vDir.x, vDir.z) * 18.0 + uTime * 0.2) * 0.5 + 0.5), 8.0); c += uGlow * r * smoothstep(0.0, 0.9, y) * 0.22 * uRays; }
            // holographic floor grid seen on the lower sky
            if (uGrid > 0.0 && y < 0.0) { vec2 g = vDir.xz / max(0.05, -y) * 4.0; vec2 f = abs(fract(g) - 0.5); float line = smoothstep(0.47, 0.5, max(f.x, f.y)); c += uGlow * line * 0.35 * uGrid * smoothstep(-0.02, -0.4, y); }
            // paper grain
            if (uPaper > 0.0) { c *= 0.97 + 0.03 * h(floor(vDir.xy * 900.0)); }
            c += vec3(uFlash) * 0.6 * smoothstep(-0.1, 0.6, y);
            gl_FragColor = vec4(c, 1.0);
          }`}
      />
    </mesh>
  );
}

function Stars({ layer, budget, time }: { layer: WorldLayer; budget: RenderBudget; time: { value: number } }) {
  const n = Math.round(num(layer, "count", 1500) * budget.scale);
  const geo = useMemo(() => {
    const r = rng(42);
    const p = new Float32Array(n * 3), s = new Float32Array(n), ph = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = r() * 2 - 1, a = r() * Math.PI * 2, rad = 300;
      const y = Math.abs(u) * 0.95 + 0.02;
      const q = Math.sqrt(1 - y * y);
      p.set([Math.cos(a) * q * rad, y * rad, Math.sin(a) * q * rad], i * 3);
      s[i] = 0.6 + r() ** 4 * 3.4;
      ph[i] = r() * 6.28;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(s, 1));
    g.setAttribute("aPhase", new THREE.BufferAttribute(ph, 1));
    return g;
  }, [n]);
  return (
    <points geometry={geo} renderOrder={-9}>
      <shaderMaterial
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        fog={false}
        uniforms={{ uTime: time, uOpacity: { value: layer.opacity } }}
        vertexShader={`attribute float aSize, aPhase; uniform float uTime; varying float vA;
          void main(){ vA = 0.55 + 0.45 * sin(uTime * 1.7 + aPhase); vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * 1.6; gl_Position = projectionMatrix * mvPosition; }`}
        fragmentShader={`uniform float uOpacity; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vec3(1.0, 0.95, 0.9), a * vA * uOpacity); }`}
      />
    </points>
  );
}

function Ocean({ layer, time }: { layer: WorldLayer; time: { value: number } }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={-2}>
      <planeGeometry args={[400, 400, 160, 160]} />
      <shaderMaterial
        fog
        uniforms={THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uColor: { value: col(str(layer, "color", "#0b1626")) }, uSwell: { value: num(layer, "swell", 1) } }])}
        onBeforeCompile={undefined}
        ref={(m: THREE.ShaderMaterial | null) => {
          if (m) m.uniforms.uTime = time;
        }}
        vertexShader={`#include <fog_pars_vertex>
          uniform float uTime, uSwell; varying float vH; varying vec3 vW;
          void main(){ vec3 p = position; float h = sin(p.x*0.08 + uTime*1.1)*0.9 + sin(p.y*0.11 - uTime*0.8)*0.7 + sin((p.x+p.y)*0.21 + uTime*1.9)*0.3;
            p.z += h * uSwell; vH = h; vec4 mvPosition = modelViewMatrix * vec4(p,1.0); vW = (modelMatrix*vec4(p,1.0)).xyz; gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }`}
        fragmentShader={`#include <fog_pars_fragment>
          uniform vec3 uColor; varying float vH; varying vec3 vW;
          void main(){ vec3 c = uColor * (0.75 + vH*0.12); c += vec3(0.55,0.65,0.85) * smoothstep(1.2, 1.9, vH) * 0.35; gl_FragColor = vec4(c, 1.0);
            #include <fog_fragment>
          }`}
      />
    </mesh>
  );
}

function Terrain({ layer, seabed }: { layer: WorldLayer; seabed?: boolean }) {
  const height = num(layer, "height", seabed ? 3 : 8);
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(320, 320, 200, 200);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const ground = col(str(layer, "color", "#2f4a2a")), peak = col(str(layer, "peak", "#6b7a52")), snowC = new THREE.Color("#f8fafc");
    const snow = num(layer, "snow", 0);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = seabed ? fbm(x * 0.04, z * 0.04, 4, 3) * height - 3 : terrainHeight(x, z, height);
      pos.setY(i, y);
      const t = Math.min(1, Math.max(0, (y + 2) / (height * 1.6)));
      c.copy(ground).lerp(peak, t);
      if (snow > 0) c.lerp(snowC, Math.min(1, snow * (0.55 + t)));
      c.multiplyScalar(0.8 + fbm(x * 0.2, z * 0.2, 2, 5) * 0.4);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, [layer, height, seabed]);
  const river = useMemo(() => {
    if (seabed) return null;
    const pts: THREE.Vector3[] = [];
    for (let z = 60; z >= -160; z -= 4) pts.push(new THREE.Vector3(riverX(z), -1.55, z));
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = new THREE.TubeGeometry(curve, 120, 2.6, 4, false);
    g.scale(1, 0.05, 1);
    g.translate(0, -1.5 * 0.95, 0);
    return g;
  }, [seabed]);
  return (
    <group>
      <mesh geometry={geo} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.95} metalness={0} flatShading={!seabed} />
      </mesh>
      {river ? (
        <mesh geometry={river}>
          <meshStandardMaterial color={str(layer, "river", "#7dd3fc")} emissive={str(layer, "river", "#7dd3fc")} emissiveIntensity={0.35} roughness={0.15} metalness={0.3} />
        </mesh>
      ) : null}
    </group>
  );
}

function LavaField({ layer, time }: { layer: WorldLayer; time: { value: number } }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={-2}>
      <planeGeometry args={[400, 400, 1, 1]} />
      <shaderMaterial
        fog
        uniforms={THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uRock: { value: col(str(layer, "color", "#1a0d0b")) }, uLava: { value: col(str(layer, "lava", "#ff5a12")) }, uCracks: { value: num(layer, "cracks", 0.7) }, uTime: { value: 0 } }])}
        ref={(m: THREE.ShaderMaterial | null) => {
          if (m) m.uniforms.uTime = time;
        }}
        vertexShader={`#include <fog_pars_vertex>
          varying vec2 vUv; void main(){ vUv = position.xy; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
          }`}
        fragmentShader={`#include <fog_pars_fragment>
          uniform vec3 uRock, uLava; uniform float uCracks, uTime; varying vec2 vUv;
          vec2 hash2(vec2 p){ p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }
          float voro(vec2 x){ vec2 n = floor(x), f = fract(x); float m1 = 8.0, m2 = 8.0;
            for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g = vec2(float(i),float(j)); vec2 o = hash2(n+g); vec2 r = g + o - f; float d = dot(r,r); if(d<m1){ m2=m1; m1=d; } else if(d<m2) m2=d; }
            return sqrt(m2) - sqrt(m1); }
          void main(){ vec2 p = vUv * 0.06; float e = voro(p) ; float e2 = voro(p*3.1+7.0);
            float crack = smoothstep(0.12*uCracks, 0.0, e) + smoothstep(0.05, 0.0, e2) * 0.35;
            float pulse = 0.75 + 0.25 * sin(uTime*1.3 + vUv.x*0.05);
            vec3 c = uRock * (0.7 + 0.6*hash2(floor(vUv*0.6)).x*0.3) + uLava * crack * 2.2 * pulse;
            gl_FragColor = vec4(c, 1.0);
            #include <fog_fragment>
          }`}
      />
    </mesh>
  );
}

function City({ layer, budget }: { layer: WorldLayer; budget: RenderBudget }) {
  const blocks = Math.round(num(layer, "blocks", 12));
  const toon = num(layer, "toon", 0) > 0;
  const { mesh, count } = useMemo(() => {
    const r = rng(9);
    const mats: THREE.Matrix4[] = [];
    const tints: number[] = [];
    const span = blocks * 7;
    for (let gx = -blocks; gx <= blocks; gx++)
      for (let gz = -blocks * 2; gz <= 2; gz++) {
        if (gx === 0 || gz % 4 === 0) continue; // avenues
        if (r() > 0.82 * budget.scale + 0.2) continue;
        const dist = Math.hypot(gx, gz + blocks) / blocks;
        const h = (2 + r() ** 2.2 * 26 * (1.2 - dist * 0.5)) * num(layer, "height", 1);
        const w = 2.2 + r() * 2.2, d = 2.2 + r() * 2.2;
        const m = new THREE.Matrix4().compose(new THREE.Vector3(gx * 6.2 + (r() - 0.5), h / 2 - 2, gz * 6.2 - 8), new THREE.Quaternion(), new THREE.Vector3(w, h, d));
        mats.push(m);
        tints.push(r());
      }
    void span;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.setAttribute("aTint", new THREE.InstancedBufferAttribute(new Float32Array(tints), 1));
    const material = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uWin: { value: col(str(layer, "window", "#fde68a")) }, uNeon: { value: col(str(layer, "neon", "#f0abfc")) }, uToon: { value: toon ? 1 : 0 } }]),
      vertexShader: `#include <fog_pars_vertex>
        attribute float aTint; varying vec3 vLocal; varying vec3 vScale; varying vec3 vN; varying float vT;
        void main(){ vLocal = position; vT = aTint; vN = normal;
          vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `#include <fog_pars_fragment>
        uniform vec3 uWin, uNeon; uniform float uToon; varying vec3 vLocal; varying vec3 vScale; varying vec3 vN; varying float vT;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
        void main(){
          vec3 base = mix(vec3(0.05,0.04,0.09), vec3(0.12,0.08,0.2), vT);
          if (uToon > 0.5) base = mix(vec3(0.35,0.2,0.55), vec3(0.95,0.45,0.6), vT) * (abs(vN.x) > 0.5 ? 0.7 : 1.0);
          vec2 uv = abs(vN.x) > 0.5 ? vec2(vLocal.z * vScale.z, vLocal.y * vScale.y) : vec2(vLocal.x * vScale.x, vLocal.y * vScale.y);
          vec2 cell = floor(uv * vec2(1.6, 1.3)); vec2 f = fract(uv * vec2(1.6, 1.3));
          float lit = step(0.55, h(cell + vT * 31.0)) * step(0.18, f.x) * step(f.x, 0.82) * step(0.2, f.y) * step(f.y, 0.75);
          vec3 c = base + uWin * lit * (0.6 + 0.4 * h(cell*1.7)) * (abs(vN.y) > 0.5 ? 0.0 : 1.0);
          // neon crown on the tallest
          float crown = step(vScale.y * 0.5 - 0.6, vLocal.y * vScale.y) * step(18.0, vScale.y);
          c = mix(c, uNeon * 1.6, crown);
          if (uToon > 0.5) { float edge = step(0.47, max(abs(vLocal.x), abs(vLocal.z))) * step(abs(vN.y), 0.5) + step(0.48, abs(vLocal.y)) * step(abs(vN.y), 0.5); c = mix(c, vec3(0.03), clamp(edge,0.0,1.0) * 0.85); c += uWin * lit * 0.3; }
          gl_FragColor = vec4(c, 1.0);
          #include <fog_fragment>
        }`,
    });
    const mesh = new THREE.InstancedMesh(geo, material, mats.length);
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.frustumCulled = false;
    return { mesh, count: mats.length };
  }, [layer, blocks, toon, budget.scale]);
  return (
    <group>
      <primitive object={mesh} userData={{ count }} />
      <mesh rotation-x={-Math.PI / 2} position-y={-2.01}>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color={toon ? "#3b2a5a" : "#07060c"} roughness={toon ? 1 : 0.12} metalness={toon ? 0 : 0.7} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * Atmosphere: GPU particles
 * ------------------------------------------------------------------ */

type Flow = { fall: number; sway: number; size: number; streak?: boolean; blink?: boolean; rise?: boolean; box: [number, number, number]; y0: number };
const FLOWS: Record<string, Flow> = {
  rain: { fall: 38, sway: 0.4, size: 1, streak: true, box: [120, 60, 120], y0: -4 },
  snow: { fall: 2.2, sway: 1.6, size: 3.2, box: [120, 50, 120], y0: -4 },
  ash: { fall: 1.4, sway: 2.2, size: 2.4, box: [120, 50, 120], y0: -4 },
  embers: { fall: -4.5, sway: 1.8, size: 3.4, blink: true, rise: true, box: [90, 40, 90], y0: -3 },
  bubbles: { fall: -3, sway: 0.8, size: 5, rise: true, box: [90, 40, 90], y0: -4 },
  leaves: { fall: 2.6, sway: 3.5, size: 5, box: [110, 40, 110], y0: -3 },
  fireflies: { fall: 0, sway: 2.4, size: 4.2, blink: true, box: [90, 10, 90], y0: -1 },
};

function Particles({ layer, budget, time, wind }: { layer: WorldLayer; budget: RenderBudget; time: { value: number }; wind: number }) {
  const flow = FLOWS[layer.kind];
  const n = Math.max(10, Math.round(num(layer, "count", 600) * budget.scale));
  const geo = useMemo(() => {
    const r = rng(layer.kind.length * 97);
    const verts = flow.streak ? 2 : 1;
    const p = new Float32Array(n * verts * 3), seed = new Float32Array(n * verts), end = new Float32Array(n * verts);
    for (let i = 0; i < n; i++) {
      const x = (r() - 0.5) * flow.box[0], y = r() * flow.box[1], z = (r() - 0.5) * flow.box[2] - 20, s = r();
      for (let v = 0; v < verts; v++) {
        p.set([x, y, z], (i * verts + v) * 3);
        seed[i * verts + v] = s;
        end[i * verts + v] = v;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    g.setAttribute("aEnd", new THREE.BufferAttribute(end, 1));
    return g;
  }, [n, flow, layer.kind]);
  const uniforms = useMemo(
    () => ({ uTime: time, uColor: { value: col(str(layer, "color", "#ffffff")) }, uOpacity: { value: layer.opacity }, uFall: { value: flow.fall }, uSway: { value: flow.sway }, uH: { value: flow.box[1] }, uY0: { value: flow.y0 }, uSize: { value: flow.size }, uWind: { value: wind }, uBlink: { value: flow.blink ? 1 : 0 } }),
    [time, layer, flow, wind],
  );
  const vs = `attribute float aSeed, aEnd; uniform float uTime, uFall, uSway, uH, uY0, uSize, uWind, uBlink; varying float vA;
    void main(){ vec3 p = position; float t = uTime * (0.7 + aSeed * 0.6);
      p.y = uY0 + mod(p.y - t * uFall, uH);
      p.x += sin(t * 0.7 + aSeed * 40.0) * uSway + uWind * mod(t * 3.0 + aSeed * 50.0, 40.0) * 0.3;
      p.z += cos(t * 0.5 + aSeed * 23.0) * uSway * 0.6;
      p.y -= aEnd * 1.6; p.x -= aEnd * uWind * 0.5;
      vA = uBlink > 0.5 ? pow(0.5 + 0.5 * sin(uTime * 3.0 + aSeed * 60.0), 3.0) : 1.0;
      vA *= smoothstep(0.0, 4.0, p.y - uY0) * smoothstep(uH, uH - 6.0, p.y - uY0);
      vec4 mvPosition = modelViewMatrix * vec4(p, 1.0); gl_PointSize = uSize * (60.0 / -mvPosition.z); gl_Position = projectionMatrix * mvPosition; }`;
  const fs = flow.streak
    ? `uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(uColor, 0.55 * uOpacity * vA); }`
    : `uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d); gl_FragColor = vec4(uColor * (1.0 + (1.0-d*2.0)*0.6), a * uOpacity * vA); }`;
  const additive = layer.kind === "embers" || layer.kind === "fireflies" || layer.kind === "bubbles";
  return flow.streak ? (
    <lineSegments geometry={geo} frustumCulled={false}>
      <shaderMaterial transparent depthWrite={false} uniforms={uniforms} vertexShader={vs} fragmentShader={fs} />
    </lineSegments>
  ) : (
    <points geometry={geo} frustumCulled={false}>
      <shaderMaterial transparent depthWrite={false} blending={additive ? THREE.AdditiveBlending : THREE.NormalBlending} uniforms={uniforms} vertexShader={vs} fragmentShader={fs} />
    </points>
  );
}

function Fog({ layer }: { layer: WorldLayer }) {
  const scene = useThree((s) => s.scene);
  useMemo(() => {
    scene.fog = new THREE.FogExp2(str(layer, "color", "#1b0b30"), num(layer, "density", 0.015) * layer.opacity);
  }, [scene, layer]);
  return null;
}

function Aurora({ layer, time }: { layer: WorldLayer; time: { value: number } }) {
  const bands = Math.round(num(layer, "bands", 4));
  return (
    <group position={[0, 18, -90]}>
      {Array.from({ length: bands }, (_, i) => (
        <mesh key={i} position={[(i - bands / 2) * 18, i * 3, -i * 14]} rotation-y={(i - bands / 2) * 0.12}>
          <planeGeometry args={[180, 46, 120, 1]} />
          <shaderMaterial
            transparent
            depthWrite={false}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            fog={false}
            uniforms={{ uTime: time, uA: { value: col(str(layer, "colorA", "#4ade80")) }, uB: { value: col(str(layer, "colorB", "#a78bfa")) }, uSeed: { value: i * 1.7 }, uOpacity: { value: layer.opacity } }}
            vertexShader={`uniform float uTime, uSeed; varying vec2 vUv; void main(){ vUv = uv; vec3 p = position; p.z += sin(p.x*0.04 + uTime*0.4 + uSeed)*10.0 + sin(p.x*0.11 - uTime*0.7)*3.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`}
            fragmentShader={`uniform vec3 uA, uB; uniform float uTime, uSeed, uOpacity; varying vec2 vUv;
              void main(){ float curtain = pow(0.5+0.5*sin(vUv.x*90.0 + sin(vUv.x*7.0+uTime*0.6+uSeed)*6.0), 3.0);
                float fadeY = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.35, vUv.y);
                float fadeX = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
                vec3 c = mix(uA, uB, smoothstep(0.35, 1.0, vUv.y));
                gl_FragColor = vec4(c, (0.25 + curtain*0.55) * fadeY * fadeX * 0.55 * uOpacity); }`}
          />
        </mesh>
      ))}
    </group>
  );
}

const softTexture = (() => {
  let t: THREE.CanvasTexture | null = null;
  return () => {
    if (t || typeof document === "undefined") return t;
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const r = rng(3);
    for (let i = 0; i < 14; i++) {
      const x = 30 + r() * 68, y = 40 + r() * 48, rad = 18 + r() * 26;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, "rgba(255,255,255,0.45)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 128);
    }
    t = new THREE.CanvasTexture(c);
    return t;
  };
})();

function Clouds({ layer, budget, time }: { layer: WorldLayer; budget: RenderBudget; time: { value: number } }) {
  const n = Math.max(4, Math.round(num(layer, "count", 20) * budget.scale));
  const ref = useRef<THREE.Group>(null);
  const items = useMemo(() => {
    const r = rng(17);
    return Array.from({ length: n }, () => ({ x: (r() - 0.5) * 220, y: 16 + r() * 22, z: -30 - r() * 140, s: 30 + r() * 50 }));
  }, [n]);
  useFrame(() => {
    if (ref.current) ref.current.position.x = ((time.value * 2) % 60) - 30;
  });
  const tex = softTexture();
  return (
    <group ref={ref}>
      {items.map((c, i) => (
        <sprite key={i} position={[c.x, c.y, c.z]} scale={[c.s, c.s * 0.55, 1]}>
          <spriteMaterial map={tex} color={str(layer, "color", "#5b6278")} transparent opacity={0.75 * layer.opacity} depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
}

function StormSpiral({ layer, time }: { layer: WorldLayer; time: { value: number } }) {
  const R = num(layer, "radius", 30);
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, num(layer, "height", 16), -60]}>
      <circleGeometry args={[R * 2.2, 96]} />
      <shaderMaterial
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        fog={false}
        uniforms={{ uTime: time, uArms: { value: num(layer, "arms", 5) }, uOpacity: { value: layer.opacity } }}
        vertexShader={`varying vec2 vUv; void main(){ vUv = uv - 0.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`}
        fragmentShader={`uniform float uTime, uArms, uOpacity; varying vec2 vUv;
          float n(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
          float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(n(i), n(i+vec2(1,0)), f.x), mix(n(i+vec2(0,1)), n(i+vec2(1,1)), f.x), f.y); }
          void main(){ float r = length(vUv) * 2.0; float a = atan(vUv.y, vUv.x);
            float spiral = sin(a * uArms + log(r + 0.02) * 9.0 + uTime * 0.6);
            float cloud = vn(vec2(a * 3.0 + uTime*0.2, r * 14.0)) * 0.6 + vn(vec2(a*9.0, r*40.0 - uTime)) * 0.4;
            float arms = smoothstep(-0.2, 0.9, spiral) * cloud;
            float eye = smoothstep(0.05, 0.12, r);
            float edge = smoothstep(1.0, 0.55, r);
            vec3 c = mix(vec3(0.35,0.38,0.5), vec3(0.92,0.94,1.0), arms);
            gl_FragColor = vec4(c, (0.25 + arms * 0.75) * eye * edge * uOpacity); }`}
      />
    </mesh>
  );
}

function Lightning({ layer, time }: { layer: WorldLayer; time: { value: number } }) {
  const light = useRef<THREE.PointLight>(null);
  const bolt = useRef<THREE.Line>(null);
  const scene = useThree((s) => s.scene);
  const every = num(layer, "every", 4);
  const geo = useMemo(() => new THREE.BufferGeometry().setFromPoints(Array.from({ length: 14 }, () => new THREE.Vector3())), []);
  useFrame(() => {
    const cycle = time.value % every;
    const on = cycle < 0.09 || (cycle > 0.16 && cycle < 0.22);
    const k = on ? 1 : 0;
    if (light.current) light.current.intensity = k * 900;
    if (bolt.current) {
      bolt.current.visible = on;
      if (on && cycle < 0.02) {
        const seed = Math.floor(time.value / every);
        const r = rng(seed + 1);
        const x0 = (r() - 0.5) * 120, z0 = -60 - r() * 60;
        const pos = geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < 14; i++) pos.setXYZ(i, x0 + (r() - 0.5) * 6 * i * 0.4, 40 - i * 3.2, z0);
        pos.needsUpdate = true;
        if (light.current) light.current.position.set(x0, 30, z0 + 20);
      }
    }
    scene.traverse((o) => {
      const sky = (o as THREE.Mesh).userData?.sky;
      if (sky) sky.uFlash.value = k * layer.opacity;
    });
  });
  return (
    <group>
      <pointLight ref={light} color={str(layer, "color", "#c7d2fe")} distance={260} decay={1.2} />
      <primitive object={new THREE.Line(geo, new THREE.LineBasicMaterial({ color: str(layer, "color", "#e0e7ff") }))} ref={bolt} />
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * 3D objects
 * ------------------------------------------------------------------ */

function Volcano({ layer, time }: { layer: WorldLayer; time: { value: number } }) {
  const H = num(layer, "height", 14), R = num(layer, "radius", 16);
  const geo = useMemo(() => {
    const g = new THREE.ConeGeometry(R, H, 96, 24, true);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const t = (y + H / 2) / H; // 0 base .. 1 top
      const crater = t > 0.86 ? 0.86 : t;
      const rr = Math.hypot(x, z) * (1 + (fbm(a * 3, y * 0.4, 3, 2) - 0.5) * 0.35) + (t > 0.86 ? R * 0.14 : 0);
      pos.setXYZ(i, Math.cos(a) * rr, (crater - 0.5) * H, Math.sin(a) * rr);
    }
    g.computeVertexNormals();
    return g;
  }, [H, R]);
  return (
    <group position={[num(layer, "x", 0), H / 2 - 2.5, num(layer, "z", -38)]}>
      <mesh geometry={geo}>
        <shaderMaterial
          fog
          uniforms={THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uLava: { value: col(str(layer, "lava", "#ff6a1a")) }, uH: { value: H }, uTime: { value: 0 } }])}
          ref={(m: THREE.ShaderMaterial | null) => {
            if (m) m.uniforms.uTime = time;
          }}
          vertexShader={`#include <fog_pars_vertex>
            varying vec3 vP; varying vec3 vN; void main(){ vP = position; vN = normal; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
            }`}
          fragmentShader={`#include <fog_pars_fragment>
            uniform vec3 uLava; uniform float uH, uTime; varying vec3 vP; varying vec3 vN;
            void main(){ float t = vP.y / uH + 0.5; float a = atan(vP.z, vP.x);
              float rock = 0.16 + 0.07 * sin(a * 23.0 + vP.y * 2.0);
              float flow = pow(max(0.0, sin(a * 7.0 + sin(vP.y*0.6)*0.6)), 18.0) * smoothstep(0.2, 0.85, t);
              float rim = smoothstep(0.8, 0.86, t);
              float pulse = 0.7 + 0.3 * sin(uTime * 2.0 - vP.y * 0.8);
              vec3 c = vec3(rock * 0.95, rock * 0.62, rock * 0.55) * (0.7 + max(0.0, vN.y) * 0.9) + uLava * 0.08 * (1.0 - t);
              c += uLava * (flow * pulse * 1.8 + rim * 2.4);
              gl_FragColor = vec4(c, 1.0);
              #include <fog_fragment>
            }`}
        />
      </mesh>
      <Plume y={H / 2 - 1} color={str(layer, "lava", "#ff6a1a")} time={time} />
      <pointLight position={[0, H / 2 + 2, 0]} color={str(layer, "lava", "#ff6a1a")} intensity={600} distance={90} decay={1.4} />
      <mesh position={[0, H / 2 - H * 0.12, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[R * 0.16, 32]} />
        <meshBasicMaterial color={str(layer, "lava", "#ff6a1a")} />
      </mesh>
    </group>
  );
}

function Plume({ y, color, time }: { y: number; color: string; time: { value: number } }) {
  const geo = useMemo(() => {
    const r = rng(12);
    const p = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) p.set([r(), r(), r()], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    return g;
  }, []);
  return (
    <points geometry={geo} position-y={y} frustumCulled={false}>
      <shaderMaterial
        transparent
        depthWrite={false}
        uniforms={{ uTime: time, uC: { value: col(color) } }}
        vertexShader={`uniform float uTime; varying float vK; void main(){ float k = fract(position.y + uTime * 0.06); vK = k; float a = position.x * 6.283 + k * 4.0;
          vec3 p = vec3(cos(a) * (0.6 + k * 9.0) * position.z + k * 10.0, k * 34.0, sin(a) * (0.6 + k * 7.0) * position.z);
          vec4 mvPosition = modelViewMatrix * vec4(p,1.0); gl_PointSize = (90.0 + k * 520.0) / -mvPosition.z; gl_Position = projectionMatrix * mvPosition; }`}
        fragmentShader={`uniform vec3 uC; varying float vK; void main(){ float d = length(gl_PointCoord-0.5); vec3 c = mix(uC * 1.4, vec3(0.22,0.18,0.18), smoothstep(0.0, 0.25, vK)); gl_FragColor = vec4(c, smoothstep(0.5,0.0,d) * (1.0 - vK) * 0.32); }`}
      />
    </points>
  );
}

function Planet({ layer, time }: { layer: WorldLayer; time: { value: number } }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (ref.current) ref.current.rotation.y = time.value * 0.05;
  });
  const R = num(layer, "radius", 4);
  return (
    <group position={[num(layer, "x", 14), num(layer, "y", 6), num(layer, "z", -24)]} rotation-z={0.35}>
      <group ref={ref}>
        <mesh>
          <sphereGeometry args={[R, 64, 32]} />
          <shaderMaterial
            uniforms={{ uC: { value: col(str(layer, "color", "#7c3aed")) }, uRing: { value: col(str(layer, "ring", "#f5c46b")) } }}
            vertexShader={`varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix * normal); vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`}
            fragmentShader={`uniform vec3 uC, uRing; varying vec3 vN; varying vec3 vP;
              void main(){ float bands = sin(vP.y * 3.2 + sin(vP.x*1.3)*0.8) * 0.5 + 0.5; vec3 c = mix(uC * 0.6, uC * 1.3 + uRing*0.15, bands);
                float light = max(0.08, dot(vN, normalize(vec3(-0.6, 0.4, 0.7)))); float rimL = pow(1.0 - max(0.0, vN.z), 3.0);
                gl_FragColor = vec4(c * light + uRing * rimL * 0.6, 1.0); }`}
          />
        </mesh>
      </group>
      <mesh rotation-x={Math.PI / 2.3}>
        <ringGeometry args={[R * 1.35, R * 2.1, 96]} />
        <meshBasicMaterial color={str(layer, "ring", "#f5c46b")} transparent opacity={0.55} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

const ZODIAC = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];
function glyphTexture(glyph: string, color: string) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = color;
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.font = "84px 'Segoe UI Symbol', 'Noto Sans Symbols', 'DejaVu Sans', serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(`${glyph}︎`, 64, 68);
  return new THREE.CanvasTexture(c);
}

function ZodiacRing({ layer, time }: { layer: WorldLayer; time: { value: number } }) {
  const ref = useRef<THREE.Group>(null);
  const R = num(layer, "radius", 11), color = str(layer, "color", "#f5c46b");
  const textures = useMemo(() => ZODIAC.map((g) => glyphTexture(g, color)), [color]);
  useFrame(() => {
    if (ref.current) ref.current.rotation.y = time.value * 0.08;
  });
  return (
    <group position={[0, 7, -18]} rotation-x={0.32}>
      <group ref={ref}>
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[R, 0.08, 8, 160]} />
          <meshBasicMaterial color={color} />
        </mesh>
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[R * 0.82, 0.04, 8, 160]} />
          <meshBasicMaterial color={color} transparent opacity={0.6} />
        </mesh>
        {ZODIAC.map((_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return (
            <group key={i}>
              <sprite position={[Math.cos(a) * R * 0.91, 0, Math.sin(a) * R * 0.91]} scale={[1.7, 1.7, 1]}>
                <spriteMaterial map={textures[i]} transparent depthWrite={false} />
              </sprite>
              <mesh position={[Math.cos(a + Math.PI / 12) * R * 0.91, 0, Math.sin(a + Math.PI / 12) * R * 0.91]} rotation-y={-a - Math.PI / 12}>
                <boxGeometry args={[0.04, 0.04, R * 0.18]} />
                <meshBasicMaterial color={color} />
              </mesh>
            </group>
          );
        })}
      </group>
    </group>
  );
}

function Coral({ layer, budget }: { layer: WorldLayer; budget: RenderBudget }) {
  const n = Math.max(6, Math.round(num(layer, "count", 30) * budget.scale));
  const mesh = useMemo(() => {
    const r = rng(23);
    const mats: THREE.Matrix4[] = [];
    const cols: number[] = [];
    const a = col(str(layer, "color", "#f472b6")), b = col(str(layer, "glow", "#2dd4bf")), c = new THREE.Color();
    const branch = (p: THREE.Vector3, dir: THREE.Vector3, len: number, depth: number, tint: THREE.Color) => {
      const end = p.clone().addScaledVector(dir, len);
      const mid = p.clone().add(end).multiplyScalar(0.5);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      mats.push(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(0.22 * (depth + 1) * 0.55, len, 0.22 * (depth + 1) * 0.55)));
      cols.push(tint.r, tint.g, tint.b);
      if (depth <= 0) {
        mats.push(new THREE.Matrix4().compose(end, new THREE.Quaternion(), new THREE.Vector3(0.45, 0.45, 0.45)));
        cols.push(b.r, b.g, b.b);
        return;
      }
      for (let k = 0; k < 2 + Math.floor(r() * 2); k++) {
        const d = dir.clone().add(new THREE.Vector3((r() - 0.5) * 1.3, 0.4 + r() * 0.4, (r() - 0.5) * 1.3)).normalize();
        branch(end, d, len * (0.65 + r() * 0.2), depth - 1, tint);
      }
    };
    for (let i = 0; i < n; i++) {
      const x = (r() - 0.5) * 90, z = -10 - r() * 70;
      c.copy(a).lerp(b, r() * 0.6).offsetHSL((r() - 0.5) * 0.12, 0, 0);
      branch(new THREE.Vector3(x, fbm(x * 0.04, z * 0.04, 4, 3) * 3 - 3, z), new THREE.Vector3(0, 1, 0), 1.6 + r() * 1.6, 3, c.clone());
    }
    const geo = new THREE.CylinderGeometry(0.5, 0.7, 1, 6);
    const material = new THREE.MeshBasicMaterial({ color: "#ffffff" });
    const m = new THREE.InstancedMesh(geo, material, mats.length);
    mats.forEach((x, i) => m.setMatrixAt(i, x));
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cols), 3);
    return m;
  }, [layer, n]);
  return <primitive object={mesh} />;
}

function Jellyfish({ layer, budget, time }: { layer: WorldLayer; budget: RenderBudget; time: { value: number } }) {
  const n = Math.max(2, Math.round(num(layer, "count", 8) * budget.scale));
  const items = useMemo(() => {
    const r = rng(31);
    return Array.from({ length: n }, () => ({ x: (r() - 0.5) * 60, y: 4 + r() * 14, z: -15 - r() * 50, s: 0.8 + r() * 1.4, p: r() * 6 }));
  }, [n]);
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    group.current?.children.forEach((c, i) => {
      const it = items[i];
      c.position.y = it.y + Math.sin(time.value * 0.8 + it.p) * 1.6;
      c.scale.set(it.s * (1 + Math.sin(time.value * 2 + it.p) * 0.08), it.s, it.s * (1 + Math.sin(time.value * 2 + it.p) * 0.08));
    });
  });
  const color = str(layer, "color", "#a5f3fc");
  return (
    <group ref={group}>
      {items.map((it, i) => (
        <group key={i} position={[it.x, it.y, it.z]}>
          <mesh>
            <sphereGeometry args={[1.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshBasicMaterial color={color} transparent opacity={0.45} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          {Array.from({ length: 6 }, (_, k) => (
            <mesh key={k} position={[Math.cos(k) * 0.6, -1.6, Math.sin(k) * 0.6]}>
              <cylinderGeometry args={[0.03, 0.01, 3.2, 3]} />
              <meshBasicMaterial color={color} transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
          ))}
          <pointLight color={color} intensity={14} distance={10} />
        </group>
      ))}
    </group>
  );
}

function Trees({ layer, budget, terrain }: { layer: WorldLayer; budget: RenderBudget; terrain: WorldLayer | undefined }) {
  const n = Math.max(20, Math.round(num(layer, "count", 220) * budget.scale));
  const season = str(layer, "season", "summer");
  const { crowns, trunks } = useMemo(() => {
    const r = rng(77);
    const height = terrain ? num(terrain, "height", 8) : 0;
    const base = col(str(layer, "color", "#2e6b3a"));
    const crownGeo = season === "winter" ? new THREE.ConeGeometry(1, 2.6, 7) : new THREE.IcosahedronGeometry(1, 1);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), n);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.2, 1, 5), new THREE.MeshStandardMaterial({ color: "#3b2a1e", roughness: 1 }), n);
    const c = new THREE.Color();
    let k = 0;
    for (let i = 0; i < n * 3 && k < n; i++) {
      const x = (r() - 0.5) * 150, z = 10 - r() * 130;
      if (Math.abs(x - riverX(z)) < 6) continue;
      if (Math.abs(x) < 12 && z > -10) continue; // keep the foreground open
      const y = terrain ? terrainHeight(x, z, height) : -2;
      const s = 1 + r() * 1.3;
      crowns.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(x, y + 1.6 * s, z), new THREE.Quaternion(), new THREE.Vector3(s * (season === "winter" ? 0.9 : 1.1), s * (season === "winter" ? 1.3 : 1), s * (season === "winter" ? 0.9 : 1.1))));
      trunks.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(x, y + 0.5 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
      c.copy(base).offsetHSL((r() - 0.5) * 0.06, (r() - 0.5) * 0.2, (r() - 0.5) * 0.18);
      if (season === "winter" && r() > 0.4) c.lerp(new THREE.Color("#ffffff"), 0.35);
      crowns.setColorAt(k, c);
      k++;
    }
    crowns.count = trunks.count = k;
    return { crowns, trunks };
  }, [layer, n, season, terrain]);
  return (
    <group>
      <primitive object={crowns} />
      <primitive object={trunks} />
    </group>
  );
}

function Crystals({ layer, budget, time }: { layer: WorldLayer; budget: RenderBudget; time: { value: number } }) {
  const n = Math.max(1, Math.round(num(layer, "count", 5) * Math.max(0.6, budget.scale)));
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    ref.current?.children.forEach((c, i) => {
      c.rotation.y = time.value * (0.2 + i * 0.05);
      c.position.y = 3 + Math.sin(time.value + i) * 0.8 + (i % 2) * 4;
    });
  });
  const color = str(layer, "color", "#c084fc");
  return (
    <group ref={ref}>
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return (
          <group key={i} position={[Math.cos(a) * 16, 3, -20 + Math.sin(a) * 10]}>
            <mesh scale={[1.4, 3, 1.4]}>
              <octahedronGeometry args={[1, 0]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} metalness={0.6} roughness={0.15} transparent opacity={0.85} />
            </mesh>
            <mesh scale={[1.45, 3.05, 1.45]}>
              <octahedronGeometry args={[1, 0]} />
              <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.5} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function NeuralSphere({ layer, budget, time }: { layer: WorldLayer; budget: RenderBudget; time: { value: number } }) {
  const R = num(layer, "radius", 6), nodes = Math.max(40, Math.round(num(layer, "nodes", 220) * budget.scale));
  const { points, lines } = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < nodes; i++) {
      const y = 1 - (i / (nodes - 1)) * 2, rad = Math.sqrt(1 - y * y), th = golden * i;
      pts.push(new THREE.Vector3(Math.cos(th) * rad * R, y * R, Math.sin(th) * rad * R));
    }
    const seg: number[] = [];
    pts.forEach((p, i) => {
      const near = pts.map((q, j) => [p.distanceToSquared(q), j] as const).filter(([, j]) => j > i).sort((a, b) => a[0] - b[0]).slice(0, 2);
      near.forEach(([, j]) => seg.push(p.x, p.y, p.z, pts[j].x, pts[j].y, pts[j].z));
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(seg), 3));
    const pg = new THREE.BufferGeometry().setFromPoints(pts);
    return { points: pg, lines: lg };
  }, [R, nodes]);
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (ref.current) ref.current.rotation.y = time.value * 0.15;
  });
  const color = str(layer, "color", "#a78bfa");
  return (
    <group ref={ref} position={[num(layer, "x", 0), num(layer, "y", 6), num(layer, "z", -20)]}>
      <lineSegments geometry={lines}>
        <lineBasicMaterial color={color} transparent opacity={0.45} blending={THREE.AdditiveBlending} />
      </lineSegments>
      <points geometry={points}>
        <pointsMaterial color={color} size={0.35} transparent opacity={0.95} blending={THREE.AdditiveBlending} />
      </points>
      <mesh>
        <sphereGeometry args={[R * 0.3, 24, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

function Pyramid({ layer }: { layer: WorldLayer }) {
  const S = num(layer, "size", 12), steps = 6, color = str(layer, "color", "#d7b072");
  return (
    <group position={[num(layer, "x", 8), -2, num(layer, "z", -40)]}>
      {Array.from({ length: steps }, (_, i) => {
        const w = S * 2 * (1 - i / steps);
        const h = (S * 0.9) / steps;
        return (
          <mesh key={i} position={[0, h * i + h / 2, 0]}>
            <boxGeometry args={[w, h, w]} />
            <meshStandardMaterial color={color} roughness={0.9} />
          </mesh>
        );
      })}
    </group>
  );
}

function WavePacket({ layer, time }: { layer: WorldLayer; time: { value: number } }) {
  const S = num(layer, "size", 30);
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, -1, -16]}>
      <planeGeometry args={[S, S, 180, 180]} />
      <shaderMaterial
        transparent
        side={THREE.DoubleSide}
        uniforms={{ uTime: time, uColor: { value: col(str(layer, "color", "#38bdf8")) } }}
        vertexShader={`uniform float uTime; varying float vH; varying vec2 vP;
          void main(){ vec3 p = position; vP = p.xy; vec2 s1 = vec2(-3.0, 15.0), s2 = vec2(3.0, 15.0);
            float k = 1.6; float r1 = length(p.xy - s1), r2 = length(p.xy - s2);
            float h = (cos(k*r1 - uTime*2.0) + cos(k*r2 - uTime*2.0)) * 0.5 * smoothstep(15.0, 0.0, p.y + 0.0) ;
            h *= exp(-length(p.xy) * 0.03); p.z = h * 2.2; vH = h; gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`}
        fragmentShader={`uniform vec3 uColor; varying float vH; varying vec2 vP;
          void main(){ float grid = step(0.94, fract(vP.x*0.8)) + step(0.94, fract(vP.y*0.8)); vec3 c = uColor * (0.35 + vH*0.9) + vec3(1.0)*grid*0.12;
            gl_FragColor = vec4(c, 0.55 + abs(vH)*0.4); }`}
      />
    </mesh>
  );
}

function Traffic({ layer, budget, time }: { layer: WorldLayer; budget: RenderBudget; time: { value: number } }) {
  const n = Math.max(10, Math.round(num(layer, "count", 80) * budget.scale));
  const geo = useMemo(() => {
    const r = rng(5);
    const p = new Float32Array(n * 3), s = new Float32Array(n), dir = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const lane = r() > 0.5;
      p.set(lane ? [(r() - 0.5) * 1.6 + 0, -1.6, 0] : [0, -1.6, -8 - 6.2 * 4 * Math.floor(r() * 4)], i * 3);
      s[i] = r();
      dir[i] = lane ? 0 : 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(s, 1));
    g.setAttribute("aDir", new THREE.BufferAttribute(dir, 1));
    return g;
  }, [n]);
  return (
    <points geometry={geo} frustumCulled={false}>
      <shaderMaterial
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        uniforms={{ uTime: time, uHead: { value: col(str(layer, "head", "#fef3c7")) }, uTail: { value: col(str(layer, "tail", "#f43f5e")) } }}
        vertexShader={`attribute float aSeed, aDir; uniform float uTime; varying float vSide;
          void main(){ vec3 p = position; float t = mod(uTime * (6.0 + aSeed*6.0) + aSeed * 300.0, 240.0) - 200.0; vSide = step(0.5, fract(aSeed*7.0));
            if (aDir < 0.5) { p.z = vSide > 0.5 ? t : -t - 160.0; p.x += vSide > 0.5 ? 0.9 : -0.9; } else { p.x = vSide > 0.5 ? t + 80.0 : -t - 80.0; }
            vec4 mvPosition = modelViewMatrix * vec4(p,1.0); gl_PointSize = 260.0 / -mvPosition.z; gl_Position = projectionMatrix * mvPosition; }`}
        fragmentShader={`uniform vec3 uHead, uTail; varying float vSide; void main(){ float d = length(gl_PointCoord-0.5); gl_FragColor = vec4(mix(uTail, uHead, vSide), smoothstep(0.5,0.0,d)); }`}
      />
    </points>
  );
}

function Prisms({ layer, budget, time }: { layer: WorldLayer; budget: RenderBudget; time: { value: number } }) {
  const n = Math.max(2, Math.round(num(layer, "count", 6) * Math.max(0.6, budget.scale)));
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    ref.current?.children.forEach((c, i) => {
      c.rotation.set(time.value * 0.2 + i, time.value * 0.3 + i * 2, 0);
    });
  });
  return (
    <group ref={ref}>
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * (10 + (i % 3) * 5), 3 + (i % 3) * 3, -22 + Math.sin(a) * 8]} scale={1.6 + (i % 3) * 0.6}>
            <cylinderGeometry args={[1.4, 1.4, 3.6, 3]} />
            <shaderMaterial
              transparent
              uniforms={{ uTime: time }}
              vertexShader={`varying vec3 vN; varying vec3 vV; void main(){ vec4 mvPosition = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mvPosition.xyz); gl_Position = projectionMatrix * mvPosition; }`}
              fragmentShader={`uniform float uTime; varying vec3 vN; varying vec3 vV;
                void main(){ float f = 1.0 - abs(dot(vN, vV)); vec3 rainbow = 0.5 + 0.5*cos(6.2831*(f*1.4 + uTime*0.05 + vec3(0.0,0.33,0.67)));
                  gl_FragColor = vec4(rainbow * (0.35 + f*1.3), 0.35 + f*0.6); }`}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function Tornado({ layer, budget, time }: { layer: WorldLayer; budget: RenderBudget; time: { value: number } }) {
  const n = Math.max(300, Math.round(2400 * budget.scale));
  const geo = useMemo(() => {
    const r = rng(8);
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) p.set([r(), r(), r()], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    return g;
  }, [n]);
  return (
    <points geometry={geo} position={[num(layer, "x", -18), -2, num(layer, "z", -50)]} frustumCulled={false}>
      <shaderMaterial
        transparent
        depthWrite={false}
        uniforms={{ uTime: time }}
        vertexShader={`uniform float uTime; void main(){ float h = position.y; float rad = 0.6 + h*h*9.0 + position.z*1.2; float a = position.x*6.283 + uTime*(3.0 - h*1.5);
          vec3 p = vec3(cos(a)*rad, h*34.0, sin(a)*rad); vec4 mvPosition = modelViewMatrix * vec4(p,1.0); gl_PointSize = 120.0 / -mvPosition.z; gl_Position = projectionMatrix * mvPosition; }`}
        fragmentShader={`void main(){ float d = length(gl_PointCoord-0.5); gl_FragColor = vec4(vec3(0.55,0.55,0.62), smoothstep(0.5,0.0,d)*0.35); }`}
      />
    </points>
  );
}

/* ------------------------------------------------------------------ *
 * The scene
 * ------------------------------------------------------------------ */

export function WorldScene({ world, budget }: { world: WorldConfig; budget: RenderBudget }) {
  const time = useClock(budget.motion);
  const scene = useThree((s) => s.scene);
  const motionLayer = layersOf(world, "motion")[0];
  const wind = motionLayer ? num(motionLayer, "wind", 0.5) : 0.5;
  const found = layersOf(world, "foundation");
  const atmo = layersOf(world, "atmosphere");
  const objs = layersOf(world, "objects3d");
  const terrain = found.find((l) => l.kind === "terrain");
  if (!atmo.some((l) => l.kind === "fog")) scene.fog = null;
  const sunny = found.find((l) => l.kind === "sky");
  return (
    <>
      <ambientLight intensity={0.55} color={world.palette.sky[2]} />
      <hemisphereLight args={[world.palette.sky[2], "#0a0a12", 0.7]} />
      <directionalLight position={[-30, 40, 20]} intensity={sunny && num(sunny, "sun", 0) ? 1.6 : 0.8} color={world.palette.glow} />
      {found.map((l) => {
        const k = `${l.id}`;
        switch (l.kind) {
          case "sky":
            return <Sky key={k} world={world} layer={l} time={time} />;
          case "stars":
            return <Stars key={k} layer={l} budget={budget} time={time} />;
          case "ocean":
            return <Ocean key={k} layer={l} time={time} />;
          case "terrain":
            return <Terrain key={k} layer={l} />;
          case "seabed":
            return <Terrain key={k} layer={l} seabed />;
          case "lava-field":
            return <LavaField key={k} layer={l} time={time} />;
          case "city":
            return <City key={k} layer={l} budget={budget} />;
          default:
            return null;
        }
      })}
      {objs.map((l) => {
        const k = l.id;
        const t = l.transform;
        const node = (() => {
          switch (l.kind) {
            case "volcano":
              return <Volcano layer={l} time={time} />;
            case "planet":
              return <Planet layer={l} time={time} />;
            case "zodiac-ring":
              return <ZodiacRing layer={l} time={time} />;
            case "coral":
              return <Coral layer={l} budget={budget} />;
            case "jellyfish":
              return <Jellyfish layer={l} budget={budget} time={time} />;
            case "trees":
              return <Trees layer={l} budget={budget} terrain={terrain} />;
            case "crystal":
              return <Crystals layer={l} budget={budget} time={time} />;
            case "neural-sphere":
              return <NeuralSphere layer={l} budget={budget} time={time} />;
            case "pyramid":
              return <Pyramid layer={l} />;
            case "wave-packet":
              return <WavePacket layer={l} time={time} />;
            case "traffic":
              return <Traffic layer={l} budget={budget} time={time} />;
            case "prism":
              return <Prisms layer={l} budget={budget} time={time} />;
            case "tornado":
              return <Tornado layer={l} budget={budget} time={time} />;
            default:
              return null;
          }
        })();
        return (
          <group key={k} position={[t.x, t.y, t.z]} scale={t.scale} rotation-y={(t.rotation * Math.PI) / 180} userData={{ layer: l.id }}>
            {node}
          </group>
        );
      })}
      {atmo.map((l) => {
        const k = l.id;
        if (FLOWS[l.kind]) return <Particles key={k} layer={l} budget={budget} time={time} wind={wind} />;
        switch (l.kind) {
          case "fog":
            return <Fog key={k} layer={l} />;
          case "aurora":
            return <Aurora key={k} layer={l} time={time} />;
          case "clouds":
            return <Clouds key={k} layer={l} budget={budget} time={time} />;
          case "storm-spiral":
            return <StormSpiral key={k} layer={l} time={time} />;
          case "lightning":
            return <Lightning key={k} layer={l} time={time} />;
          default:
            return null;
        }
      })}
    </>
  );
}
