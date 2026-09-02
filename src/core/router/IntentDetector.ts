/**
 * ==========================================================
 * LÉLU
 * INTENT DETECTOR
 * ==========================================================
 */

import type { AIIntent } from "./AIIntent";

export default class IntentDetector {
  /**
   * Determine the user's intent.
   */
  public detect(input: string): AIIntent {
    const text = input.trim().toLowerCase();

    // -- Project commands — MUST be detected before news/search:
    // "Start a project to get current Tampa news every day" contains
    // "news" but is a project command, not a news lookup.
    const sandboxVerb =
      /\b(?:start|build|create|make|execute|run|work\s+on|use|open|launch|render|simulat|animat|full\s?screen|update|upgrade|improve)\b/i;
    if (
      this.matches(text, [
        "start a project", "create a project", "new project",
        "build a project", "make a project", "set up a project",
        "run my", "run the", "run project", "execute project",
        "pause my", "pause the", "resume my", "resume the", "stop my",
        "what did my", "what did the", "add to my project",
        "add to the project", "delete my project", "remove my project", "my project",
        "sandbox project", "in the sandbox", "in sandbox",
        "into the sandbox", "into sandbox", "use the sandbox",
        "use sandbox", "open the sandbox", "open sandbox",
        "work in the sandbox", "work in sandbox", "run in the sandbox",
        "run in sandbox", "build in the sandbox", "build in sandbox",
        "sandbox execution", "start the sandbox", "start sandbox",
        "through sandbox", "through the sandbox",
        "via sandbox", "via the sandbox",
      ]) ||
      /^(?:please\s+)?(?:start|create|build|make|set up|run|execute|pause|resume|stop|delete|remove)\b.*\bproject\b/i.test(text) ||
      /\b(?:start|build|create|make|execute|run|work on|use)\b.*\bsandbox\b/i.test(text) ||
      // Sandbox execution without the literal word "project":
      // "start through the sandbox…", "render it in sandbox…" — the
      // sandbox mention plus a real execution verb makes it a project.
      // "research sandbox games" / "what is a sandbox" never match
      // because research/what are not execution verbs.
      (/\bsandbox\b/.test(text) && sandboxVerb.test(text))
    ) {
      return "project";
    }

    // -- Project work stated WITHOUT the word "project".
    //
    // "I have an idea for a pendant collection", "use platinum", "make
    // the collection larger and add three designs", "start working on
    // it" — this is how people actually hand over work, and none of it
    // contains the literal token "project". Requiring that token is why
    // work stated conversationally was never organised into anything.
    //
    // This is only a CHEAP GATE, never a decision: it routes the turn to
    // ProjectResolver, where ProjectInterpreter reads the real
    // conversation and decides create / update / clarify / none. A
    // "none" verdict falls straight back to ordinary conversation, so a
    // false positive here costs a routing hop, not a wrong answer.
    const projectNoun =
      /\b(?:idea|concept|collection|campaign|series|line|brief|plan|build|design|prototype|feature|deliverable)s?\b/i;
    const projectVerb =
      /\b(?:start|begin|kick\s*off|work\s+on|working\s+on|make|build|create|design|develop|organi[sz]e|plan|add|extend|expand|continue|resume|scope|want|need|would\s+like|thinking\s+about)\b/i;
    const continuationReference =
      /\b(?:it|that|this|them|those|these|the\s+(?:collection|idea|design|plan|brief|series|line|campaign))\b/i;

    if (
      // "I have an idea for a pendant collection."
      (projectNoun.test(text) && projectVerb.test(text)) ||
      (/\bi\s+(?:have|had|got)\s+an?\s+idea\b/i.test(text)) ||
      // "Start working on it." / "continue the pendant collection"
      (/\b(?:start|continue|resume|carry\s+on)\b/i.test(text) && continuationReference.test(text)) ||
      // "make it larger", "add three more designs" — a modification of
      // something already under discussion.
      (/\b(?:make|add|change|update|expand|extend|increase|reduce)\b/i.test(text) &&
        continuationReference.test(text)) ||
      // A bare directive that sets an attribute on whatever is being
      // worked on: "use platinum", "switch to silver", "go with the
      // larger size". Meaningless on its own — the interpreter checks
      // whether a project is actually under discussion and answers
      // "none" when there is not.
      /^(?:use|switch\s+to|change\s+to|go\s+with|let'?s\s+use)\b/i.test(text)
    ) {
      return "project";
    }

    // -- Live time / date --
    if (
      this.matches(text, [
        "what time", "current time", "what's the time", "whats the time",
        "what day", "what date", "today's date", "todays date",
        "what is today", "what's today", "whats today",
        "time now", "date now", "what year", "current date",
        "tell me the time", "tell me the date",
        "what month", "what day is it",
      ])
    ) {
      return "time";
    }

    // -- Live news / current events --
    if (
      this.matches(text, [
        "news", "headlines", "current events", "what's happening",
        "whats happening", "latest news", "today's news",
        "breaking news", "recent news", "what's going on",
        "whats going on", "latest on", "what's new",
        "whats new", "any news", "tell me the news",
        "what's the latest", "whats the latest",
        "what happened", "happened today", "happening today",
        "happening right now", "in the news", "search the news",
        "current news", "world news", "news about", "update on",
        "update me", "updates on", "updated on", "give me an update",
        "keep me updated",
      ])
    ) {
      return "news";
    }

    // -- Avatar / embodiment commands — LÉLU's own visual identity.
    // These MUST be detected before the generic search fallback so an
    // instruction like "Update your avatar to 3d render and simulations"
    // routes to the avatar runtime, never to knowledge retrieval.
    // "Show me yourself" / "What do you look like" must also route
    // here — never let the LLM say "I can't display images" when
    // the application has a visual avatar system.
    {
      const newsLike =
        /\b(news|headlines?|latest|breaking|search|find|look up|lookup|who is|what is|wikipedia|research)\b/i.test(
          text,
        );
      const avatarWord = /\bavatar\b/.test(text);
      // Direct self-reference: "show me yourself", "show yourself",
      // "what do you look like", "describe yourself" — these are
      // clearly avatar commands regardless of other keywords.
      const directSelfVisual =
        /\bshow\s+(me\s+)?yourself\b/.test(text) ||
        /\bwhat\s+do\s+you\s+look\s+like\b/.test(text) ||
        /\bdescribe\s+yourself\b/.test(text) ||
        /\bshow\s+(me\s+)?your\s+(face|avatar|portrait|appearance|body|embodiment|self)\b/.test(text);
      const embodiment =
        /\b(yourself|myself|your)\b/.test(text) &&
        /\b(3d|3-d|three\s*d|render|simulat|animat|appearance|embodiment|portrait|look|body|face|self|who)\b/i.test(
          text,
        );
      const action =
        /\b(update|change|modify|upgrade|improve|make|give|set|switch|apply|use|show|render|build|create)\b/i.test(
          text,
        );
      const possessiveAvatar = /\b(my|your)\s+avatar\b/.test(text);
      const query =
        /\b(what|describe|show|how|is|does|do)\b/i.test(text);
      if (
        !newsLike &&
        (directSelfVisual || action || (query && possessiveAvatar)) &&
        (avatarWord || embodiment || directSelfVisual)
      ) {
        return "avatar";
      }
    }

    if (
      this.contains(text, [
        "wire", "circuit", "electrical", "electrician", "voltage",
        "breaker", "panel",
        "engineering", "engineer", "code", "typescript", "javascript",
        "react", "vite", "bug", "compile", "compiler", "error", "debug",
        "fix",
      ])
    ) {
      return "engineering";
    }

    if (
      this.contains(text, [
        "remember", "memory", "recall", "forgot", "save", "store",
      ])
    ) {
      return "memory";
    }

    if (
      this.contains(text, [
        "genesis", "galaxy", "universe", "cosmos", "star", "planet",
      ])
    ) {
      return "genesis";
    }

    if (
      this.contains(text, [
        "voice", "speech", "speak", "listen", "audio",
      ])
    ) {
      return "voice";
    }

    if (
      this.contains(text, [
        "search", "find", "look up", "lookup", "research",
        "wikipedia", "who is", "what is", "where is", "when did",
      ])
    ) {
      return "search";
    }

    return "chat";
  }

  /**
   * Match when any keyword phrase is found in the input.
   */
  private matches(input: string, phrases: readonly string[]): boolean {
    return phrases.some((p) => input.includes(p));
  }

  /**
   * Determine whether the input contains any keyword.
   */
  private contains(input: string, keywords: readonly string[]): boolean {
    for (const keyword of keywords) {
      if (input.includes(keyword)) {
        return true;
      }
    }
    return false;
  }
}