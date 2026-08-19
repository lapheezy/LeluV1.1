/**
 * ==========================================================
 * LÉLU
 * BROWSER TOOL
 *
 * LÉLU's browser capability, implemented as the in-app layer
 * the sandbox actually permits. A web application cannot launch
 * the user's native Chrome/Firefox (no OS process access from
 * inside a browser sandbox), so this tool is the honest
 * equivalent:
 *
 *   - open/navigate: the in-app browser panel (GenesisBrowserPanel)
 *     displays the page in an iframe.
 *   - read: this tool fetches the page and extracts its readable
 *     text (title + body text) so LÉLU's cognition can use it as
 *     context for responses — through the EXISTING router chain,
 *     no second runtime.
 *
 * Content that cannot be fetched from this origin (CORS/JS-only
 * pages) is reported accurately as "blocked" — never pretended
 * to have been read.
 * ==========================================================
 */

export interface BrowserPage {
  url: string;
  title: string;
  text: string;
  excerpt: string;
  status: "read" | "blocked" | "error";
  error?: string;
}

export default class BrowserTool {
  /**
   * Native browser launching is impossible from inside a web
   * sandbox — there is no access to the operating system's
   * browser processes. The in-app browser panel is the layer
   * that exists instead.
   */
  static nativeLaunchAvailable(): boolean {
    return false;
  }

  /**
   * Normalize a raw user-typed address into a fetchable URL.
   * Accepts "example.com" as well as full URLs.
   */
  static normalizeUrl(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    if (
      trimmed.includes(".") &&
      !trimmed.includes(" ") &&
      !trimmed.includes("\n")
    ) {
      return `https://${trimmed}`;
    }
    return null;
  }

  /**
   * Extract the first http(s) URL from a chat message, if any.
   */
  static findUrl(input: string): string | null {
    const match = input.match(/https?:\/\/[^\s"'<>]+/i);
    if (!match) {
      return null;
    }
    return match[0].replace(/[),.;!?]+$/, "");
  }

  /**
   * Whether a message reads like an instruction to browse a page
   * ("open", "browse", "go to", "read" + a page/site/URL mention)
   * even when it does not contain a bare URL.
   */
  static looksLikeBrowseRequest(input: string): boolean {
    const text = input.toLowerCase();
    const action =
      /(^|\s)(open|browse|visit|go to|navigate to|load|show me|read|look up the (page|site|website))\b/.test(
        text,
      );
    const target = /(website|web ?site|page|url|link|browser|http)/.test(text);
    return action && target;
  }

  /**
   * Read a page: fetch it (with timeout + redirects), extract the
   * readable text, and return it for cognition. Failures are
   * classified honestly — "blocked" when the origin refuses direct
   * reading (CORS / JS-only), "error" for real failures.
   */
  static async visit(
    rawUrl: string,
    timeoutMs = 12000,
  ): Promise<BrowserPage> {
    const url = BrowserTool.normalizeUrl(rawUrl);
    if (!url) {
      return {
        url: rawUrl,
        title: "",
        text: "",
        excerpt: "",
        status: "error",
        error: "That doesn't look like a valid web address.",
      };
    }

    try {
      const controller = new AbortController();
      const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { Accept: "text/html" },
          redirect: "follow",
          signal: controller.signal,
        });
      } finally {
        globalThis.clearTimeout(timer);
      }

      if (!response.ok) {
        return {
          url,
          title: "",
          text: "",
          excerpt: "",
          status: "error",
          error: `The page responded with HTTP ${response.status}.`,
        };
      }

      const html = await response.text();
      const { title, text } = BrowserTool.extract(html);

      if (!text.trim()) {
        return {
          url,
          title: title || url,
          text: "",
          excerpt: "",
          status: "blocked",
          error:
            "The page returned no readable text — it likely renders with JavaScript or blocks direct reading. The in-app browser can still open it for you.",
        };
      }

      const excerpt = text.trim().slice(0, 2400);

      return {
        url,
        title: title || url,
        text: text.trim(),
        excerpt,
        status: "read",
      };
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.name === "AbortError"
            ? "timed out"
            : error.message
          : String(error);
      return {
        url,
        title: "",
        text: "",
        excerpt: "",
        status: "blocked",
        error: `Could not read the page directly (${reason}). The in-app browser can still open it for you.`,
      };
    }
  }

  /**
   * Extract title + readable body text from raw HTML. Uses DOMParser
   * in the browser; falls back to a tag-stripping regex in Node
   * (verification scripts, non-DOM runtimes).
   */
  static extract(html: string): { title: string; text: string } {
    if (typeof DOMParser !== "undefined") {
      try {
        const document = new DOMParser().parseFromString(html, "text/html");
        const title = (document.querySelector("title")?.textContent ?? "").trim();
        const body = document.body;
        if (body) {
          for (const node of body.querySelectorAll(
            "script, style, noscript, template, svg, canvas, iframe, nav, footer, header, form, aside",
          )) {
            node.remove();
          }
          const text = (body.innerText ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
          return { title, text: text.slice(0, 8000) };
        }
        return { title, text: "" };
      } catch {
        // Fall through to the regex path.
      }
    }

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const raw = bodyMatch ? bodyMatch[1] : html;
    const text = raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 8000);
    return { title, text };
  }
}
