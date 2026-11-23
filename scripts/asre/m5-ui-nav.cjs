// shared: open the app and the Spatial Studio through the real UI
module.exports.openSpatial = async function (p) {
  await p.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(6000);
  const cont = p.getByRole("button", { name: "Continue without an account" });
  if (await cont.count()) await cont.click();
  await p.waitForTimeout(800);
  await p.getByRole("button", { name: "Studio", exact: true }).first().click();
  await p.waitForSelector("[data-studio-mode=spatial]", { timeout: 15000 });
  await p.click("[data-studio-mode=spatial]");
  await p.waitForSelector("[data-lelu-spatial-studio]", { timeout: 20000 });
};
