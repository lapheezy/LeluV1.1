# Hair silhouette: reference vs model

Same tool on both (scripts/asre/lelu-silhouette.py): MediaPipe hair mask in her
own face frame (origin pupil midpoint, unit IOD). Overlay: white both, pink
reference only, blue model only.

| hair width (IOD) | ref01 | ref10 | ref17 | model before | model now |
|---|---|---|---|---|---|
| brow (−1) | 4.45 | 4.3 | 3.7 | 3.1 | 3.95 |
| pupils (0) | 5.25 | 4.9 | 4.15 | 4.55 | 5.4 |
| mouth (+1.5) | 6.15 | 5.35 | 4.7 | 5.9 | 6.35 |
| chin (+2.5) | 7.05 | 4.95 | 4.9 | 7.5 | 7.05 |
| crown above pupils | 2.1 | 2.15 | 2.2 | 1.95 | 1.95 |

Silhouette IoU, crown to chin band: vs ref01 0.589 -> 0.618; vs ref10 0.759;
vs ref17 0.697.

Not compared below the chin: the segmenter loses dark hair over dark clothing
on BOTH images, and the model is in A-pose (hair drapes over raised arms)
while ref01's arms are down, so lower widths are pose-confounded. Hair length
is checked on geometry instead (strands to the belt line, as in ref01).
Crown height remains 0.15-0.25 IOD low: open.
