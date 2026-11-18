#!/usr/bin/env python3
"""
LÉLU 2 — independent mesh validation with trimesh (MIT, used as a tool).

Reads the GLBs LÉLU 2 writes and reports, per node: vertex/face counts,
watertightness, winding consistency, Euler characteristic and volume. This is
deliberately NOT LÉLU's own inspector: a topology claim should survive being
checked by somebody else's loader.

    PYTHONPATH=research/sources/trimesh python3 research/mesh-verify.py FILE...
"""
import json
import sys

import trimesh


def main(paths: list[str]) -> int:
    out = []
    for path in paths:
        try:
            scene = trimesh.load(path, force="scene")
            nodes = []
            for name, geom in scene.geometry.items():
                nodes.append(
                    {
                        "node": name,
                        "vertices": int(len(geom.vertices)),
                        "faces": int(len(geom.faces)),
                        "watertight": bool(geom.is_watertight),
                        "winding_consistent": bool(geom.is_winding_consistent),
                        "euler": int(geom.euler_number),
                        "volume_cm3": round(float(abs(geom.volume)) * 1e6, 3),
                    }
                )
            out.append(
                {
                    "file": path,
                    "nodes": nodes,
                    "total_faces": sum(n["faces"] for n in nodes),
                    "watertight_nodes": sum(1 for n in nodes if n["watertight"]),
                    "node_count": len(nodes),
                }
            )
        except Exception as exc:  # noqa: BLE001 - report, do not hide
            out.append({"file": path, "error": f"{type(exc).__name__}: {exc}"})
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
