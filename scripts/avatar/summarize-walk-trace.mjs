/**
 * M15.3 WP03: summarise a world-walk lifecycle trace written by
 * verify-avatar-presence.mjs (actions section): per walk command, the
 * timestamps from submission to resolution, start/goal/final positions,
 * the measured final distance, route, replans, obstacles and frame rate.
 * Usage: node scripts/avatar/summarize-walk-trace.mjs <trace.json> [...]
 */
import fs from "node:fs";
for (const file of process.argv.slice(2)) {
  const t = JSON.parse(fs.readFileSync(file, "utf8"));
  const t0 = t.find((e) => e.ev === "enter-world-clicked")?.t ?? t[0]?.t ?? 0;
  const s = (e) => ((e.t - t0) / 1000).toFixed(1);
  const firstSpatial = t.find((e) => e.ev === "spatial");
  const loadDone = t.filter((e) => e.ev === "world-load-done").pop();
  console.log(`\n== ${file}\nworld: first presence telemetry +${firstSpatial ? s(firstSpatial) : "?"} s; world load done +${loadDone ? s(loadDone) : "?"} s`);
  for (const issued of t.filter((e) => e.ev === "command-issued")) {
    const delivered = t.find((e) => e.ev === "command-delivered" && e.t >= issued.t);
    const id = delivered?.id;
    const end = t.find((e) => (e.ev === "command-resolved" || e.ev === "command-rejected") && e.t >= issued.t && e.label === issued.label);
    const sp = t.filter((e) => e.ev === "spatial" && e.t >= issued.t && e.goal?.id === id);
    const before = t.filter((e) => e.ev === "spatial" && e.t <= issued.t).pop();
    const last = sp[sp.length - 1];
    const fps = t.filter((e) => e.ev === "page-fps" && e.t >= issued.t && (!end || e.t <= end.t)).map((e) => e.fps);
    const pf = fps.length ? `${Math.min(...fps)}–${Math.max(...fps)} page fps` : "";
    console.log(`- "${issued.label}" (${issued.kind}${issued.target ? " → " + issued.target.place : ""}, deadline ${issued.timeout ?? "default"} ms) issued +${s(issued)} s`);
    if (before) console.log(`    start ${JSON.stringify(before.position)}; universe/budget at issue: ${JSON.stringify(t.filter((e) => (e.ev === "universe" || e.ev === "render-budget") && e.t <= issued.t + 300).slice(-2).map((e) => e.open ?? e.mode))}`);
    if (sp.length) {
      const first = sp[0];
      console.log(`    goal ${JSON.stringify(first.goal.point)} (${first.goal.place}); route ${JSON.stringify(first.goal.route)}; window obstacles ${JSON.stringify((first.windows ?? []).map((w) => [w.id.split(":").slice(0, 2).join(":"), +w.x.toFixed(2), +w.z.toFixed(2), +w.radius.toFixed(2)]))}`);
      console.log(`    last telemetry +${s(last)} s: at ${JSON.stringify(last.position)}, outcome ${last.goal.outcome}, remaining ${last.goal.remaining} m, replans ${last.goal.replans}, walking ${last.walking}`);
    }
    console.log(`    ${end ? `${end.ev.replace("command-", "")} +${s(end)} s (${((end.t - issued.t) / 1000).toFixed(1)} s after issue): ${(end.observation ?? end.reason).slice(0, 170)}` : "NO RESOLUTION"} ${pf}`);
  }
}
