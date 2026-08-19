/**
 * ==========================================================
 * LÉLU
 * VISUAL INSPECTION — seeing the interface she is developing
 *
 * The sandbox `preview` job assembles a self-contained HTML
 * document; the Evolution workspace renders it in a same-origin
 * iframe. This module inspects the REAL rendered DOM and reports
 * concrete layout problems — overflow, overlapping elements,
 * collapsed boxes, unreadable text, missing assets — so visual
 * iteration is evidence-driven, not a code-correctness guess.
 *
 * It is a DOM inspector, not a screenshotter: it reads geometry
 * and computed styles, which is reliable and offline. Actual
 * pixel screenshots of a dev build remain a separate (container)
 * capability.
 * ==========================================================
 */

export type VisualSeverity = "ok" | "info" | "warn" | "error";

export interface VisualFinding {
  severity: VisualSeverity;
  category: string;
  message: string;
  detail?: string;
}

export interface VisualReport {
  updatedAt: number;
  findings: VisualFinding[];
  summary: { ok: number; info: number; warn: number; error: number };
  healthy: boolean;
}

export interface Viewport {
  width: number;
  height: number;
}

function rectOf(element: Element): DOMRect {
  try {
    return element.getBoundingClientRect();
  } catch {
    return new DOMRect(0, 0, 0, 0);
  }
}

function isVisible(element: Element): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
    return false;
  }
  const rect = rectOf(element);
  return rect.width > 0 && rect.height > 0;
}

function overlapArea(a: DOMRect, b: DOMRect): number {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
}

export function inspectDocument(doc: Document, viewport: Viewport): VisualFinding[] {
  const findings: VisualFinding[] = [];
  const root = doc.documentElement;
  const body = doc.body;

  if (!body) {
    findings.push({ severity: "error", category: "structure", message: "The rendered document has no <body>." });
    return findings;
  }

  /* Empty interface. */
  const textLength = (body.textContent ?? "").trim().length;
  const elementCount = body.querySelectorAll("*").length;
  if (elementCount === 0 && textLength === 0) {
    findings.push({ severity: "error", category: "structure", message: "The rendered interface is empty." });
    return findings;
  }

  /* Horizontal overflow. */
  const scrollWidth = root.scrollWidth;
  const clientWidth = root.clientWidth || viewport.width;
  if (scrollWidth > clientWidth + 2) {
    findings.push({
      severity: "warn",
      category: "overflow",
      message: `Content overflows horizontally (${scrollWidth}px rendered in a ${clientWidth}px viewport).`,
    });
  }

  /* Vertical overflow beyond ~2 screens. */
  const scrollHeight = root.scrollHeight;
  const clientHeight = root.clientHeight || viewport.height;
  if (scrollHeight > clientHeight * 2 + 4) {
    findings.push({
      severity: "info",
      category: "overflow",
      message: `Content is ${Math.round(scrollHeight / clientHeight)}× the viewport height (${scrollHeight}px) — check for a missing scroll container.`,
    });
  }

  /* Per-element checks. */
  const elements = [...body.querySelectorAll<HTMLElement>("*")].slice(0, 400);
  const visible = elements.filter(isVisible);
  const tooWide = visible.filter((element) => rectOf(element).width > viewport.width + 2).slice(0, 3);
  for (const element of tooWide) {
    findings.push({
      severity: "warn",
      category: "layout",
      message: `Element <${element.tagName.toLowerCase()}> is ${Math.round(rectOf(element).width)}px wide — wider than the ${viewport.width}px viewport.`,
    });
  }

  const collapsed = visible.filter((element) => {
    const children = [...element.children];
    return children.length > 0 && children.every((child) => !isVisible(child)) && element.scrollHeight === 0;
  });
  if (collapsed.length > 0) {
    findings.push({
      severity: "warn",
      category: "layout",
      message: `${collapsed.length} container(s) have children but render at zero height — check for collapsed/flex/absolute layout issues.`,
    });
  }

  const tinyText = visible.filter((element) => {
    const style = window.getComputedStyle(element);
    const size = Number.parseFloat(style.fontSize);
    return size > 0 && size < 9 && (element.textContent ?? "").trim().length > 0;
  });
  if (tinyText.length > 0) {
    findings.push({
      severity: "warn",
      category: "readability",
      message: `${tinyText.length} element(s) use sub-9px text — likely unreadable on the target viewport.`,
    });
  }

  /* Overlapping sibling elements. */
  let overlaps = 0;
  for (let index = 0; index < visible.length && overlaps < 4; index += 1) {
    const a = visible[index];
    const ra = rectOf(a);
    for (let other = index + 1; other < visible.length; other += 1) {
      const b = visible[other];
      if (a.parentElement === b.parentElement) {
        const rb = rectOf(b);
        const overlap = overlapArea(ra, rb);
        const smaller = Math.min(ra.width * ra.height, rb.width * rb.height);
        if (smaller > 0 && overlap > smaller * 0.5) {
          overlaps += 1;
          findings.push({
            severity: "warn",
            category: "overlap",
            message: `Overlapping elements <${a.tagName.toLowerCase()}> and <${b.tagName.toLowerCase()}> cover each other by >50%.`,
          });
          if (overlaps >= 4) {
            break;
          }
        }
      }
    }
  }

  /* Broken images / links. */
  const brokenImages = [...doc.querySelectorAll<HTMLImageElement>("img")].filter((img) => !img.getAttribute("src") || img.getAttribute("src")?.startsWith("/"));
  if (brokenImages.length > 0) {
    findings.push({
      severity: "info",
      category: "assets",
      message: `${brokenImages.length} image(s) reference a missing or unresolved src — inline assets into the sandbox to render them.`,
    });
  }

  const missingAlt = [...doc.querySelectorAll<HTMLImageElement>("img")].filter((img) => !img.getAttribute("alt") && img.getAttribute("role") !== "presentation");
  if (missingAlt.length > 0) {
    findings.push({
      severity: "info",
      category: "accessibility",
      message: `${missingAlt.length} image(s) are missing alt text.`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: "ok",
      category: "layout",
      message: `Rendered cleanly: ${visible.length} visible element(s), no overflow, overlap or readability issues detected.`,
    });
  }

  return findings;
}

export function buildReport(findings: VisualFinding[]): VisualReport {
  const summary = { ok: 0, info: 0, warn: 0, error: 0 };
  for (const finding of findings) {
    summary[finding.severity] += 1;
  }
  return {
    updatedAt: Date.now(),
    findings,
    summary,
    healthy: summary.error === 0,
  };
}
