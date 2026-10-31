/**
 * ==========================================================
 * LÉLU — CHAT MARKDOWN
 *
 * How LÉLU's words are laid out in the conversation. Uses the
 * react-markdown the project already ships (plus GFM for tables,
 * strikethrough and task lists); raw HTML is never rendered.
 *
 *   headings / an ALL-CAPS line → a topic label with a divider
 *   ``` code ```                → a code block with copy + scroll
 *   ```mermaid```               → a rendered diagram (lazy-loaded)
 *   ```svg``` / <svg …>         → the image itself, sandboxed in <img>
 *   tables                      → scroll sideways inside the bubble
 * ==========================================================
 */

import { Children, isValidElement, memo, useEffect, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** Plain text of a rendered node tree (code blocks arrive as elements). */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** A short line written entirely in capitals reads as a section label ("MIAMI"). */
const TOPIC_LINE = /^[A-Z0-9][A-Z0-9 &/·'’:,.-]{1,46}$/;

function isTopicLine(text: string): boolean {
  const trimmed = text.trim();
  return TOPIC_LINE.test(trimmed) && /[A-Z]{2}/.test(trimmed) && !/^\d+[.)]?$/.test(trimmed);
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function CopyButton({ text, label = "Copy code" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [copied]);
  return (
    <button
      type="button"
      className="lelu-cc-chip"
      aria-label={copied ? "Copied" : label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => undefined);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  return (
    <figure className="lelu-cc-code" aria-label={language ? `${language} code` : "Code"}>
      <figcaption className="lelu-cc-code-head">
        <span>{language || "code"}</span>
        <CopyButton text={code} />
      </figcaption>
      <pre tabIndex={0}>
        <code>{code}</code>
      </pre>
    </figure>
  );
}

/* ----------------------------- diagrams ----------------------------- */

type MermaidApi = typeof import("mermaid").default;
let mermaidLoad: Promise<MermaidApi> | null = null;

/** Mermaid is large, so it loads only when a diagram actually appears. */
function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidLoad) {
    mermaidLoad = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        // "base" is the theme mermaid designs for customisation; the colours
        // are LÉLU's cloud palette, the font a concrete family because an
        // <img> cannot inherit the page's.
        theme: "base",
        // SVG text rather than HTML labels, so the diagram renders inside
        // an <img> — isolated from the page's scripts and styles.
        flowchart: { htmlLabels: false, curve: "basis" },
        themeVariables: {
          darkMode: true,
          background: "#140d2b",
          primaryColor: "#3b2a63",
          primaryTextColor: "#f6efff",
          primaryBorderColor: "#f3b6dc",
          secondaryColor: "#2c2152",
          secondaryTextColor: "#f6efff",
          tertiaryColor: "#221944",
          tertiaryTextColor: "#f6efff",
          lineColor: "#f3b6dc",
          textColor: "#f6efff",
          edgeLabelBackground: "#2c2152",
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          fontSize: "15px",
        },
      });
      return mermaid;
    });
  }
  return mermaidLoad;
}

let diagramSeq = 0;

function DiagramBlock({ source }: { source: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [status, setStatus] = useState<"drawing" | "ready" | "failed">("drawing");
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // A streaming reply grows the block a few characters at a time; wait
    // for it to settle instead of re-rendering on every delta.
    const id = window.setTimeout(() => {
      void loadMermaid()
        .then(async (mermaid) => {
          const valid = await mermaid.parse(source, { suppressErrors: true });
          if (!valid) throw new Error("not a valid diagram");
          diagramSeq += 1;
          const { svg: rendered } = await mermaid.render(`lelu-diagram-${diagramSeq}`, source);
          if (!cancelled) {
            setSvg(rendered);
            setStatus("ready");
          }
        })
        .catch(() => {
          if (!cancelled) setStatus("failed");
        });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [source]);

  const sourceView = (
    <pre tabIndex={0} className="lelu-cc-visual-source">
      <code>{source}</code>
    </pre>
  );

  return (
    <figure className="lelu-cc-visual" aria-label="Diagram" aria-busy={status === "drawing" ? true : undefined}>
      <figcaption className="lelu-cc-code-head">
        <span>Diagram</span>
        <span style={{ display: "inline-flex", gap: 6 }}>
          {status === "ready" ? (
            <button type="button" className="lelu-cc-chip" onClick={() => setShowSource((v) => !v)} aria-expanded={showSource}>
              {showSource ? "Diagram" : "Source"}
            </button>
          ) : null}
          <CopyButton text={source} label="Copy diagram source" />
        </span>
      </figcaption>
      {status === "ready" && svg && !showSource ? (
        <img className="lelu-cc-visual-img" src={svgDataUrl(svg)} alt="Diagram" decoding="async" />
      ) : status === "drawing" ? (
        <div className="lelu-cc-visual-drawing" role="status">
          <span className="lelu-cc-dots" aria-hidden>
            <span />
            <span />
            <span />
          </span>
          Drawing the diagram…
        </div>
      ) : (
        <>
          {status === "failed" ? <div className="lelu-cc-visual-note">This diagram couldn't be drawn — here is its source.</div> : null}
          {sourceView}
        </>
      )}
    </figure>
  );
}

function SvgBlock({ source }: { source: string }) {
  // An <img> never runs scripts inside the SVG and its styles cannot leak.
  return (
    <figure className="lelu-cc-visual" aria-label="Image">
      <img className="lelu-cc-visual-img" src={svgDataUrl(source)} alt="Generated visual" decoding="async" />
    </figure>
  );
}

/* ----------------------------- renderer ----------------------------- */

const components: Components = {
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  pre({ children }) {
    const child = Children.toArray(children)[0];
    const className = isValidElement<{ className?: string }>(child) ? child.props.className ?? "" : "";
    const language = /language-([\w+-]+)/.exec(className)?.[1]?.toLowerCase() ?? "";
    const code = textOf(children).replace(/\n$/, "");
    if (language === "mermaid") return <DiagramBlock source={code} />;
    if (language === "svg" || (language === "" && /^\s*<svg[\s>]/i.test(code))) return <SvgBlock source={code} />;
    return <CodeBlock language={language} code={code} />;
  },
  table({ children }) {
    return (
      <div className="lelu-cc-table-scroll" tabIndex={0} role="region" aria-label="Table">
        <table>{children}</table>
      </div>
    );
  },
  img({ src, alt }) {
    return <img className="lelu-cc-inline-img" src={typeof src === "string" ? src : undefined} alt={alt ?? ""} loading="lazy" decoding="async" />;
  },
  h1: ({ children }) => <h2 className="lelu-cc-topic">{children}</h2>,
  h2: ({ children }) => <h3 className="lelu-cc-topic">{children}</h3>,
  h3: ({ children }) => <h4 className="lelu-cc-subtopic">{children}</h4>,
  h4: ({ children }) => <h5 className="lelu-cc-subtopic">{children}</h5>,
  p({ children }) {
    const text = textOf(children);
    if (Children.count(children) === 1 && isTopicLine(text)) {
      return <h3 className="lelu-cc-topic">{text.trim()}</h3>;
    }
    return <p>{children}</p>;
  },
};

const plugins = [remarkGfm];

function ChatMarkdownImpl({ text }: { text: string }) {
  return (
    <div className="lelu-cc-md">
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** Memoised on the text, so a streaming reply re-parses only its own bubble. */
const ChatMarkdown = memo(ChatMarkdownImpl);
export default ChatMarkdown;

/** For the copy action on a whole message. */
export function MessageCopy({ text }: { text: string }) {
  return <CopyButton text={text} label="Copy message" />;
}
