import { pipeline, env } from "@huggingface/transformers";
import { readFileSync } from "node:fs";
const AUDIO = new Float32Array(readFileSync("jfk.f32").buffer.slice(0));
env.cacheDir = "./models";
const rss = () => Math.round(process.memoryUsage().rss / 1048576);
const time = async (label, fn) => { const t = performance.now(); const r = await fn(); console.log(`${label}: ${Math.round(performance.now() - t)} ms (rss ${rss()} MB)`); return r; };
const out = {};
// 1. embeddings
const emb = await time("embeddings load (MiniLM-L6 q8)", () => pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" }));
await time("embeddings 1st (8 sentences)", () => emb(["coral reef bleaching", "ocean warming kills coral", "a recipe for bread", "GPU rendering", "reef restoration", "sourdough starter", "WebGPU shaders", "marine heatwaves"], { pooling: "mean", normalize: true }));
await time("embeddings warm (8 sentences)", () => emb(["coral reef bleaching", "ocean warming kills coral", "a recipe for bread", "GPU rendering", "reef restoration", "sourdough starter", "WebGPU shaders", "marine heatwaves"], { pooling: "mean", normalize: true }));
// 2. speech
const asr = await time("whisper-tiny.en load (q8)", () => pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny.en", { dtype: "q8" }));
const r = await time("whisper-tiny.en transcribe jfk.wav (11 s audio)", () => asr(AUDIO));
console.log("  →", r.text);
// 3. small LM
const gen = await time("SmolLM2-135M-Instruct load (q4)", () => pipeline("text-generation", "HuggingFaceTB/SmolLM2-135M-Instruct", { dtype: "q4" }));
const g = await time("SmolLM2-135M 48 new tokens", () => gen([{ role: "user", content: "Give three title ideas for a short film about ocean tides." }], { max_new_tokens: 48, do_sample: false }));
console.log("  →", JSON.stringify(g[0].generated_text.at(-1).content).slice(0, 300));
