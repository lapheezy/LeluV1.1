/**
 * ==========================================================
 * LÉLU — SESSION 3C: STUDIO INTENT
 *
 * The router has to decide one thing before it chooses tools: is this
 * message about building or changing software, or about something else that
 * merely uses the word "project"? Getting it wrong in either direction is
 * costly — a research request sent to the studio scaffolder, or a real build
 * request sent down the generic project path.
 *
 * Two independent signals must agree, and the studio must actually be
 * offered (`available`). The tests pin the exact cases: a bare noun is not a
 * build, and a collection of pendant designs is not an application.
 * ==========================================================
 */

/** Verbs that ask for a piece of software to be brought into existence. */
const BUILD_VERB =
  /\b(create|build|scaffold|generate|develop|code|make|prototype|spin\s+up|whip\s+up)\b/i;

/** Nouns that name software as an artifact, rather than a content project. */
const SOFTWARE_NOUN =
  /\b(website|web\s*site|web\s*app|webapp|application|app|game|dashboard|portal|storefront|player|platform|interface|saas|pwa|cli|api|frontend|backend|ui|prototype|3d|three\.?js)\b/i;

/** Verbs that ask for a change to software that already exists. */
const CHANGE_VERB =
  /\b(add|fix|change|update|adjust|improve|refactor|extend|remove|rename|tweak|iterate|polish|restyle|redo|debug|preview|test|deploy|ship|split|merge|extract|wire|hook)\b/i;

/**
 * A definite reference to a thing the person already has: "the Focus
 * Ledger", "my dashboard". This is what lets a follow-up like "add a status
 * filter to the Focus Ledger" stay with the studio even though it names no
 * software noun.
 */
const EXISTING_REFERENCE = /\b(the|my|our|this|that)\s+[A-Za-z][\w-]*/i;

/**
 * Work about a real-world collection, not software. These phrases describe
 * the subject of a project, so they must not be mistaken for an app.
 */
const NON_SOFTWARE =
  /\b(research|pendant|pendants|jewel(?:le)?ry|collection|collections|designs?|essay|article|curriculum|lesson\s+plan|survey|report\s+on|field\s+notes)\b/i;

function normalise(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * A build request: a build verb and a software noun in the same message,
 * with no competing non-software subject, and the studio actually offered.
 */
export function asksForStudioBuild(text: string, studioAvailable: boolean): boolean {
  if (!studioAvailable) return false;
  const message = normalise(text);
  if (!message) return false;
  if (!BUILD_VERB.test(message)) return false;
  if (!SOFTWARE_NOUN.test(message)) return false;
  // "make the collection larger" is a build verb over a content project.
  if (NON_SOFTWARE.test(message) && !SOFTWARE_NOUN.test(message.replace(NON_SOFTWARE, " "))) {
    return false;
  }
  return true;
}

/**
 * A follow-up change to software already in the studio: a change verb plus
 * either a software noun or a definite reference to something the person
 * already has. Still requires the studio to be offered.
 */
export function asksForStudioChange(text: string, studioAvailable: boolean): boolean {
  if (!studioAvailable) return false;
  const message = normalise(text);
  if (!message) return false;
  if (!CHANGE_VERB.test(message)) return false;
  const namesSoftware = SOFTWARE_NOUN.test(message);
  const refersToExisting = EXISTING_REFERENCE.test(message);
  if (!namesSoftware && !refersToExisting) return false;
  if (NON_SOFTWARE.test(message) && !namesSoftware) return false;
  return true;
}
