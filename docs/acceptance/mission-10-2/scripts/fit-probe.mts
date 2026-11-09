import ResearchResolver from "../../../src/core/router/ResearchResolver";
import { fitRequestBudget } from "../../../src/core/router/RequestBudget";

const prompt =
  "Find a maintained open-source library that could improve LÉLU’s typo-tolerant search. Compare relevant candidates, inspect their licenses, and recommend the best fit.";
const observed =
  "maintained could s typo-tolerant search. Compare relevant candidates inspect their licenses recommend best fit.";

const r: any = Object.create(ResearchResolver.prototype);
for (const intent of ["chat", "search", "news", undefined] as any[]) {
  try {
    const q = r.buildQuery(prompt, intent);
    console.log(`buildQuery(${String(intent)}) len=${q.length} ${JSON.stringify(q)}`);
  } catch (e: any) { console.log(`buildQuery(${String(intent)}) ERR ${e.message}`); }
}
console.log("observed len:", observed.length);
const fit = fitRequestBudget({
  messages: [{ role: "system", content: "sys" }, { role: "user", content: prompt }],
  prompt, tools: [], tier: "FULL", provider: "openrouter", model: "unknown-model",
});
console.log("fitRequestBudget changed:", fit.changed, "notes:", fit.notes, "promptIntact:", fit.budget.promptBytes === new TextEncoder().encode(prompt).length);
