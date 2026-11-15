# Mission 15 — Sixty Home layout concepts

How to read each entry

- **Comp**: composition. **Pos**: where modules sit. **Hier**: hierarchy. **Nav**: navigation.
- **Input**: touch and keyboard. **M/D**: mobile vs desktop. **+/−**: strengths and weaknesses.
- **A11y**: accessibility. **Perf**: performance risk. **Cx**: complexity (L/M/H).
- **Refs**: references.
  - *Product* means an existing, shipping (or historically shipped) product. The description is from general knowledge and was **not** re-verified in this session.
  - *Original* means a LÉLU concept with no product it copies.
- **LÉLU**: the recommendation.
  - **BUILT #n** means it is one of the twelve working prototypes (`homeComposition.TEMPLATES`).
  - **SUPPORTED** means the engine can express it today with the existing ops.
  - **PROPOSED** means it is designed only. **REJECT** means not recommended.

The engine families referenced below are `bento`, `grid`, `masonry`, `split`, `orbit`, `spatial`, `focus`, `deck`, `layered` and `freeform` (see `src/app/scene/genesis/home/homeComposition.ts`).

---

## 1. Dashboard and command center

**1. Bento grid.** Comp: mixed-size tiles packed with no gaps. Pos: hero tile top-left, supporting tiles fill. Hier: by tile size. Nav: tap a tile to open its app. Input: tap; Arrow keys reorder in edit mode. M/D: 6-col phone / 12-col desktop. +: dense and scannable. −: it can look like a template. A11y: DOM order = reading order (engine keeps it). Perf: low. Cx: L. Refs: *Product*, Apple product marketing pages (bento sections) and the sizes of iOS/iPadOS Home Screen widgets. LÉLU: **BUILT #2 Bento Universe**.

**2. Executive command center.** Comp: status column + work column. Pos: "Now" and approvals pinned first. Hier: urgency first. Nav: drill-in panels. Input: keyboard-heavy. M/D: phone collapses to one grid. +: answers "what needs me". −: dense on phone. A11y: pinned order is announced. Perf: low. Cx: L. Refs: *Product*, Bloomberg Terminal multi-panel screens and Grafana dashboards. LÉLU: **BUILT #5**.

**3. KPI scorecard strip.** Comp: a strip of numbers above the content. Pos: top strip. Hier: numbers first. Nav: tap a metric. Input: tap. M/D: horizontal scroll on phone. +: fast glance. −: LÉLU has few true KPIs. A11y: numbers need labels. Perf: low. Cx: L. Refs: *Product*, Stripe Dashboard overview. LÉLU: SUPPORTED (as an `xl` strip module); PROPOSED once there are metrics worth showing.

**4. Status-first briefing.** Comp: a stack of cards ordered by relevance. Pos: single column. Hier: time and relevance. Nav: tap to expand. Input: swipe or tap. M/D: ideal on phone. +: calm. −: hides tools. A11y: good (linear). Perf: low. Cx: L. Refs: *Product*, Google Now cards (discontinued) and the iOS Today View. LÉLU: SUPPORTED via Adaptive (#10) on phone.

**5. Mission-control wall.** Comp: many live panels at equal weight. Pos: uniform grid. Hier: flat. Nav: none (monitoring). Input: none. M/D: desktop only. +: situational awareness. −: no hierarchy, and noisy. A11y: poor without focus order. Perf: high when many panels are live. Cx: M. Refs: *Product*, Datadog dashboards. LÉLU: **REJECT** for Home; the Workspace Steward's `tile` already covers it.

**6. Live-tile launcher.** Comp: animated tiles that are also launchers. Pos: grid. Hier: size. Nav: tap. Input: tap. M/D: both. +: info plus launch in one. −: motion fatigue. A11y: animation needs reduced-motion handling. Perf: medium (constant animation). Cx: M. Refs: *Product*, Windows 8/10 Start live tiles (removed in Windows 11). LÉLU: REJECT the motion, keep the idea (the static Apps module).

**7. Widget stack.** Comp: several modules sharing one slot as tabs. Pos: any cell. Hier: active tab. Nav: tabs. Input: tap tabs; Arrow keys inside the tablist. M/D: saves phone space. +: density without clutter. −: hidden content. A11y: `role=tablist` (implemented). Perf: low. Cx: L. Refs: *Product*, iOS Smart Stack. LÉLU: **SUPPORTED** (`group` op; Project Hub #8 groups Notifications + Activity).

**8. Sidebar + canvas.** Comp: nav rail plus main area. Pos: left rail. Hier: rail is secondary. Nav: rail. Input: keyboard friendly. M/D: the rail becomes a sheet on phone. +: familiar. −: LÉLU already has a spatial nav. A11y: good. Perf: low. Cx: L. Refs: *Product*, Notion and Linear sidebars. LÉLU: REJECT (duplicates SpatialNav).

**9. Inbox-centric home.** Comp: notifications as the main surface. Pos: center. Hier: unread first. Nav: open each item. Input: keyboard triage. M/D: both. +: zero-inbox flow. −: anxiety, and it hides LÉLU. A11y: list semantics. Perf: low. Cx: L. Refs: *Product*, Superhuman and Gmail Priority Inbox. LÉLU: SUPPORTED (resize Notifications to `xl` and pin it).

**10. Command-bar home.** Comp: one search/command field. Pos: center top. Hier: the field. Nav: type. Input: keyboard first, ⌘K. M/D: weak on touch. +: fastest for experts. −: low discoverability. A11y: combobox semantics needed. Perf: low. Cx: M. Refs: *Product*, Raycast, macOS Spotlight and the VS Code command palette. LÉLU: REJECT as Home; the existing ⌘K palette stays one key away.

## 2. Spatial and Cosmos

**11. Orbit around LÉLU.** Comp: LÉLU centered, modules on an ellipse. Pos: polar. Hier: center > ring. Nav: tap orbiting modules. Input: drag in edit mode; Tab follows DOM order. M/D: tablet and desktop only (phone falls back to bento). +: unmistakably LÉLU. −: wastes corners, and small ring cards. A11y: DOM order ≠ visual circle (documented). Perf: low (CSS only). Cx: M. Refs: *Original*. LÉLU: **BUILT #3 Cosmos Orbit**.

**12. Depth planes.** Comp: near/far rows in perspective. Pos: two planes. Hier: near = active work. Nav: tap. Input: as grid. M/D: phone uses flat `layered`. +: depth without WebGL. −: the far plane is smaller to read. A11y: reduced motion removes the 3D transforms (verified). Perf: low to medium (compositing). Cx: M. Refs: *Product*, visionOS windows placed at depth (inspiration only). LÉLU: **BUILT #4 Spatial Home**.

**13. Planetary navigation.** Comp: apps as planets in the 3D Cosmos. Pos: 3D scene. Hier: distance. Nav: fly to. Input: gestures. M/D: costly on phone. +: magical. −: slow to reach things. A11y: poor without a list fallback. Perf: high (WebGL). Cx: H. Refs: *Original*; LÉLU already has Cosmos portals (`SpatialPortals`). LÉLU: keep in the Cosmos, **not** as the 2D Home.

**14. Constellation graph.** Comp: work items as nodes and links. Pos: force layout. Hier: degree. Nav: click a node. Input: pan and zoom. M/D: desktop. +: shows relations. −: unreadable at scale. A11y: needs a list twin. Perf: medium. Cx: H. Refs: *Product*, Obsidian graph view. LÉLU: PROPOSED as a Cosmos view of projects, not Home.

**15. Infinite canvas.** Comp: unbounded pan/zoom board. Pos: free. Hier: user-made. Nav: pan. Input: pinch, drag. M/D: fiddly on phone. +: total freedom. −: lost-in-space. A11y: hard. Perf: medium. Cx: H. Refs: *Product*, Figma, Miro and tldraw. LÉLU: REJECT for Home (the Excalidraw studio already exists); a bounded freeform is used instead (#12).

**16. Room / portal home.** Comp: a 3D room with doors to apps. Pos: 3D. Hier: doors. Nav: walk or tap. Input: gestures. M/D: costly. +: immersive. −: slow. A11y: poor. Perf: high. Cx: H. Refs: *Product*, Meta Horizon Home (VR). LÉLU: REJECT (CosmosRooms3D exists for exploration).

**17. Semantic zoom universe.** Comp: zooming changes the level of detail. Pos: nested. Hier: zoom level. Nav: zoom. Input: pinch, wheel. M/D: desktop first. +: one continuous space. −: disorientation. A11y: needs an explicit level control. Perf: medium to high. Cx: H. Refs: *Product*, Google Earth and Prezi. LÉLU: PROPOSED for Cosmos only.

**18. Cloud formation.** Comp: uneven, organic columns. Pos: masonry lanes. Hier: soft. Nav: tap. Input: as grid. M/D: 2 lanes phone, 4 desktop. +: feels alive and on-brand. −: less predictable scanning. A11y: DOM order is kept. Perf: low. Cx: L. Refs: *Original*. LÉLU: **BUILT #6 Organic Asymmetry**.

**19. Layered glass.** Comp: translucent surfaces over the live scene. Pos: any. Hier: blur and opacity. Nav: n/a. Input: n/a. M/D: blur is expensive on old phones. +: the LÉLU identity. −: contrast risk. A11y: contrast must be checked. Perf: medium (`backdrop-filter`); a solid fallback ships. Cx: L. Refs: *Product*, visionOS glass and Windows 11 Mica/Acrylic. LÉLU: **SUPPORTED**, applied to all compositions.

**20. Look at the Cosmos.** Comp: Home hides and the scene shows. Pos: n/a. Hier: n/a. Nav: orb toggle. Input: tap the orb, hold to talk. M/D: both. +: delight on demand. −: none if optional. A11y: labelled button. Perf: the scene renders anyway. Cx: L. Refs: *Original* (existing LÉLU immersive mode). LÉLU: **KEEP**; a swipe-on-orb misfire was fixed in this mission.

## 3. Content and discovery

**21. Masonry gallery.** Comp: equal-width lanes with variable heights. Pos: shortest-lane first. Hier: soft. Nav: tap. Input: as grid. M/D: 2 to 4 lanes. +: shows lots of work. −: order is harder to follow. A11y: DOM order is kept. Perf: low. Cx: L. Refs: *Product*, Pinterest. LÉLU: **BUILT #7 Creative Gallery**.

**22. Carousel rows.** Comp: horizontal rows by category. Pos: rows. Hier: row order. Nav: swipe rows. Input: swipe; arrows. M/D: both. +: browsable. −: hidden items off-screen. A11y: needs labelled lists. Perf: medium (many images). Cx: L. Refs: *Product*, Netflix and the Apple TV app. LÉLU: SUPPORTED inside Workspaces (it is already a snap carousel).

**23. Hero + feed.** Comp: one large hero, then a feed. Pos: column. Hier: hero. Nav: scroll. Input: scroll. M/D: phone-native. +: storytelling. −: tools are buried. A11y: good. Perf: low. Cx: L. Refs: *Product*, the App Store "Today" tab. LÉLU: SUPPORTED (LÉLU `l` + column) as a phone variant of Minimal Focus.

**24. Swipe card stack.** Comp: one card at a time. Pos: stacked. Hier: top card. Nav: swipe. Input: swipe; arrows. M/D: phone. +: focus. −: slow to scan. A11y: needs buttons as well as swipes. Perf: low. Cx: M. Refs: *Product*, Tinder-style card stacks. LÉLU: REJECT (Deck #11 covers it with visible neighbours).

**25. Magazine grid.** Comp: editorial asymmetric spreads. Pos: designed. Hier: art direction. Nav: scroll. Input: scroll. M/D: both. +: beautiful. −: needs curated content. A11y: ok. Perf: low. Cx: M. Refs: *Product*, Flipboard and Apple News. LÉLU: PROPOSED for briefings, not Home.

**26. Timeline / journal.** Comp: chronological stream. Pos: vertical time. Hier: recency. Nav: scroll. Input: scroll. M/D: both. +: memory-like. −: little action. A11y: good. Perf: low. Cx: L. Refs: *Product*, Day One and Google Photos memories. LÉLU: PROPOSED as a History view.

**27. Shelves / collections.** Comp: named shelves of items. Pos: rows. Hier: shelf. Nav: open a shelf. Input: tap. M/D: both. +: organises projects. −: maintenance burden. A11y: good. Perf: low. Cx: L. Refs: *Product*, Are.na and Apple Books. LÉLU: PROPOSED inside Files.

**28. Search-first.** Comp: a single search box. Pos: center. Hier: the box. Nav: type. Input: keyboard. M/D: ok. +: minimal. −: blank-page problem. A11y: good. Perf: low. Cx: L. Refs: *Product*, the Google homepage and Perplexity. LÉLU: REJECT (chat already is the "ask" surface).

**29. Recents + pinned.** Comp: pinned row plus a recents list. Pos: top and list. Hier: pinned. Nav: tap. Input: tap. M/D: both. +: practical. −: plain. A11y: good. Perf: low. Cx: L. Refs: *Product*, Finder/Files "Recents" and the VS Code welcome page. LÉLU: SUPPORTED (Pin + Workspaces "windows you left").

**30. Story rings.** Comp: a row of circular avatars. Pos: top row. Hier: unseen first. Nav: tap a ring. Input: tap. M/D: phone. +: compact status. −: social connotation. A11y: needs labels. Perf: low. Cx: L. Refs: *Product*, Instagram Stories. LÉLU: PROPOSED for agents' status only.

## 4. Productivity and workspace

**31. Split view.** Comp: two panes. Pos: 7/12 + 5/12. Hier: left pane primary. Nav: within panes. Input: keyboard. M/D: phone stacks. +: work + context. −: two scrolls. A11y: landmarks. Perf: low. Cx: L. Refs: *Product*, iPadOS Split View. LÉLU: **BUILT #8 Project Hub** (`split`).

**32. Tiling window manager.** Comp: windows tile with no overlap. Pos: auto. Hier: focus. Nav: keyboard. Input: keyboard-first. M/D: desktop. +: no overlap. −: rigid. A11y: good with keys. Perf: low. Cx: M. Refs: *Product*, Windows 11 Snap Layouts and the i3/Hyprland tiling WMs. LÉLU: **EXISTING** in the Workspace Steward (`tile`); Home does not duplicate it.

**33. Dockable IDE panels.** Comp: panels docked to edges or tabbed. Pos: docks. Hier: editor center. Nav: tabs. Input: drag tabs. M/D: desktop. +: power users. −: complex. A11y: varies. Perf: low to medium. Cx: H. Refs: *Product*, VS Code and JetBrains IDEs; the Dockview library. LÉLU: the existing module host already floats and docks windows; Home's "dock" is a chip dock (**SUPPORTED**).

**34. Workspace deck.** Comp: swipeable full-height surfaces. Pos: horizontal. Hier: current card. Nav: swipe or scroll-snap. Input: swipe; Tab. M/D: both (card widths 86/46/31 %). +: one context at a time. −: hidden siblings. A11y: native scroll. Perf: low. Cx: L. Refs: *Product*, macOS Spaces and Arc browser Spaces. LÉLU: **BUILT #11 Workspace Deck**.

**35. Stage Manager.** Comp: one active stage plus a strip of recents. Pos: center plus side. Hier: stage. Nav: tap a recent. Input: tap. M/D: iPad and Mac. +: focus + switching. −: wasted side strip. A11y: ok. Perf: medium. Cx: M. Refs: *Product*, macOS/iPadOS Stage Manager. LÉLU: SUPPORTED as Expanded Home + dock chips.

**36. Kanban hub.** Comp: columns by state. Pos: lanes. Hier: state. Nav: drag cards. Input: drag; keyboard. M/D: phone is awkward. +: workflow clarity. −: needs task data. A11y: drag needs a keyboard alternative. Perf: low. Cx: M. Refs: *Product*, Trello and Linear boards. LÉLU: PROPOSED inside Projects, not Home.

**37. Focus mode.** Comp: one primary surface, the rest docked. Pos: center column. Hier: absolute. Nav: dock chips. Input: tap. M/D: both. +: calm. −: hides context. A11y: good. Perf: lowest. Cx: L. Refs: *Product*, iOS Focus and iA Writer's focus mode. LÉLU: **BUILT #9 Minimal Focus**.

**38. Tab groups.** Comp: grouped tabs as one unit. Pos: any. Hier: group. Nav: tabs. Input: tablist keys. M/D: both. +: tidy. −: hidden. A11y: tablist. Perf: low. Cx: L. Refs: *Product*, Chrome tab groups. LÉLU: **SUPPORTED** (`group`/`ungroup`).

**39. Floating palettes.** Comp: small surfaces floating over the main layout. Pos: free. Hier: on top. Nav: drag. Input: drag; Arrow keys nudge, Shift+Arrow resizes. M/D: desktop mostly. +: keeps a tool at hand. −: occlusion. A11y: keyboard nudge (implemented). Perf: low. Cx: M. Refs: *Product*, Photoshop panels. LÉLU: **SUPPORTED** (`float`, `place`, snap and align).

**40. Today planner.** Comp: agenda + tasks. Pos: column. Hier: time. Nav: scroll. Input: tap. M/D: both. +: actionable. −: needs calendar data (no keyless calendar). A11y: good. Perf: low. Cx: M. Refs: *Product*, Things 3 "Today" and Google Calendar day view. LÉLU: **BLOCKED** (no free calendar source wired); PROPOSED.

## 5. Adaptive and intelligent

**41. Priority-ranked order.** Comp: the order follows signals. Pos: grid. Hier: computed. Nav: as grid. Input: as grid. M/D: both. +: what matters rises. −: movement can surprise. A11y: order changes only on data change, not on a timer. Perf: low. Cx: M. Refs: *Product*, Gmail Priority Inbox and Siri Suggestions. LÉLU: **BUILT #10 Adaptive Intelligence**. The order is computed at render time and the saved arrangement is never rewritten.

**42. Time-of-day home.** Comp: a different presentation by hour. Pos: n/a. Hier: n/a. Nav: auto switch. Input: n/a. M/D: both. +: contextual. −: unexpected changes. A11y: announce the switch. Perf: low. Cx: L. Refs: *Product*, iOS Focus-linked Home Screen pages. LÉLU: PROPOSED (one `applyPresentation` call on a schedule, opt-in only).

**43. Device-context home.** Comp: a separate arrangement per device. Pos: n/a. Hier: n/a. Nav: n/a. Input: n/a. M/D: inherent. +: right density per device. −: three layouts to keep. A11y: n/a. Perf: low. Cx: L. Refs: *Product*, responsive layouts generally. LÉLU: **SUPPORTED** (independent phone/tablet/desktop profiles, verified).

**44. Activity-driven hero.** Comp: the hero shows what LÉLU is doing. Pos: hero. Hier: live. Nav: tap to open chat or trace. Input: tap. M/D: both. +: makes LÉLU present. −: none. A11y: live text. Perf: low. Cx: L. Refs: *Original* (existing "Now"). LÉLU: **KEEP**.

**45. Predictive app row.** Comp: apps reordered by predicted need. Pos: apps strip. Hier: prediction. Nav: tap. Input: tap. M/D: both. +: fewer taps. −: muscle memory breaks. A11y: order churn. Perf: low. Cx: M. Refs: *Product*, iOS Siri App Suggestions. LÉLU: PROPOSED, gated on usage data and consent.

**46. Approval-first.** Comp: approvals jump to the top when pending. Pos: first slot. Hier: urgency. Nav: tap. Input: tap. M/D: both. +: safety. −: none. A11y: announce the count. Perf: low. Cx: L. Refs: *Original*. LÉLU: **SUPPORTED** through `adaptiveOrder` (approvals × 3).

**47. Density by device.** Comp: fewer, larger modules on phone. Pos: n/a. Hier: n/a. Nav: n/a. Input: n/a. M/D: inherent. +: readable. −: content is hidden. A11y: good. Perf: lower on phone. Cx: L. Refs: *Product*, Material Design responsive layout guidance. LÉLU: **SUPPORTED** (per-device sizes; phones never get orbit/spatial/freeform by default).

**48. LÉLU arranges it.** Comp: the assistant proposes a layout. Pos: n/a. Hier: n/a. Nav: approve. Input: chat. M/D: both. +: zero effort. −: trust. A11y: proposal text. Perf: low. Cx: M. Refs: *Original*; the existing `InterfaceOrchestrator` / `WorkspaceSteward` consent flow. LÉLU: PROPOSED. A `home.*` interface tool would map onto `HomeStore.applyHomeOp` behind the same approval gate (not built).

**49. Usage-learned layout.** Comp: the layout drifts toward use. Pos: n/a. Hier: n/a. Nav: n/a. Input: n/a. M/D: n/a. +: personal. −: opaque, with a privacy cost. A11y: unpredictability. Perf: low. Cx: M. Refs: *Product*, Windows Start "Recommended". LÉLU: REJECT silent drift; it would violate "never silently overwrite".

**50. Ambient / StandBy.** Comp: a glanceable full-screen state. Pos: large type. Hier: time and status. Nav: tap to wake. Input: tap. M/D: phone docked, tablet. +: calm presence. −: niche. A11y: large type. Perf: must avoid WebGL (use the CSS presence). Cx: L. Refs: *Product*, Apple StandBy (iOS 17). LÉLU: PROPOSED (`focus` with LÉLU `xl`).

## 6. Hybrid and experimental

**51. Orbit hero + bento body.** Comp: an orbit band on top, a bento below. Pos: two zones. Hier: LÉLU. Nav: as both. Input: as both. M/D: desktop. +: identity + utility. −: two systems to learn. A11y: two regions. Perf: low. Cx: M. Refs: *Original*. LÉLU: **RECOMMENDED next** (requires a two-zone solver; PROPOSED).

**52. Deck of bentos.** Comp: each deck card is its own bento. Pos: nested. Hier: card. Nav: swipe. Input: swipe. M/D: both. +: contexts with detail. −: nesting cost. A11y: ok. Perf: medium. Cx: H. Refs: *Original*. LÉLU: PROPOSED.

**53. Living ecosystem (freeform).** Comp: every surface placed by hand over the Cosmos. Pos: free with snap and align. Hier: user-made. Nav: as placed. Input: drag, resize, keyboard nudge. M/D: tablet and desktop (phone falls back to bento). +: expressive. −: can become messy. A11y: keyboard placement implemented; DOM order ≠ visual order. Perf: low. Cx: M. Refs: *Original*; *Product* inspirations: the Muse app and tldraw. LÉLU: **BUILT #12**.

**54. Chat is home.** Comp: the composer is the hero. Pos: center. Hier: conversation. Nav: ask. Input: type or voice. M/D: phone-native. +: assistant-first. −: hides the rest. A11y: good. Perf: low. Cx: L. Refs: *Product*, the ChatGPT and Claude start screens. LÉLU: **EXISTS** as the Chat Universe; Home hands off to it.

**55. Voice-first.** Comp: a big presence plus listening state. Pos: center. Hier: voice. Nav: speak. Input: voice; hold the orb. M/D: both. +: hands-free. −: public spaces. A11y: needs a text twin. Perf: low. Cx: M. Refs: *Product*, Echo Show and Nest Hub home screens. LÉLU: SUPPORTED (Minimal Focus + hold-to-talk orb).

**56. Earth/terrain home.** Comp: a globe as the backdrop with data. Pos: map. Hier: location. Nav: pan. Input: gestures. M/D: costly. +: grounding. −: slow. A11y: poor. Perf: high. Cx: H. Refs: *Product*, Google Earth; the LÉLU Earth panel exists. LÉLU: REJECT as Home; Weather → Earth hand-off exists.

**57. Radial menu.** Comp: actions fan out from a point. Pos: radial. Hier: angle. Nav: flick. Input: touch flick. M/D: phone. +: one-handed. −: low capacity. A11y: weak. Perf: low. Cx: M. Refs: *Product*, Path (2011 radial menu) and game weapon wheels. LÉLU: PROPOSED for the orb only.

**58. Card table spread.** Comp: cards dealt at angles. Pos: scattered. Hier: none. Nav: pick a card. Input: drag. M/D: desktop. +: playful. −: random-looking (the mission says avoid). A11y: poor. Perf: low. Cx: M. Refs: *Original*. LÉLU: **REJECT**.

**59. Generative theme home.** Comp: colours derived from content or wallpaper. Pos: n/a. Hier: n/a. Nav: n/a. Input: n/a. M/D: both. +: personal. −: contrast drift. A11y: must enforce contrast. Perf: low. Cx: M. Refs: *Product*, Material You dynamic colour (Android 12+). LÉLU: the existing InterfaceOrchestrator themes cover it; not Home-specific.

**60. Split reality.** Comp: 2D Home on one half, the live 3D Cosmos framed on the other. Pos: split. Hier: equal. Nav: both. Input: both. M/D: desktop. +: shows the universe without leaving work. −: GPU cost. A11y: the 3D half must be optional. Perf: high on phone. Cx: M. Refs: *Original*. LÉLU: PROPOSED for desktop only (Cosmos Orbit already lets the scene show through the centre).

---

**Totals (counted from the labels above):**

| Label | Count | Concepts |
|---|---|---|
| BUILT | 11 | #1, #2, #11, #12, #18, #21, #31, #34, #37, #41, #53 |
| SUPPORTED / KEEP / EXISTING | 21 | #3, #4, #7, #9, #19, #20, #22, #23, #29, #32, #33, #35, #38, #39, #43, #44, #46, #47, #54, #55, #59 |
| PROPOSED | 15 | #14, #17, #25, #26, #27, #30, #36, #42, #45, #48, #50, #51, #52, #57, #60 |
| REJECT | 12 | #5, #6, #8, #10, #13, #15, #16, #24, #28, #49, #56, #58 |
| BLOCKED | 1 | #40 (no keyless calendar source) |

- The twelfth prototype, **LÉLU Central** (the default Home), combines #19 layered glass, #29 recents + pinned and #44 the activity-driven hero.
- #51 is the recommended next step.
- Nothing above is claimed as implemented unless it is BUILT or SUPPORTED, and those are backed by `tests/home-composition.test.ts` and `scripts/home/verify-home.mjs`.
