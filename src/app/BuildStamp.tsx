/**
 * TEMPORARY — which build is on this screen.
 *
 * The live app and the repository disagreed and nobody could tell which
 * code a phone was running. This prints the commit, branch and build time
 * compiled into the bundle (see core/build/BuildInfo), on every route and
 * over every surface, without taking any touches.
 */
import { useEffect } from "react";
import { buildInfo, buildLabel } from "../core/build/BuildInfo";

export default function BuildStamp() {
  const info = buildInfo();
  useEffect(() => {
    (window as unknown as { __LELU_BUILD__?: unknown }).__LELU_BUILD__ = info;
    console.info(`[build] ${buildLabel(info)} (sha ${info.sha})`);
  }, [info]);
  return (
    <div
      data-lelu-build={info.sha}
      aria-hidden
      style={{
        position: "fixed",
        right: 6,
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 2px)",
        zIndex: 2147483647,
        pointerEvents: "none",
        font: "9px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace",
        color: "rgba(255,255,255,0.72)",
        background: "rgba(0,0,0,0.45)",
        padding: "1px 4px",
        borderRadius: 3,
        maxWidth: "calc(100vw - 12px)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {buildLabel(info)}
    </div>
  );
}
