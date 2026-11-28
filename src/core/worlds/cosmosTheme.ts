/**
 * The theme of the Cosmos and of every chat variant (owner, 2026-11-28): "the cosmos should be able to
 * switch to the other chat universe themes, while still keeping cosmos the primary and the rest variants".
 *
 * One state, the world engine's ACTIVE world (WorldStore): the chat variants already draw it behind the
 * thread, and the Cosmos draws it behind the landing. No active world = the PRIMARY Cosmos.
 */
import { FAMILIES } from "./ThemeFamilies";
import { activate, activeWorld, createWorld, savedWorlds } from "./WorldStore";

export const PRIMARY = "primary-cosmos";

export function themes(): Array<{ id: string; label: string }> {
  return [{ id: PRIMARY, label: "Primary Cosmos" }, ...FAMILIES.map((f) => ({ id: f.id, label: f.label }))];
}

/** The theme in force: PRIMARY, or the family id of the active world (its first family). */
export function currentTheme(): string {
  const w = activeWorld();
  return w ? w.families[0] ?? PRIMARY : PRIMARY;
}

/** Switch the Cosmos and every chat variant to a theme family, or back to the primary Cosmos. */
export function setTheme(id: string): { ok: boolean; theme: string; label: string } {
  if (id === PRIMARY || !id) {
    activate(null);
    return { ok: true, theme: PRIMARY, label: "Primary Cosmos" };
  }
  const family = FAMILIES.find((f) => f.id === id || f.label.toLowerCase() === id.toLowerCase());
  if (!family) return { ok: false, theme: currentTheme(), label: id };
  // Reuse a saved world of exactly this family (keeps the owner's edits to it); otherwise compose one.
  const existing = savedWorlds().find((w) => w.families.length === 1 && w.families[0] === family.id);
  if (existing) activate(existing.id);
  else createWorld([family.id]);
  return { ok: true, theme: family.id, label: family.label };
}

/** The theme a sentence names, if any ("volcano", "digital rain", "the primary cosmos"). */
export function themeIn(text: string): string | null {
  const t = text.toLowerCase();
  if (/\b(primary|original|default|normal|main) cosmos\b|\bback to (?:the )?cosmos\b/.test(t)) return PRIMARY;
  const hit = FAMILIES.find((f) => t.includes(f.label.toLowerCase()) || new RegExp(`\\b${f.id.replace(/-/g, "[- ]")}\\b`).test(t));
  return hit?.id ?? null;
}
