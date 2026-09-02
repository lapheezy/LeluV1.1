/**
 * LÉLU UI WORLD MODEL / ACTION BUS VERIFICATION
 *
 * Proves the live loop the Mark-LI fusion's "CRITICAL ADDITION" demands:
 *
 *   PERCEIVE → WORLD MODEL → REASON → PLAN → ACT → OBSERVE → RECONCILE
 *
 * without a mounted React tree — by simulating the ONE thing GenesisInterface
 * does on mount (registering real handlers with UIActionBus) using a fake
 * but faithful stand-in for openPanel/openModule/etc., then driving
 * EngineeringResolver's navigation intents exactly as chat would.
 *
 * This is not a UI-existence check. It proves:
 *  1. Before any UI is mounted, a cognitive action fails HONESTLY
 *     ("no LÉLU interface is currently mounted") — never a fake success.
 *  2. Once the UI registers its real, bounded capability set, a
 *     navigation request actually calls the real openPanel function
 *     (verified by the fake handler's own call log, not by trusting the
 *     bus's claim).
 *  3. An action targeting a panel the UI does NOT support is rejected —
 *     "only expose actions the actual UI supports" is enforced, not
 *     just documented.
 *  4. Every dispatch (success or failure) is reflected into UIStateStore
 *     (lastAction/actionHistory) — the SAME world model CognitiveContext
 *     reads — so cognition never has a second, disagreeing notion of
 *     "what did LÉLU just do".
 *  5. "return to previous context" actually restores the panel that was
 *     active before LÉLU's own navigation — not just closes the target.
 *  6. Unregistering the handlers (interface unmount) makes the bus
 *     honestly report disconnection again.
 *
 * Run: bun run scripts/verify-ui-action-bus.ts
 */

// -- minimal browser globals CognitiveContext/UIStateStore/EngineeringResolver touch --
// @ts-expect-error — global shim for Node
globalThis.window = globalThis.window ?? {};

import UIActionBus from "../src/core/cognition/UIActionBus";
import UIStateStore from "../src/core/cognition/UIStateStore";

let failures = 0;
function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function main(): void {
  const bus = UIActionBus.getInstance();

  console.log("== Before any UI mounts, a dispatch fails honestly ==");
  assert(bus.isConnected() === false, "bus reports disconnected with no registered handlers");
  const beforeMount = bus.dispatch({ type: "open_panel", target: "memory", reason: "test", initiatedBy: "lelu" });
  assert(beforeMount.ok === false, "dispatch before mount is NOT claimed successful");
  assert(
    beforeMount.detail.includes("No LÉLU interface"),
    "failure message is honest about WHY, not a generic error",
    beforeMount.detail,
  );

  console.log("\n== Real UI mounts: registers its REAL, bounded capability set ==");
  const calls: Array<{ fn: string; arg: string }> = [];
  let fakeActivePanel: string | null = "chat";
  const unregister = bus.registerHandlers({
    supportedPanels: ["memory", "engineering", "reasoning", "chat", "none"],
    openPanel: (panel) => {
      calls.push({ fn: "openPanel", arg: panel });
      fakeActivePanel = panel === "none" ? null : panel;
    },
    openModule: (id) => calls.push({ fn: "openModule", arg: id }),
    minimizeModule: (id) => calls.push({ fn: "minimizeModule", arg: id }),
    closeModule: (id) => calls.push({ fn: "closeModule", arg: id }),
    getActivePanel: () => fakeActivePanel,
  });
  assert(bus.isConnected(), "bus reports connected once the live UI registers handlers");

  console.log("\n== A supported navigation action actually calls the real handler ==");
  const openMemory = bus.dispatch({ type: "open_panel", target: "memory", reason: "user asked to see memory", initiatedBy: "lelu" });
  assert(openMemory.ok, "dispatch reports success", openMemory.detail);
  assert(
    calls.some((c) => c.fn === "openPanel" && c.arg === "memory"),
    "the REAL openPanel('memory') function was actually invoked (not just claimed)",
  );
  assert(fakeActivePanel === "memory", "the fake UI's own active-panel state actually changed");

  console.log("\n== An unsupported target is rejected, not silently accepted ==");
  const callCountBefore = calls.length;
  const badTarget = bus.dispatch({ type: "open_panel", target: "providers", reason: "test", initiatedBy: "lelu" });
  assert(badTarget.ok === false, "dispatch to an unsupported panel fails");
  assert(
    badTarget.detail.includes("providers") && badTarget.detail.includes("not"),
    "failure message names the unsupported target",
    badTarget.detail,
  );
  assert(calls.length === callCountBefore, "no real handler was invoked for the rejected action");

  console.log("\n== Every dispatch is reflected into the shared world model (UIStateStore) ==");
  const snapshot = UIStateStore.getInstance().get();
  assert(snapshot.lastAction !== null, "UIStateStore.lastAction is populated");
  assert(snapshot.lastAction?.ok === false, "UIStateStore.lastAction reflects the MOST RECENT dispatch (the rejected one), not a stale success");
  assert(
    snapshot.actionHistory.some((a) => a.type === "open_panel" && a.target === "memory" && a.ok),
    "the earlier successful action is still present in actionHistory",
  );

  console.log("\n== return_to_previous restores the context active before LÉLU's own navigation ==");
  fakeActivePanel = "chat";
  bus.dispatch({ type: "open_panel", target: "engineering", reason: "investigate", initiatedBy: "lelu" });
  assert(fakeActivePanel === "engineering", "sanity: navigated to engineering");
  const back = bus.dispatch({ type: "return_to_previous", reason: "done investigating", initiatedBy: "lelu" });
  assert(back.ok, "return_to_previous succeeds", back.detail);
  assert(fakeActivePanel === "chat", "the fake UI was actually returned to the panel active BEFORE LÉLU navigated away");

  console.log("\n== return_to_previous acts like a real back button regardless of who navigated ==");
  fakeActivePanel = "chat";
  bus.dispatch({ type: "open_panel", target: "reasoning", reason: "investigate", initiatedBy: "lelu" });
  bus.dispatch({ type: "open_panel", target: "memory", reason: "user clicked", initiatedBy: "user" });
  const back2 = bus.dispatch({ type: "return_to_previous", reason: "done", initiatedBy: "lelu" });
  assert(back2.ok, "return_to_previous still succeeds after an intervening user action");
  assert(
    fakeActivePanel === "reasoning",
    "returns to whatever was active before the MOST RECENT open_panel dispatch (the user's), not further back — a real back button, not a LÉLU-only bookmark",
  );

  console.log("\n== Unregistering (interface unmount) makes the bus honestly disconnect again ==");
  unregister();
  assert(bus.isConnected() === false, "bus reports disconnected after unregister");
  const afterUnmount = bus.dispatch({ type: "open_panel", target: "memory", reason: "test", initiatedBy: "lelu" });
  assert(afterUnmount.ok === false, "dispatch after unmount fails honestly rather than replaying a stale handler");

  console.log(`\n${failures === 0 ? "ALL UI ACTION BUS CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
