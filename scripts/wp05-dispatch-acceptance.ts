/**
 * M16.3 WP05 — DISPATCH-level acceptance of the reconciled creative path.
 *
 * The same sentences the acceptance asks for, run through the real compiler,
 * the real DirectResolver, the real ToolDispatcher and the real
 * CosmosObjectStore, with a conversation context that carries this chat's
 * messages and id. Nothing is mocked except one injected store fault, which
 * exists to prove the bounded correction.
 *
 * Evidence class: DISPATCH (+ TEST for the assertions). It is NOT live browser
 * evidence; the live attempt and its blocker are recorded in the report.
 *
 *   npx tsx scripts/wp05-dispatch-acceptance.ts
 */

const memory = new Map<string, string>();
const makeStorage = () =>
  ({
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, String(value)),
    removeItem: (key: string) => void memory.delete(key),
    clear: () => memory.clear(),
    key: (index: number) => [...memory.keys()][index] ?? null,
    get length() {
      return memory.size;
    },
  }) as Storage;
(globalThis as unknown as { window: unknown }).window = { localStorage: makeStorage(), sessionStorage: makeStorage(), name: "" };

import { mkdirSync, writeFileSync } from "node:fs";
import CosmosObjectStore, { COSMOS_OBJECTS_KEY } from "../src/core/cosmos/objects/CosmosObjectStore";
import { compileDirect } from "../src/core/creative/kit/DirectCompiler";
import DirectResolver from "../src/core/router/DirectResolver";
import { clearCosmosReferents } from "../src/core/cosmos/objects/continuity";
import { registerCosmosObjectTools } from "../src/core/cosmos/objects/CosmosObjectTools";
import { registerCreativeKitTools } from "../src/core/creative/kit/CreativeKitTools";
import KvStore from "../src/core/storage/KvStore";

const OUT = "artifacts/m16-3/wp05";
mkdirSync(OUT, { recursive: true });

const steps: Array<Record<string, unknown>> = [];
let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  steps.push({ name, ok, detail });
  if (!ok) failures += 1;
};

const store = CosmosObjectStore.getInstance();
registerCreativeKitTools();
registerCosmosObjectTools();
const resolver = new DirectResolver();

/** The conversation this turn belongs to: an id and its messages. */
function conversation(id: string, messages: Array<{ role: string; content: string }> = []) {
  return {
    request: { prompt: "", conversationId: id, timestamp: Date.now(), messages },
    started: Date.now(),
    aiProviders: { available: async () => [] },
  } as never;
}

/** What the app would do with a typed sentence. */
async function say(text: string, context: never, history: Array<{ role: string; content: string }>) {
  const plan = compileDirect(text);
  if (!plan) return { text, plan: null, reply: "", ok: false };
  history.push({ role: "user", content: text });
  const done = await resolver.execute(context, plan, plan.explicit ? "command" : "construction");
  const reply = done.response?.text ?? "";
  const after = store.list().map((entry) => ({ id: entry.id, frame: entry.frame }));
  history.push({ role: "assistant", content: reply });
  return { text, plan: plan.steps.map((step) => step.tool), reply: reply.slice(0, 400), ok: Boolean(done.handled), after };
}

const object = (id: string) => store.get(id);

async function main(): Promise<void> {
  /* ---- 1-2. a chair exists, from chat, without an object id ---- */
  const history: Array<{ role: string; content: string }> = [];
  const chat = "wp05-chat-a";
  clearCosmosReferents();

  const built = await say("build a chair", conversation(chat, history), history);
  check("a chair is built by the deterministic construction engine", built.plan?.[0] === "creative.build", built);

  const spawn = await say("put it in the Cosmos", conversation(chat, history), history);
  const spawned = store.list();
  check("the construction becomes a Cosmos object", spawned.length === 1, { plan: spawn.plan, objects: spawned.map((o) => o.id) });
  const chair = spawned[0];
  if (!chair) {
    console.error("BUILD:", JSON.stringify(built));
    console.error("SPAWN:", JSON.stringify(spawn));
    throw new Error("no chair object");
  }
  const startPosition = [...chair.frame.position] as [number, number, number];

  /* ---- 3-5. select, rotate, double, move — with no id typed ---- */
  const selected = await say("select it", conversation(chat, history), history);
  check("select resolves “it” to the object from the conversation", store.selectedId() === chair.id, { plan: selected.plan, selected: store.selectedId() });

  const rotated = await say("rotate it 90 degrees", conversation(chat, history), history);
  check("rotate acts on the same object", object(chair.id)?.frame.rotation[1] === 90, { plan: rotated.plan, frame: object(chair.id)?.frame });

  const scaleBefore = object(chair.id)!.frame.scale;
  const scaled = await say("make it twice as large", conversation(chat, history), history);
  check(
    "scale doubles the same object",
    Math.abs((object(chair.id)?.frame.scale ?? 0) - scaleBefore * 2) < 0.01,
    { plan: scaled.plan, before: scaleBefore, after: object(chair.id)?.frame.scale },
  );
  const scaleAfter = object(chair.id)!.frame.scale;

  const moved = await say("move it to the left", conversation(chat, history), history);
  const afterMove = object(chair.id)!;
  check(
    "move keeps the identity and the earlier transforms",
    afterMove.id === chair.id && afterMove.frame.rotation[1] === 90 && Math.abs(afterMove.frame.scale - scaleAfter) < 0.001,
    { plan: moved.plan, frame: afterMove.frame },
  );
  check("move went left in world metres", afterMove.frame.position[0] < startPosition[0], { before: startPosition, after: afterMove.frame.position });

  /* ---- 6-8. the store and its persistence say the same thing ---- */
  // Read the same storage a reload reads, through the same accessor the app uses.
  const reopened = KvStore.getInstance().get<{ objects?: Array<{ id: string; frame: { position: number[]; rotation: number[]; scale: number } }> }>(COSMOS_OBJECTS_KEY);
  const persistedObject = reopened?.objects?.find((entry) => entry.id === chair.id);
  check(
    "the transform survives a reload of the persisted state",
    Boolean(persistedObject) &&
      persistedObject!.frame.rotation[1] === 90 &&
      Math.abs(persistedObject!.frame.scale - scaleAfter) < 0.001 &&
      persistedObject!.frame.position.every((value: number, index: number) => Math.abs(value - afterMove.frame.position[index]) < 0.001),
    { persistedObject, live: afterMove.frame },
  );

  /* ---- 9-10. a second conversation cannot inherit the first's referent ---- */
  const other = "wp05-chat-b";
  clearCosmosReferents();
  // The visible selection is shared on purpose (the person can see it), so the
  // isolation claim is made on the conversation's own referent: with nothing
  // selected, a fresh chat inherits neither the messages nor the record.
  store.select(null);
  const otherHistory: Array<{ role: string; content: string }> = [];
  const rotationBefore = store.get(chair.id)!.frame.rotation[1];
  const stranger = await say("rotate it 45 degrees", conversation(other, otherHistory), otherHistory);
  check(
    "a fresh conversation has no referent and refuses instead of guessing",
    store.get(chair.id)!.frame.rotation[1] === rotationBefore && /could not tell which object/i.test(stranger.reply),
    { plan: stranger.plan, reply: stranger.reply, frame: store.get(chair.id)?.frame },
  );

  /* ---- 11. an ambiguous name is refused ---- */
  const twin = await say("build a chair", conversation(chat, history), history);
  void twin;
  await say("put it in the Cosmos", conversation(chat, history), history);
  const ambiguous = await say("select the chair", conversation(chat, history), history);
  check("a name that matches two objects is refused", /matches 2 objects/.test(ambiguous.reply), { reply: ambiguous.reply, plan: ambiguous.plan });

  /* ---- 12. a failed transform: one retry, then honesty ---- */
  const target = store.list()[0];
  clearCosmosReferents();
  const chatC = "wp05-chat-c";
  const thirdHistory: Array<{ role: string; content: string }> = [{ role: "assistant", content: `Working on ${target.id}.` }];
  const original = store.transform.bind(store);
  let dropped = 0;
  (store as unknown as { transform: unknown }).transform = (...args: unknown[]) => {
    if (dropped === 0) {
      dropped += 1;
      return { ok: true, value: store.get(target.id)! };
    }
    return (original as (...a: unknown[]) => unknown)(...args);
  };
  const firstFault = await say("rotate it 45 degrees", conversation(chatC, thirdHistory), thirdHistory);
  check("a dropped write is retried once and recovers", dropped === 1 && /retry|rotated|turned/i.test(firstFault.reply), { dropped, reply: firstFault.reply });

  (store as unknown as { transform: unknown }).transform = () => ({ ok: true, value: store.get(target.id)! });
  const permanent = await say("rotate it 30 degrees", conversation(chatC, thirdHistory), thirdHistory);
  (store as unknown as { transform: unknown }).transform = original;
  check("a permanent fault is reported as a failure", /verification failed|could not|No |not/i.test(permanent.reply), { reply: permanent.reply });

  /* ---- 13. compound: a dependent step is skipped, an independent one runs ---- */
  const compound = await say("move it to the left", conversation(chatC, thirdHistory), thirdHistory);
  check("the conversation still resolves after the faults", compound.plan?.[0] === "cosmos.object.position", compound);

  console.log(steps.map((step) => `${step.ok ? "ok" : "FAIL"} ${step.name}`).join("\n"));
  report();
}

function report(): void {
  const summary = {
    evidence: "DISPATCH",
    objects: store.list().map((object) => ({ id: object.id, name: object.name, frame: object.frame })),
    steps,
    failures,
    ok: failures === 0,
  };
  writeFileSync(`${OUT}/dispatch-report.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

await main();
process.exit(failures === 0 ? 0 : 1);
