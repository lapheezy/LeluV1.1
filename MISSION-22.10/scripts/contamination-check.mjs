/**
 * M22.10 item 7 — interrupted turns must not contaminate later turns.
 * For every sentence sent to the speaker, find the assistant reply it came
 * from (best word overlap, words of 4+ letters, numerals ignored because the
 * speaker spells them out) and flag it when that reply belongs to an EARLIER
 * turn than the one whose transcript preceded the request.
 * Usage: node MISSION-22.10/scripts/contamination-check.mjs MISSION-22.10/logs/e2e-desktop.json
 */
import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync(process.argv[2], "utf8"));
const words = (x) => new Set(x.toLowerCase().normalize("NFD").replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length >= 4));
const replies = r.conversationAfter.messages.filter((m) => m.role === "assistant").map((m) => words(m.text));
const turnStarts = r.stt.filter((s) => s.ok && s.text).map((s) => s.done);
const typedAt = r.events.find((e) => e.kind === "typed-sent")?.t ?? Infinity;
let checked = 0, contaminated = 0, unattributed = 0;
const rows = [];
for (const x of r.tts) {
  if (!x.text) continue;
  let turn = turnStarts.filter((t) => t <= x.t).length - 1;
  if (x.t >= typedAt) turn = turnStarts.length; // the typed turn
  if (turn < 0) continue;
  const w = words(x.text);
  if (w.size === 0) continue;
  checked += 1;
  let best = -1, score = 0;
  replies.forEach((rep, i) => { const s = [...w].filter((k) => rep.has(k)).length / w.size; if (s > score) { score = s; best = i; } });
  if (score < 0.5) { unattributed += 1; rows.push({ atS: x.atS, turn, best, score: +score.toFixed(2), text: x.text.slice(0, 70) }); continue; }
  if (best < turn) { contaminated += 1; rows.push({ atS: x.atS, turn, from: best, text: x.text.slice(0, 70) }); }
}
console.log(JSON.stringify({ file: process.argv[2], spokenSentences: checked, fromAnEarlierTurn: contaminated, unattributed, rows, staleStreamsDropped: r.session.diagnosticsAfterEnd?.staleStreamsDropped }, null, 2));
