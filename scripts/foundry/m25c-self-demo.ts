/**
 * LÉLU — proof that she reads her own change history and runs her own playbook.
 * Boots the real /api/self server, makes exactly the requests her self.* tools make,
 * and writes every response to artifacts/foundry/m25c/self/.
 */
import http from "node:http";
import { writeFileSync } from "node:fs";
import { createSelfJournalApi } from "../../plugins/selfJournalApi.ts";

process.env.LELU_ENGINEER_TOKEN ||= "demo-local-token";
const api = createSelfJournalApi();
const server = http.createServer((req, res) => void api.handle(req as never, res as never, () => { res.statusCode = 404; res.end(); }));
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const out = (name: string, v: unknown) => writeFileSync(`artifacts/foundry/m25c/self/${name}.json`, JSON.stringify(v, null, 1));
const steps = (process.argv[2] ?? "coat,coat-bag,register").split(",");

const changes = await (await fetch(`${base}/api/self/changes?limit=12`)).json();
out("changes", changes);
const playbook = await (await fetch(`${base}/api/self/playbooks/rebuild-looks`)).json();
out("playbook-rebuild-looks", playbook);
const refused = await (await fetch(`${base}/api/self/playbooks/new-look-from-photos/run`, { method: "POST", headers: { "x-lelu-token": process.env.LELU_ENGINEER_TOKEN!, "content-type": "application/json" }, body: JSON.stringify({ params: { look: "x", photo: "x", dir: "x", views: "left" } }) })).json();
out("spend-refused", refused);
const started = await (await fetch(`${base}/api/self/playbooks/rebuild-looks/run`, { method: "POST", headers: { "x-lelu-token": process.env.LELU_ENGINEER_TOKEN!, "content-type": "application/json" }, body: JSON.stringify({ steps }) })).json();
console.log("started", started.run?.id, started.run?.status);
let run;
for (;;) {
  run = (await (await fetch(`${base}/api/self/runs/${started.run.id}`)).json()).run;
  if (run.status !== "running") break;
  await new Promise((r) => setTimeout(r, 5000));
}
out("run-rebuild-looks", run);
console.log(run.status, run.steps.map((s: { id: string; status: string; seconds?: number }) => `${s.id}:${s.status}:${s.seconds ?? 0}s`).join(" "));
console.log("refused spend:", refused.error);
server.close();
