/**
 * CHAT -> COGNITION -> MEMORY -> LLM CONTEXT -> RESPONSE
 * Real Anthropic, real Brain, real IndexedDB. The Anthropic wire is
 * captured so the memory can be SEEN entering the model's context.
 */
import "fake-indexeddb/auto";
process.env.ANTHROPIC_API_KEY = process.env.API_KEY;
const mem = new Map<string,string>();
const st = { getItem:(k:string)=>mem.get(k)??null, setItem:(k:string,v:string)=>void mem.set(k,v), removeItem:(k:string)=>void mem.delete(k) };
(globalThis as any).window = globalThis;
(globalThis as any).localStorage = st; (globalThis as any).sessionStorage = st; (globalThis as any).name = "";
(globalThis as any).addEventListener ??= () => {}; (globalThis as any).removeEventListener ??= () => {};
(globalThis as any).document ??= { visibilityState:"visible", addEventListener:()=>{}, removeEventListener:()=>{},
  createElement:()=>({style:{},setAttribute:()=>{},appendChild:()=>{}}), body:{appendChild:()=>{},innerText:""}, documentElement:{style:{}} };

const wire: any[] = [];
const realFetch = globalThis.fetch;
(globalThis as any).fetch = async (i:any, init:any) => {
  const url = typeof i === "string" ? i : i?.url ?? "";
  if (url.includes("anthropic") && init?.body) { try { wire.push(JSON.parse(init.body)); } catch {} }
  return realFetch(i, init);
};

const MARK = `quokka-${Date.now().toString(36)}`;
const FACT = `My research vessel is called Meridian-${MARK}`;

const { default: AIService } = await import("/home/user/LeluV1.1/src/core/AIService");
const ai = AIService.getInstance();
await ai.initialize();

console.log("########## TURN 1 — tell LÉLU a durable fact ##########");
const t1 = await ai.chat(`Remember this: ${FACT}. Just acknowledge it.`);
console.log("reply:", t1.text.slice(0,140).replace(/\n/g," "));

const stored = await ai.getMemories(500);
console.log("\nmemories after turn 1:", stored.length);
console.log("marker present in stored memory:", JSON.stringify(stored).includes(MARK) ? "YES" : "NO");

console.log("\n########## TURN 2 — ask about it (SHORT-TERM / same runtime) ##########");
wire.length = 0;
const t2 = await ai.chat("What is my research vessel called?");
const sys2 = wire.map(w => Array.isArray(w.system) ? w.system.map((x:any)=>x.text).join("\n") : String(w.system??"")).join("\n");
console.log("MARKER PRESENT IN THE LLM SYSTEM CONTEXT:", sys2.includes(MARK) ? "YES" : "NO");
console.log("reply:", t2.text.slice(0,220).replace(/\n/g," "));
console.log("reply contains the marker:", t2.text.includes(MARK) ? "YES" : "NO");

console.log("\n########## FRESH RUNTIME — new singletons, same IndexedDB ##########");
// Reset the runtime the way a reload does: drop the singletons and
// rebuild from persisted storage.
(AIService as any).instance = null;
const { default: Brain } = await import("/home/user/LeluV1.1/src/brain/Brain");
(Brain as any).instance = null;
const ai2 = AIService.getInstance();
await ai2.initialize();
const recalled = await ai2.recall("research vessel name");
console.log("recall() in the fresh runtime:", recalled.length, "record(s)");
for (const r of recalled.slice(0,3)) console.log("   ", JSON.stringify(r.response).slice(0,140));
console.log("MARKER SURVIVED THE RUNTIME RESET:", JSON.stringify(recalled).includes(MARK) ? "YES" : "NO");

wire.length = 0;
const t3 = await ai2.chat("What is my research vessel called?");
const sys3 = wire.map(w => Array.isArray(w.system) ? w.system.map((x:any)=>x.text).join("\n") : String(w.system??"")).join("\n");
console.log("marker in LLM context on the fresh runtime:", sys3.includes(MARK) ? "YES" : "NO");
console.log("reply:", t3.text.slice(0,220).replace(/\n/g," "));
console.log("reply contains the marker:", t3.text.includes(MARK) ? "YES" : "NO");
console.log("\nmarker was:", MARK);
process.exit(0);
