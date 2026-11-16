/**
 * The words that show or hide the Spatial bar. Shared by the router
 * (SurfaceResolver, which acts on them) and the chat's client-side shortcuts
 * (ExplorationController, which must leave them alone: its "show me <place>"
 * fallback had sent "show me the spatial bar" to the Earth map).
 */
/**
 * "open the spatial menu" → true, "hide the spatial bar" → false, anything
 * else → null. Needs a verb and the word "spatial" with a menu-like noun,
 * so talk about spatial computing is never taken as a command.
 */
export function parseSpatialNavCommand(text: string): boolean | null {
  const t = text.toLowerCase().replace(/^(?:l[eé]lu[,\s]+|please\s+|can you\s+|could you\s+)+/, "").trim();
  if (!/\bspatial\s+(?:menu|bar|nav|navigation|navigator|rail|controls?)\b/.test(t)) return null;
  if (/^(?:hide|close|dismiss|put\s+away|remove|get\s+rid\s+of|turn\s+off|collapse)\b/.test(t)) return false;
  if (/^(?:open|show(?:\s+me)?|bring\s+up|bring\s+back|display|pull\s+up|turn\s+on|give\s+me)\b/.test(t)) return true;
  return null;
}
