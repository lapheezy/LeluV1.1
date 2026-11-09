const BASE = process.env.BASE || "http://127.0.0.1:3013";

const post = async (body) => {
  const response = await fetch(`${BASE}/api/acquisition`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload = {};
  try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 300) }; }
  return { status: response.status, payload };
};

const idOf = (r) => r.payload?.acquisition?.id ?? r.payload?.id ?? null;

const out = { base: BASE, steps: [] };
const step = async (label, body) => {
  const r = await post(body);
  const entry = { label, action: body.action, url: body.url ?? null, status: r.status, id: idOf(r), ok: r.payload?.ok === true, error: r.payload?.error ?? null };
  out.steps.push(entry);
  console.log(JSON.stringify(entry));
  return entry;
};

// A. the same repository, twice, in two different spellings
const a1 = await step("same repo, https .git", { action: "clone", url: "https://github.com/typesense/typesense.git" });
const a2 = await step("same repo, bare owner/name", { action: "clone", url: "typesense/typesense" });
const a3 = await step("same repo, www + no .git", { action: "clone", url: "https://www.github.com/Typesense/Typesense" });

// B. a different repository is a different acquisition
const b1 = await step("different repo", { action: "clone", url: "https://github.com/octocat/Hello-World.git" });

// C. two concurrent requests for one new repository
const target = { action: "clone", url: "https://github.com/sindresorhus/is.git" };
const [c1, c2] = await Promise.all([post(target), post(target)]);
const c1id = idOf(c1), c2id = idOf(c2);
out.concurrent = { first: c1id, second: c2id, same: c1id === c2id, statuses: [c1.status, c2.status], errors: [c1.payload?.error ?? null, c2.payload?.error ?? null] };
console.log(JSON.stringify(out.concurrent));

out.verdict = {
  sameRepoReused: Boolean(a1.id) && a1.id === a2.id && a2.id === a3.id,
  differentRepoDistinct: Boolean(b1.id) && b1.id !== a1.id,
  concurrentSingleRecord: Boolean(c1id) && c1id === c2id,
};
console.log(JSON.stringify(out.verdict));

const fs = await import("node:fs");
fs.writeFileSync("docs/acceptance/mission-10/dedupe-evidence.json", JSON.stringify(out, null, 2));
