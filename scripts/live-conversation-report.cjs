#!/usr/bin/env node
/**
 * LÉLU live conversation — read a run of verify-live-conversation.cjs.
 *
 *   node scripts/live-conversation-report.cjs <run.json> [...]
 *
 * Per turn, from the run's own records (nothing estimated):
 *   spoken      when the test speaker's words ended in the capture file
 *               (scenario timeline + the moment the page opened the device)
 *   vadEnd      the page's voice detector closed the utterance
 *   transcript  the transcriber answered (/api/model/groq/audio/transcriptions)
 *   userMsg     the transcript appeared in the thread
 *   firstText   her written reply appeared in the thread
 *   firstAudio  her voice started playing (the media element's "playing")
 *   ttsEngine   X-Lelu-Engine of every sentence of the reply
 *   played      sentences whose audio reached "ended" (played through), of those requested
 * Times are seconds after the single microphone tap. Page-observed times carry
 * the harness's 200 ms polling and the page's own lag on its CPU core.
 */
const fs = require("node:fs");

function analyse(file) {
  const run = JSON.parse(fs.readFileSync(file, "utf8"));
  const tl = run.timeline;
  const trackAt = run.tracks.find((t) => t.kind === "audio")?.at ?? null;
  const items = (run.scenario?.timeline ?? []).filter((i) => !/^(sil|noise|clicks):/.test(i.item));
  const vadEnds = tl.filter((e) => e.kind === "console" && /"spoke":true/.test(e.text ?? "")).map((e) => e.t);
  const sttDone = tl.filter((e) => e.kind === "response" && /audio\/transcriptions/.test(e.url)).map((e) => e.t);
  const userMsgs = run.messages.filter((m) => m.role === "user");
  const herMsgs = run.messages.filter((m) => m.role === "assistant");
  const ttsReq = tl.filter((e) => e.kind === "request" && /\/api\/voice\/tts/.test(e.url));
  const ttsRes = tl.filter((e) => (e.kind === "response" || e.kind === "request-failed") && /\/api\/voice\/tts/.test(e.url));
  const playing = run.media.filter((m) => m.event === "playing");
  const ended = run.media.filter((m) => m.event === "ended");
  const turns = userMsgs.map((u, i) => {
    const next = userMsgs[i + 1]?.firstSeen ?? Infinity;
    const reply = herMsgs.find((m) => m.firstSeen >= u.firstSeen && m.firstSeen < next) ?? null;
    const spokenEnd = items[i] && trackAt !== null ? +(trackAt + items[i].at + items[i].seconds).toFixed(2) : null;
    const vadEnd = vadEnds.find((t) => spokenEnd === null || t >= spokenEnd - 0.5) ?? null;
    const transcript = sttDone.find((t) => vadEnd === null || t >= vadEnd) ?? null;
    const window = (t) => t >= u.firstSeen && t < next;
    const requests = ttsReq.filter((r) => window(r.t));
    const responses = ttsRes.filter((r) => window(r.t));
    const firstAudio = playing.find((p) => window(p.t))?.t ?? null;
    const endedHere = ended.filter((p) => window(p.t)).length;
    return {
      heard: u.text,
      reply: reply?.text ?? null,
      spokenEnd,
      vadEnd,
      transcript,
      userMsg: u.firstSeen,
      firstText: reply?.firstSeen ?? null,
      firstAudio,
      speechEndToTranscriptS: spokenEnd !== null && transcript !== null ? +(transcript - spokenEnd).toFixed(2) : null,
      transcriptToFirstTextS: transcript !== null && reply ? +(reply.firstSeen - transcript).toFixed(2) : null,
      transcriptToFirstAudioS: transcript !== null && firstAudio !== null ? +(firstAudio - transcript).toFixed(2) : null,
      speechEndToFirstAudioS: spokenEnd !== null && firstAudio !== null ? +(firstAudio - spokenEnd).toFixed(2) : null,
      textBeforeAudio: reply && firstAudio !== null ? reply.firstSeen <= firstAudio : null,
      sentencesRequested: requests.length,
      sentencesPlayedThrough: endedHere,
      ttsEngines: [...new Set(responses.map((r) => r.headers?.["x-lelu-engine"] ?? (r.kind === "request-failed" ? `failed:${r.error}` : `HTTP ${r.status}`)))],
      ttsVoice: [...new Set(responses.map((r) => r.headers?.["x-lelu-voice-provider"]).filter(Boolean))],
      ttsSynthesisMs: responses.map((r) => Number(r.headers?.["x-lelu-synthesis-ms"] ?? NaN)).filter(Number.isFinite),
      spokenText: requests.map((r) => r.text),
    };
  });
  const res = run.resources ?? [];
  const peak = (key) => Math.max(0, ...res.map((r) => r[key] ?? 0));
  const avg = (key) => {
    const v = res.map((r) => r[key]).filter((x) => typeof x === "number");
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const d = run.voice?.diagnostics ?? {};
  return {
    label: run.label,
    input: run.input,
    viewport: run.viewport,
    microphoneTaps: run.microphoneTaps,
    turns,
    session: {
      userMessages: userMsgs.length,
      herMessages: herMsgs.length,
      bargeIns: d.bargeIns,
      holds: d.holds,
      holdsResumed: d.holdsResumed,
      lastHold: d.lastHold,
      lastInterruption: d.lastInterruption,
      staleStreamsDropped: d.staleStreamsDropped,
      speechOutcome: d.speechOutcome,
      captureRecoveries: d.captureRecoveries,
      captureLosses: d.captureLosses,
      tracksAfterEnd: run.tracks.map((t) => t.readyState ?? t.error),
      turnOutcomes: (run.voice?.turns ?? []).map((t) => t.outcome),
    },
    resources: {
      voxcpm2CpuPctAvg: avg("voxcpm2Cpu"),
      voxcpm2CpuPctPeak: peak("voxcpm2Cpu"),
      voxcpm2RssMiBPeak: peak("voxcpm2RssMiB"),
      serverCpuPctAvg: avg("serverCpu"),
      serverRssMiBPeak: peak("serverRssMiB"),
      chromiumCpuPctAvg: avg("chromiumCpu"),
      chromiumRssMiBPeak: peak("chromiumRssMiB"),
    },
  };
}

const reports = process.argv.slice(2).map(analyse);
console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 1));
