/**
 * A "Place in World" action any surface can mount.
 *
 * The button reports the bus's own outcome (including a refusal) instead of
 * optimistically claiming success, and the reveal is not triggered here: the
 * committed mutation raises SpatialRevealIntent itself, so this action and a
 * chat command take exactly the same path into the scene.
 */

import { useState, type CSSProperties } from "react";
import { placeInWorld, type PlaceInWorldInput } from "../../../../core/spatial/placeInWorld";

export interface PlaceInWorldButtonProps {
  name: string;
  kind?: PlaceInWorldInput["kind"];
  color?: string;
  scale?: number;
  label?: string;
  className?: string;
  buttonStyle?: CSSProperties;
  disabled?: boolean;
}

export default function PlaceInWorldButton({
  name,
  kind,
  color,
  scale,
  label = "Place in world",
  className,
  buttonStyle,
  disabled,
}: PlaceInWorldButtonProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const place = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    const outcome = await placeInWorld({ name, kind, color, scale });
    setStatus(
      outcome.ok
        ? `In the world: ${outcome.objectName ?? name} · revision ${outcome.revision}`
        : outcome.message,
    );
    setBusy(false);
  };

  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 6, minWidth: 0 }}>
      <button
        type="button"
        className={className}
        style={buttonStyle}
        data-lelu-place-in-world={name}
        disabled={disabled || busy}
        aria-label={`${label}: ${name}`}
        title={`${label} — creates a real object in the scene and reveals it`}
        onClick={(event) => {
          event.stopPropagation();
          void place();
        }}
      >
        {busy ? "Placing…" : label}
      </button>
      {status ? (
        <span role="status" style={{ fontSize: 10.5, opacity: 0.8, lineHeight: 1.3 }}>
          {status}
        </span>
      ) : null}
    </span>
  );
}
