# R-20261118-wp07-evidence-must-arrive-in-chat

WP07 · capabilities · verified · confidence 0.75

_2026-11-18T22:30:58.475Z_ · commit `761d01c8`

**1–3 Mission.** LÉLU 2.3 — autonomous learning, visual creation and identity reconstruction (WP07)

**4 Observed.** The mission requires renders, before/after comparisons and measurements to appear in the conversation itself. The chat renderer handled markdown images and SVG blocks, and no surface could load an image cited at a repository path.

**5 Studied.** How a chat bubble can carry structured evidence: a fenced block parsed into a validated block list, rendered by one component on every surface.

**6 Question.** How does evidence get into the conversation without an artifact directory or a dashboard?

**7 Hypothesis.** A fenced `evidence` block with validated blocks and a public-path mapping is enough for every surface.

**8 Method.** Define the block protocol in the research layer, render it in the chat bubble (image, compare, group, measure, commit), and copy every cited image into the app's public directory under the same mapping the renderer uses.

**9 Results.** Implemented: src/core/cognition/research/evidence.ts (parse, normalise, markdown, public-path mapping, evidenceFromEntry), src/app/scene/genesis/chat/ChatEvidence.tsx (inline images, expandable lightbox, labelled before/after, measurement tables), wired into ChatMarkdown so a message renders it, and scripts/lelu2/evidence.ts emits the blocks for this mission.

**10 Evidence.**
- `test` tests/lelu2-m23.test.ts — five guards: round-trip, refusal of a malformed block, labelled comparison, entry→blocks, public path
- `measurement` artifacts/lelu2/research/evidence-m23.json — the blocks generated from this mission's own builds
- `measurement` artifacts/lelu2/research/evidence-m23.md — the same evidence as markdown
- `commit` 761d01c88633c664a376bd8605a351df3a626287 @ 761d01c8 — mission commit

**11 Learned.** Evidence delivery is a protocol, not a UI feature: the same blocks must render in the bubble, export as markdown, and be copied to a loadable path, or one surface silently becomes the only place the work can be seen.

**12 Confidence.** 0.75

**12b Limitations.**
- The lightbox is a fixed overlay, not a pinch-zoom viewer.
- The evidence CLI copies images for the app's public directory; a deployed build still needs that copy step to run.

**13 Applications.** Every future mission can deliver its evidence through the same fence and the same renderer.

**14 Next questions.**
- Should the chat also be able to pull historical evidence back by entry id?

**Settles.**
- How does evidence get into the conversation without an artifact directory or a dashboard?

**Assumptions.**
- (none recorded)

**Refutations.**
- (none)

**Tags.**
`chat` `evidence` `capability` `wp07`
