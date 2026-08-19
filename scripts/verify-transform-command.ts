/**
 * Verification: LÉLU can drive the ONE Core's transformation through the
 * workspace orchestration ("transform the core to plasma", "morph the core
 * into ocean", "let the core evolve", …).
 *
 * Run: bunx tsx --tsconfig tsconfig.app.json scripts/verify-transform-command.ts
 */
import { parseWorkspaceCommand } from "../src/core/router/WorkspaceResolver";

interface Expect {
  morphology: string | null;
  system?: string;
}

const cases: Array<[string, Expect]> = [
  ["transform the core to plasma", { morphology: "PLASMA" }],
  ["morph the core into ocean", { morphology: "OCEAN" }],
  ["turn the genesis core into electric", { morphology: "ELECTRIC" }],
  ["shift the core toward hybrid", { morphology: "HYBRID" }],
  ["morph the core to nerve", { morphology: null, system: "nerve" }],
  ["transform the core to matrix", { morphology: null, system: "matrix" }],
  ["let the core evolve", { morphology: null }],
  ["release the transformation", { morphology: null }],
];

let failures = 0;
for (const [input, expect] of cases) {
  const cmd = parseWorkspaceCommand(input);
  const got =
    cmd.action === "transform_core"
      ? { morphology: cmd.morphology ?? null, system: cmd.system }
      : { morphology: null, system: undefined };
  const ok =
    cmd.action === "transform_core" &&
    got.morphology === expect.morphology &&
    (got.system ?? undefined) === (expect.system ?? undefined);
  console.log(
    `${ok ? "  ✓" : "  ✗"} "${input}" → ${cmd.action}${
      cmd.action === "transform_core"
        ? ` · morphology=${got.morphology ?? "null"}${got.system ? ` · system=${got.system}` : ""}`
        : ""
    }`,
  );
  if (!ok) failures += 1;
}

console.log("------------------------------------------------------------");
console.log(failures === 0 ? "PASS: transform_core command parsing" : `FAIL: ${failures} case(s)`);
process.exit(failures === 0 ? 0 : 1);
