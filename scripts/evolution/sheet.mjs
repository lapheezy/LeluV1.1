/** Compose labelled screenshots into one contact sheet: node sheet.mjs out.png "Title" img1:label img2:label ... */
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";
const [out, title, ...items] = process.argv.slice(2);
const cells = await Promise.all(items.map(async (it) => {
  const [file, label] = it.split("::");
  const b64 = (await readFile(path.resolve("public/evolution", file.endsWith(".png") ? file : `${file}.png`))).toString("base64");
  return `<figure><img src="data:image/png;base64,${b64}"/><figcaption>${label ?? file}</figcaption></figure>`;
}));
const html = `<html><body style="margin:0;background:#0b0820;color:#ece6ff;font:600 15px system-ui;padding:18px">
<h1 style="margin:0 0 14px;font-size:22px;letter-spacing:.02em">${title}</h1>
<div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">${cells.join("")}</div>
<style>figure{margin:0;background:#151036;border:1px solid #3a2f7a;border-radius:12px;padding:8px}img{display:block;max-height:560px;max-width:880px;border-radius:8px}figcaption{padding:6px 2px 0;font-size:13px;color:#c9bfff}</style></body></html>`;
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 1900, height: 900 } });
await p.setContent(html);
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log(out);
