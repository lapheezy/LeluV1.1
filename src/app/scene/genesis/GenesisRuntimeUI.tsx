/**
 * ==========================================================
 * LÉLU
 * GENESIS RUNTIME UI — renders a UISpec into a live panel
 *
 * The interface-evolution engine's renderer: a data-defined
 * spec (labels, inputs, buttons, selects, toggles, lists,
 * chips, badges, grids, rows) becomes real, interactive UI.
 * Buttons dispatch actions with the current form values, so a
 * spec can be designed, previewed, and iterated on without
 * touching production JSX.
 * ==========================================================
 */

import { useState, type CSSProperties } from "react";
import type { UISpec, UISpecElement, UISpecSection } from "../../../core/selfdev/UISpec";

export type RuntimeValues = Record<string, string | boolean>;

interface GenesisRuntimeUIProps {
  spec: UISpec;
  onAction?: (key: string, values: RuntimeValues) => void;
  /** External values that override the spec's defaults (live binding). */
  externalValues?: RuntimeValues;
  compact?: boolean;
}

const baseField: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 10,
  padding: "8px 10px",
  color: "white",
  fontSize: 12.5,
  outline: "none",
  fontFamily: "inherit",
};

const TONES: Record<string, string> = {
  ok: "#34d399",
  warn: "#fbbf24",
  error: "#f87171",
  info: "#67e8f9",
};

function collectDefaults(elements: UISpecElement[], into: RuntimeValues): void {
  for (const element of elements) {
    if (element.type === "text" || element.type === "select") {
      if (element.key !== undefined && element.value !== undefined) {
        into[element.key] = element.value;
      }
    } else if (element.type === "toggle") {
      if (element.key !== undefined && element.value !== undefined) {
        into[element.key] = element.value;
      }
    } else if (element.type === "row" || element.type === "column" || element.type === "grid") {
      collectDefaults(element.elements, into);
    }
  }
}

function RuntimeElement({
  element,
  values,
  onChange,
  onAction,
  compact,
}: {
  element: UISpecElement;
  values: RuntimeValues;
  onChange: (key: string, value: string | boolean) => void;
  onAction?: (key: string, values: RuntimeValues) => void;
  compact?: boolean;
}) {
  const set = (key: string, value: string | boolean) => onChange(key, value);

  switch (element.type) {
    case "label": {
      const size =
        element.variant === "title"
          ? { fontSize: compact ? 15 : 17, fontWeight: 700 }
          : element.variant === "subtitle"
            ? { fontSize: 13, fontWeight: 600 }
            : element.variant === "caption"
              ? { fontSize: 10.5, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.12em" }
              : { fontSize: 12.5, opacity: 0.85 };
      return <div style={{ lineHeight: 1.45, ...size }}>{element.text}</div>;
    }
    case "text":
      return (
        <label style={{ display: "block" }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.12em", opacity: 0.6, marginBottom: 4 }}>
            {element.label}
          </div>
          <input
            value={typeof values[element.key] === "string" ? (values[element.key] as string) : ""}
            onChange={(event) => set(element.key, event.target.value)}
            placeholder={element.placeholder}
            style={baseField}
          />
        </label>
      );
    case "button":
      return (
        <button
          type="button"
          onClick={() => onAction?.(element.key, values)}
          style={{
            borderRadius: 999,
            padding: "8px 16px",
            fontSize: 12,
            cursor: "pointer",
            fontFamily: "inherit",
            border:
              element.variant === "primary"
                ? "1px solid rgba(125, 211, 252, 0.55)"
                : "1px solid rgba(255,255,255,0.16)",
            background:
              element.variant === "primary" ? "rgba(34, 211, 238, 0.22)" : "rgba(255,255,255,0.06)",
            color: "white",
          }}
        >
          {element.label}
        </button>
      );
    case "select":
      return (
        <label style={{ display: "block" }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.12em", opacity: 0.6, marginBottom: 4 }}>
            {element.label}
          </div>
          <select
            value={typeof values[element.key] === "string" ? (values[element.key] as string) : ""}
            onChange={(event) => set(element.key, event.target.value)}
            style={baseField}
          >
            {element.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      );
    case "toggle":
      return (
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12.5 }}>
          <input
            type="checkbox"
            checked={Boolean(values[element.key])}
            onChange={(event) => set(element.key, event.target.checked)}
            style={{ width: 16, height: 16, accentColor: "#67e8f9", cursor: "pointer" }}
          />
          {element.label}
        </label>
      );
    case "list":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {element.items.map((item, index) => (
            <div key={`${item}-${index}`} style={{ fontSize: 12, opacity: 0.85, display: "flex", gap: 8 }}>
              <span style={{ opacity: 0.5 }}>•</span>
              {item}
            </div>
          ))}
        </div>
      );
    case "chips":
      return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {element.items.map((item) => (
            <span key={item} style={{ fontSize: 11, border: "1px solid rgba(255,255,255,0.14)", borderRadius: 999, padding: "4px 10px", background: "rgba(255,255,255,0.04)" }}>
              {item}
            </span>
          ))}
        </div>
      );
    case "badge":
      return (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            borderRadius: 999,
            padding: "3px 10px",
            color: TONES[element.tone ?? "info"] ?? TONES.info,
            border: `1px solid ${(TONES[element.tone ?? "info"] ?? TONES.info)}55`,
            background: `${(TONES[element.tone ?? "info"] ?? TONES.info)}14`,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor", boxShadow: "0 0 6px currentColor" }} />
          {element.text}
        </span>
      );
    case "alert":
      return (
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.45,
            borderRadius: 10,
            padding: "8px 12px",
            color: TONES[element.tone] ?? TONES.info,
            border: `1px solid ${(TONES[element.tone] ?? TONES.info)}44`,
            background: `${(TONES[element.tone] ?? TONES.info)}0d`,
          }}
        >
          {element.text}
        </div>
      );
    case "divider":
      return <div style={{ height: 1, background: "rgba(255,255,255,0.1)" }} />;
    case "spacer":
      return <div style={{ height: element.height ?? 12 }} />;
    case "row":
      return (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {element.elements.map((child, index) => (
            <RuntimeElement key={index} element={child} values={values} onChange={onChange} onAction={onAction} compact={compact} />
          ))}
        </div>
      );
    case "column":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {element.elements.map((child, index) => (
            <RuntimeElement key={index} element={child} values={values} onChange={onChange} onAction={onAction} compact={compact} />
          ))}
        </div>
      );
    case "grid":
      return (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, element.columns)}, minmax(0, 1fr))`, gap: 8 }}>
          {element.elements.map((child, index) => (
            <RuntimeElement key={index} element={child} values={values} onChange={onChange} onAction={onAction} compact={compact} />
          ))}
        </div>
      );
    default:
      return null;
  }
}

function RuntimeSection({ section, values, onChange, onAction, compact }: {
  section: UISpecSection;
  values: RuntimeValues;
  onChange: (key: string, value: string | boolean) => void;
  onAction?: (key: string, values: RuntimeValues) => void;
  compact?: boolean;
}) {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: compact ? 10 : 14, background: "rgba(255,255,255,0.025)", display: "flex", flexDirection: "column", gap: 10 }}>
      {section.title ? (
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.85 }}>
          {section.title}
        </div>
      ) : null}
      {section.elements.map((element, index) => (
        <RuntimeElement key={index} element={element} values={values} onChange={onChange} onAction={onAction} compact={compact} />
      ))}
    </div>
  );
}

export default function GenesisRuntimeUI({ spec, onAction, externalValues, compact = false }: GenesisRuntimeUIProps) {
  const [values, setValues] = useState<RuntimeValues>(() => {
    const defaults: RuntimeValues = {};
    for (const section of spec.sections) {
      collectDefaults(section.elements, defaults);
    }
    return { ...defaults, ...(externalValues ?? {}) };
  });

  const onChange = (key: string, value: string | boolean) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {spec.sections.map((section, index) => (
        <RuntimeSection key={index} section={section} values={values} onChange={onChange} onAction={onAction} compact={compact} />
      ))}
    </div>
  );
}

/** Small helper for the UI Lab: summarize an element tree for preview lists. */
export function countElements(spec: UISpec): number {
  let count = 0;
  const walk = (elements: UISpecElement[]) => {
    for (const element of elements) {
      count += 1;
      if (element.type === "row" || element.type === "column" || element.type === "grid") {
        walk(element.elements);
      }
    }
  };
  for (const section of spec.sections) {
    walk(section.elements);
  }
  return count;
}
