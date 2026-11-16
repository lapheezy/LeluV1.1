/**
 * ==========================================================
 * LÉLU — INTERFACE SHELL (Mission 17)
 *
 * Mounted once by the scene router, beside the other app-level bridges.
 * It does three small things and draws nothing of its own:
 *
 *   1. attaches the ONE interface launcher, so LÉLU's tools
 *      (interface.open) can open an interface or a composition — and
 *      fail honestly whenever this shell is not mounted;
 *   2. honours the standalone deep links (?interface=…, ?composition=…)
 *      once, on arrival;
 *   3. mounts the composition view (its own chunk) only while a
 *      composition is open.
 * ==========================================================
 */

import { lazy, Suspense, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useGenesis } from "../GenesisCore";
import { attachInterfaceLauncher, launchFromQuery, type LaunchRequest } from "../../../../core/interface/interfaceLaunch";
import { closeComposition, openComposition, openInterface } from "./interfaceActions";
import { useCompositionOpen } from "./useInterfaceCompositions";
import HomeStore from "../home/homeStore";
import { useNeuralView } from "../neural/useNeuralViewLite";

const InterfaceJourney = lazy(() => import("./InterfaceJourney"));
/* M17.2: the embedded inspector and the standalone Neural Map, fetched only
   when one is first opened. */
const NeuralHost = lazy(() => import("../neural/NeuralHost"));

export default function InterfaceShell() {
  const genesis = useGenesis();
  const navigate = useNavigate();
  const open = useCompositionOpen();

  // Latest genesis/navigate without re-attaching the launcher every render.
  const ref = useRef({ genesis, navigate });
  ref.current = { genesis, navigate };

  useEffect(() => {
    const run = (request: LaunchRequest) => {
      const { genesis: g, navigate: nav } = ref.current;
      if (request.kind === "interface") return openInterface(g, request.id, nav, { entity: request.entity });
      if (request.kind === "composition") return openComposition(g, request.id, request.regionKey);
      return closeComposition();
    };
    return attachInterfaceLauncher(run);
  }, []);

  // Standalone entry points, once per page load.
  useEffect(() => {
    const request = launchFromQuery(window.location.search);
    if (!request) return;
    // Let the shell finish its first frame (sign-in gate, home) first.
    const t = window.setTimeout(() => {
      const { genesis: g, navigate: nav } = ref.current;
      if (request.kind === "interface") openInterface(g, request.id, nav, { entity: request.entity });
      else if (request.kind === "composition") openComposition(g, request.id, request.regionKey);
    }, 300);
    return () => window.clearTimeout(t);
  }, []);

  // Coming back to the Home (orb / Home button) leaves the composition:
  // the composition lives in the Cosmos view, the Home steps back over it.
  useEffect(() => {
    if (!open) return;
    return HomeStore.subscribe((s) => {
      if (!s.immersive) closeComposition();
    });
  }, [open]);

  const neural = useNeuralView();
  const neuralWanted = neural.inspecting !== null || neural.standalone.open;
  return (
    <>
      {open ? (
        <Suspense fallback={null}>
          <InterfaceJourney />
        </Suspense>
      ) : null}
      {neuralWanted ? (
        <Suspense fallback={null}>
          <NeuralHost />
        </Suspense>
      ) : null}
    </>
  );
}
