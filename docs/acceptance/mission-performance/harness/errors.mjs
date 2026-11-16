import pw from "playwright"; const { chromium } = pw;
const b = await chromium.launch({ executablePath: process.env.CHROME }); const page = await (await b.newContext({ viewport: { width: +(process.env.W ?? 1440), height: +(process.env.H ?? 900) } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message)); page.on("console", (m) => { if (m.type() === "error") errs.push("console.error " + m.text().slice(0, 200)); });
await page.goto(process.env.URL ?? "http://127.0.0.1:4180/"); await page.waitForTimeout(+(process.env.WAIT ?? 12000));
const info = await page.evaluate(() => ({ rootChildren: document.getElementById("root")?.querySelectorAll("*").length, canvases: document.querySelectorAll("canvas").length, marks: performance.getEntriesByType("mark").filter((m) => m.name.startsWith("lelu:")).map((m) => `${m.name}@${Math.round(m.startTime)}`) }));
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
console.log(JSON.stringify(info)); console.log(errs.length, "errors"); for (const e of [...new Set(errs)].slice(0, 25)) console.log(" ", e);
await b.close();
