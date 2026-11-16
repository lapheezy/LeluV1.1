/**
 * ==========================================================
 * VERIFY — LÉLU OPERATES THE COSMOS THROUGH HER TOOL PIPELINE
 *
 * Not a test of WorkspaceAPI directly. This drives the REAL path a
 * model's tool call takes:
 *
 *   ToolRegistry → ToolDispatcher.dispatchToolCall
 *     → AutonomyGate permission check
 *     → cosmos.workspace executor
 *     → WorkspaceAPI (CosmosAutonomy policy)
 *     → ApprovalGate (single-use) → the real stores
 *
 * Run: bunx tsx --tsconfig tsconfig.test.json scripts/verify-cosmos.ts
 * ==========================================================
 */

const memory = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, String(value));
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
  clear: () => memory.clear(),
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size;
  },
};

import { registerCosmosTools } from "../src/core/cosmos/CosmosTools";
import { toolSchemaDiagnostics, toolSchemasForModel } from "../src/core/tools/ToolSchemas";
import { dispatchToolCall, toolNameForModel } from "../src/core/tools/ToolDispatcher";
import ApprovalGate from "../src/core/agentic/ApprovalGate";
import CosmosNavigation from "../src/core/cosmos/CosmosNavigation";
import { syncCosmosMap } from "../src/core/cosmos/CosmosLiveMap";

const line = (label: string, value: string | number | boolean) => console.log(`  ${label.padEnd(34)} ${value}`);

async function main(): Promise<void> {
  console.log("\n=== 1. Registered, executable, and OFFERED to the model ===");
  registerCosmosTools();
  const diagnosed = toolSchemaDiagnostics().filter((entry) => entry.id.startsWith("cosmos."));
  for (const entry of diagnosed) {
    line(entry.id, `registered=${entry.registered} available=${entry.available} permitted=${entry.permitted} offered=${entry.offered}`);
  }
  const offered = toolSchemasForModel().filter((schema) => schema.name.startsWith("cosmos_"));
  for (const schema of offered) {
    line(`${schema.name} parameters`, `${Object.keys((schema.parameters.properties ?? {}) as Record<string, unknown>).join(", ")}`);
  }

  console.log("\n=== 2. Live map synchronised from the runtime ===");
  const synced = await syncCosmosMap();
  line("sync", `ok=${synced.ok} destinations=${synced.destinations} retired=${synced.retired}`);
  const mapped = await dispatchToolCall(
    { id: "verify-1", name: toolNameForModel("cosmos.map"), arguments: { sync: false } },
    "verify-cosmos",
  );
  console.log(mapped.content.split("\n").map((text) => `  ${text}`).join("\n"));

  console.log("\n=== 3. A green action runs immediately ===");
  const navigated = await dispatchToolCall(
    { id: "verify-2", name: toolNameForModel("cosmos.workspace"), arguments: { action: "navigate", roomId: "cosmos-core" } },
    "verify-cosmos",
  );
  line("navigate → ok", navigated.ok);
  line("navigate → content", navigated.content);

  console.log("\n=== 4. A yellow action stops and asks, then runs once approved ===");
  const asked = await dispatchToolCall(
    {
      id: "verify-3",
      name: toolNameForModel("cosmos.workspace"),
      arguments: { action: "create-room", room: { label: "Observatory" } },
    },
    "verify-cosmos",
  );
  const approvalId = (asked.data as { approvalId?: string } | undefined)?.approvalId;
  line("first attempt ok (must be false)", asked.ok);
  line("approval requested", approvalId ? approvalId.slice(0, 18) : "none");
  line("room exists before approval", CosmosNavigation.getInstance().rooms().some((room) => room.label === "Observatory"));

  if (approvalId) {
    ApprovalGate.getInstance().decide(approvalId, "approved");
    const approved = await dispatchToolCall(
      {
        id: "verify-4",
        name: toolNameForModel("cosmos.workspace"),
        arguments: { action: "create-room", room: { label: "Observatory" }, approvalId },
      },
      "verify-cosmos",
    );
    line("after approval ok", approved.ok);
    line("approval spent (replay ok)", (await dispatchToolCall(
      {
        id: "verify-5",
        name: toolNameForModel("cosmos.workspace"),
        arguments: { action: "create-room", room: { label: "Observatory" }, approvalId },
      },
      "verify-cosmos",
    )).ok);
    line("room exists now", CosmosNavigation.getInstance().rooms().some((room) => room.label === "Observatory"));
  }

  console.log("\n=== 5. A protected action is not a tool at all ===");
  const red = await dispatchToolCall(
    { id: "verify-6", name: toolNameForModel("cosmos.workspace"), arguments: { action: "deploy" } },
    "verify-cosmos",
  );
  line("deploy → ok", red.ok);
  line("deploy → content", red.content.slice(0, 120));

  console.log("\n=== 6. The map after the session ===");
  const after = await dispatchToolCall(
    { id: "verify-7", name: toolNameForModel("cosmos.map"), arguments: { sync: false } },
    "verify-cosmos",
  );
  console.log(after.content.split("\n").map((text) => `  ${text}`).join("\n"));
}

// The subsystems these tools reach keep timers alive; the checks are done.
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
