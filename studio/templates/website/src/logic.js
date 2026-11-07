/**
 * Aurora site — the logic that is worth testing.
 *
 * Pure functions only: no DOM, no globals. The browser module imports the
 * same file the test suite does, so a passing test says something about
 * the page and not about a copy of it.
 */

export const PROJECTS = [
  { id: "pulse", name: "Pulse Board", tags: ["product", "systems"] },
  { id: "orchard", name: "Night Orchard", tags: ["brand"] },
  { id: "quiet", name: "Quiet Hours", tags: ["product"] },
  { id: "atlas", name: "Atlas Index", tags: ["systems"] },
  { id: "solstice", name: "Solstice Field", tags: ["brand", "product"] },
];

export const FILTERS = ["all", "product", "brand", "systems"];

/** Which projects survive a filter chip. Unknown filters behave like "all". */
export function filterProjects(projects, filter) {
  if (!FILTERS.includes(filter) || filter === "all") return [...projects];
  return projects.filter((project) => project.tags.includes(filter));
}

/** "Showing 2 of 5 projects." — singular/plural handled. */
export function describeCount(shown, total) {
  const noun = shown === 1 ? "project" : "projects";
  return `Showing ${shown} of ${total} ${noun}.`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/**
 * Validate the contact form. Returns a map of field → message; an empty
 * object means the form may be submitted.
 */
export function validateContact(values) {
  const errors = {};
  const name = String(values.name ?? "").trim();
  const email = String(values.email ?? "").trim();
  const message = String(values.message ?? "").trim();

  if (name.length < 2) errors.name = "Please enter your name (at least 2 characters).";
  if (!EMAIL.test(email)) errors.email = "That email address does not look complete.";
  if (message.length < 10) errors.message = "A sentence, please — at least 10 characters.";

  return errors;
}

/** Theme is one of two values; anything unknown falls back to night. */
export function nextTheme(current) {
  return current === "day" ? "night" : "day";
}

export function themeLabel(theme) {
  return theme === "day" ? "Day" : "Night";
}

/** What the form reports after a successful submit. */
export function confirmationMessage(name) {
  const safe = String(name ?? "").trim();
  return `Thanks${safe ? `, ${safe}` : ""} — the brief is ready to send. This demo does not contact a server.`;
}
