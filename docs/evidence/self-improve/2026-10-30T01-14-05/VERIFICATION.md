# Run 17: independent verification (by Claude Code, not LÉLU)

**Verdict: not met.** She said so herself: "**Expected outcome met?** No."

## What happened
- **The genuine Avatar-panel problem; comparisons like for like.** The app read 10 twice; her preview read 10 three times.
- **Her change:**
  - `flexWrap: "wrap"` and `overflowX: "auto"` on the two-column row. Wrapping is the right kind of change, but the measurement did not move.
  - `GenesisWindowFrame`'s `DEFAULT_WIDTH` changed to `"100%"`. That is shared by every panel, and on desktop it would make all of them full-width. It would have done harm.
- **She stopped after two approaches.** Her third (single-column below 400 px) was named, not tried, and she ended with "Let me know if you'd like me to try one of them now". The request says "decide the approach yourself; don't stop to ask me".

## Recorder change made after this run
- The recorder used to stop sending the go-ahead once she had validated, previewed and diffed once.
- It now also sends the go-ahead when her turn ends by asking permission to continue, within the same limit of four.
- It is the same neutral text. Whether and how to continue stays hers.

Nothing was applied to the real project.
