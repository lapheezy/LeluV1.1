"""
Compare model landmark metrics with the reference distribution.

    python lelu-compare-landmarks.py REF/landmarks.json MODEL/landmarks.json [--out report.json]

For every metric: reference mean and std (n independent images), the model
value, the deviation in percent and in reference standard deviations (z).
A metric "passes" when |z| <= 2 (inside the spread of her own references);
the std floor is 1 % of the mean so a metric that happens to agree across a
few images is not held to an impossible tolerance.
"""
import json
import sys

ref = json.load(open(sys.argv[1]))["aggregate"]
mod_all = json.load(open(sys.argv[2]))
out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else None
imgs = [r for r in mod_all["images"].values() if r.get("detected")]
if not imgs:
    raise SystemExit("model: no face detected")
model = imgs[0]["metrics"]
rows = []
for k, r in ref.items():
    if k not in model:
        continue
    sd = max(r["std"], abs(r["mean"]) * 0.01)
    z = (model[k] - r["mean"]) / sd
    rows.append({"metric": k, "reference_mean": r["mean"], "reference_std": r["std"], "n": r["n"], "model": model[k], "deviation_pct": round(100 * (model[k] - r["mean"]) / r["mean"], 2) if r["mean"] else None, "z": round(z, 2), "pass": abs(z) <= 2, "definition": r.get("definition", "")})
passed = sum(r["pass"] for r in rows)
rms_z = (sum(r["z"] ** 2 for r in rows) / len(rows)) ** 0.5
rep = {"passed": passed, "total": len(rows), "rms_z": round(rms_z, 3), "rows": rows}
if out:
    json.dump(rep, open(out, "w"), indent=1)
print(f"{'metric':20s} {'reference':>16s} {'model':>8s} {'dev%':>7s} {'z':>6s}")
for r in rows:
    print(f"{r['metric']:20s} {r['reference_mean']:8.4f}±{r['reference_std']:.4f} {r['model']:8.4f} {r['deviation_pct']:7.1f} {r['z']:6.2f} {'ok' if r['pass'] else 'FAIL'}")
print(f"passed {passed}/{len(rows)}, rms z {rms_z:.2f}")
