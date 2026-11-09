import fs from "node:fs";
const BASE = process.env.BASE || "http://127.0.0.1:3013";
const post = async (body) => {
  const res = await fetch(`${BASE}/api/acquisition`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const id = (r) => r.body?.acquisition?.id ?? r.body?.record?.id ?? r.body?.id ?? null;
const out = { at: new Date().toISOString(), base: BASE, steps: [] };
const a = await post({ action: "clone", url: "https://github.com/typesense/typesense.git", ref: "" });
out.steps.push({ spelling: "https://github.com/typesense/typesense.git", id: id(a), ok: a.body?.ok ?? false, commit: a.body?.acquisition?.commit ?? null });
for (const spelling of ["typesense/typesense", "https://www.github.com/Typesense/Typesense"]) {
  const r = await post({ action: "clone", url: spelling, ref: "" });
  out.steps.push({ spelling, id: id(r), same: id(r) === id(a), ok: r.body?.ok ?? false, created: r.body?.created ?? null });
}
const target = "sindresorhus/quick-lru";
const [c1, c2] = await Promise.all([post({ action: "clone", url: target, ref: "" }), post({ action: "clone", url: target, ref: "" })]);
out.concurrent = { target, ids: [id(c1), id(c2)], same: Boolean(id(c1)) && id(c1) === id(c2), created: [c1.body?.created ?? null, c2.body?.created ?? null] };
const other = await post({ action: "clone", url: "https://github.com/octocat/Hello-World", ref: "" });
out.differentRepo = { id: id(other), distinct: id(other) !== id(a) };
out.verdict = {
  threeSpellingsOneRecord: out.steps.every((s) => s.id === out.steps[0].id),
  concurrentSingleRecord: out.concurrent.same,
  differentRepoDistinct: out.differentRepo.distinct,
};
fs.writeFileSync("docs/acceptance/mission-10-2/live-acquisition-evidence.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.verdict), "| ids:", out.steps.map((s) => s.id), out.concurrent.ids);
