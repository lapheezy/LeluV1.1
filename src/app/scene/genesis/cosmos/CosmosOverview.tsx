/**
 * ==========================================================
 * LÉLUVERSE COSMOS OVERVIEW
 *
 * Compact minimap showing the entire spatial hierarchy.
 * Allows selecting and jumping to any entity.
 * Cotton Candy Cosmos cloud aesthetic.
 * ==========================================================
 */

import { useEffect, useState } from "react";
import CosmosStore from "./CosmosStore";
import type { CosmosState } from "./CosmosTypes";

interface OverviewDot {
  x: number;
  y: number;
  r: number;
  color: string;
  label: string;
  id: string;
  level: string;
}

function mapToOverview(state: CosmosState, width: number, height: number): OverviewDot[] {
  const dots: OverviewDot[] = [];
  const padding = 16;
  const usableW = width - padding * 2;
  const usableH = height - padding * 2;

  // Find bounds
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const entity of state.entities) {
    if (entity.level === "agent-universe") continue; // too many, skip for overview
    minX = Math.min(minX, entity.position.x);
    maxX = Math.max(maxX, entity.position.x);
    minY = Math.min(minY, entity.position.y);
    maxY = Math.max(maxY, entity.position.y);
  }
  // Include memory garden position
  minX = Math.min(minX, -6);
  maxX = Math.max(maxX, 8);
  minY = Math.min(minY, -8);
  maxY = Math.max(maxY, 10);

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  for (const entity of state.entities) {
    if (entity.level === "agent-universe") continue;

    const nx = padding + ((entity.position.x - minX) / rangeX) * usableW;
    const ny = padding + ((1 - (entity.position.y - minY) / rangeY)) * usableH;

    const hue = entity.visualDNA.hue;
    const isActive = entity.activity.energy > 0.3;

    dots.push({
      x: nx,
      y: ny,
      r: entity.level === "lelu-core" ? 6 : entity.level === "shaman" ? 5 :
         entity.level === "executive-galaxy" ? 4 : 3,
      color: `hsl(${hue}, ${isActive ? "80%" : "50%"}, ${isActive ? "75%" : "55%"})`,
      label: entity.name,
      id: entity.id,
      level: entity.level,
    });
  }

  return dots;
}

export default function CosmosOverview() {
  const [state, setState] = useState<CosmosState>(() => CosmosStore.getInstance().getState());
  const width = 220;
  const height = 160;

  useEffect(() => {
    return CosmosStore.getInstance().subscribe(setState);
  }, []);

  if (!state.overview.visible) return null;

  const dots = mapToOverview(state, width, height);
  const store = CosmosStore.getInstance();

  return (
    <div
      style={{
        position: "fixed",
        bottom: 60,
        right: 16,
        width,
        height,
        borderRadius: 16,
        background: "linear-gradient(165deg, rgba(255, 182, 215, 0.08), rgba(147, 197, 253, 0.06), rgba(192, 132, 252, 0.07), rgba(2, 8, 30, 0.93))",
        border: "1px solid rgba(214, 178, 255, 0.25)",
        boxShadow: "0 12px 40px rgba(255, 158, 203, 0.12), 0 0 20px rgba(147, 197, 253, 0.08), 0 8px 24px rgba(0, 0, 0, 0.3)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        padding: 8,
        zIndex: 30,
        pointerEvents: "auto",
        cursor: "crosshair",
        overflow: "hidden",
      }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        // Find closest dot
        let closest: OverviewDot | null = null;
        let closestDist = Infinity;
        for (const dot of dots) {
          const dx = dot.x - clickX;
          const dy = dot.y - clickY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < closestDist && dist < 20) {
            closest = dot;
            closestDist = dist;
          }
        }
        if (closest) {
          store.navigateToEntity(closest.id);
        }
      }}
    >
      {/* Title */}
      <div style={{
        fontSize: 8,
        textTransform: "uppercase",
        letterSpacing: "0.15em",
        color: "rgba(200, 180, 240, 0.6)",
        marginBottom: 4,
        fontWeight: 600,
        fontFamily: "system-ui, sans-serif",
      }}>
        Cosmos Overview
      </div>

      {/* SVG minimap */}
      <svg width={width - 16} height={height - 36} style={{ display: "block" }}>
        {/* Background stars */}
        {Array.from({ length: 20 }).map((_, i) => (
          <circle
            key={`star-${i}`}
            cx={10 + (i * 37) % (width - 32)}
            cy={5 + (i * 23) % (height - 52)}
            r={0.5}
            fill="rgba(200, 210, 255, 0.2)"
          />
        ))}

        {/* Aurora pathway lines */}
        {state.auroraPathways.map((pathway) => {
          const fromDot = dots.find((d) => d.id === pathway.fromId);
          const toDot = dots.find((d) => d.id === pathway.toId);
          if (!fromDot || !toDot) return null;
          return (
            <line
              key={pathway.id}
              x1={fromDot.x - 8}
              y1={fromDot.y - 8}
              x2={toDot.x - 8}
              y2={toDot.y - 8}
              stroke="rgba(148, 163, 184, 0.15)"
              strokeWidth={0.5}
            />
          );
        })}

        {/* Entity dots */}
        {dots.map((dot) => (
          <g key={dot.id}>
            <circle
              cx={dot.x - 8}
              cy={dot.y - 8}
              r={dot.r}
              fill={dot.color}
              opacity={state.selectedEntityId === dot.id ? 1 : 0.7}
              style={{ cursor: "pointer" }}
            />
            {dot.r >= 4 && (
              <text
                x={dot.x - 8}
                y={dot.y - 8 - dot.r - 3}
                textAnchor="middle"
                fill={dot.color}
                fontSize={7}
                fontFamily="system-ui, sans-serif"
                opacity={0.7}
              >
                {dot.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
