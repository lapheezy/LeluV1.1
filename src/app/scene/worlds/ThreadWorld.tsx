/**
 * The active world (or an era comparison) behind a conversation thread, and
 * the world editor beside it (WP21 · WP06). The thread itself stays on top
 * and readable: the world is the stage's environment, not its content.
 */
import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { placeWorld } from "../../../core/worlds/Places";
import type { WorldConfig } from "../../../core/worlds/WorldSchema";
import { layersOf } from "../../../core/worlds/WorldSchema";
import { useActiveWorld, type Compare } from "./WorldEditor";
import "./world.css";

const WorldStage = lazy(() => import("./WorldStage"));
const WorldEditor = lazy(() => import("./WorldEditor"));

/** The world's panel treatment as CSS variables (read by thread panels and the composer). */
export function worldVars(world: WorldConfig | null): React.CSSProperties {
  if (!world) return {};
  const f = layersOf(world, "spatialUI")[0];
  return {
    ["--w-tint" as string]: String(f?.params.tint ?? world.palette.sky[1]),
    ["--w-edge" as string]: String(f?.params.edge ?? world.palette.glow),
    ["--w-glow" as string]: String(f?.params.glow ?? world.palette.accent),
    ["--w-ink" as string]: world.palette.ink,
  };
}

export default function ThreadWorld({ editorOpen, onCloseEditor, paused, images = [], children }: { editorOpen: boolean; onCloseEditor: () => void; paused: boolean; images?: Array<{ id: string; title: string; src: string; by: string }>; children: ReactNode }) {
  const world = useActiveWorld();
  const [compare, setCompare] = useState<Compare | null>(null);
  const pair = useMemo(() => (compare ? [placeWorld(compare.placeId, compare.a), placeWorld(compare.placeId, compare.b)] : null), [compare]);
  const shown = pair?.[0] ?? world;
  const frame = shown ? layersOf(shown, "spatialUI")[0] : undefined;
  return (
    <div className="tw-host" data-world-on={shown ? "true" : "false"} data-world-ink={frame?.params.ink ? "true" : "false"} data-world-active={world?.id ?? ""} style={worldVars(shown)}>
      {pair && pair[0] && pair[1] ? (
        <div className="tw-world" data-world-compare={`${compare!.a}|${compare!.b}`}>
          <Suspense fallback={null}>
            <WorldStage world={pair[0]} paused={paused} interactive={false} />
            <div className="tw-right" style={{ clipPath: `inset(0 0 0 ${compare!.split * 100}%)` }}>
              <WorldStage world={pair[1]} paused={paused} interactive={false} />
            </div>
          </Suspense>
          <input className="tw-split" type="range" min={0.05} max={0.95} step={0.01} value={compare!.split} onChange={(e) => setCompare({ ...compare!, split: +e.target.value })} aria-label="Compare eras" data-compare-split />
          <span className="tw-split-line" style={{ left: `${compare!.split * 100}%` }} />
        </div>
      ) : world ? (
        <div className="tw-world">
          <Suspense fallback={null}>
            <WorldStage key={world.id} world={world} paused={paused} />
          </Suspense>
        </div>
      ) : null}
      {children}
      {editorOpen ? (
        <Suspense fallback={null}>
          <WorldEditor onClose={onCloseEditor} compare={compare} setCompare={setCompare} images={images} />
        </Suspense>
      ) : null}
    </div>
  );
}
