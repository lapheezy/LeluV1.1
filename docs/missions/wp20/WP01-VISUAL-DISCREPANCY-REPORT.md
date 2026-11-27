# WP20 · WP01 — Visual discrepancy report

Comparison image: `shots/01-wp01-reference-vs-current.png`. Each owner reference (A–E) is shown beside the build at 38517ccb.

## Across all variants

| # | References | Current | Consequence for WP20 |
|---|---|---|---|
| 1 | **Full-bleed environment.** The thread *is* the screen: LÉLU wordmark with an orbit, status chips, the conversation and objects in one composition | A chat **window** inside Chat Universe, with window chrome, a 15-tab stage bar, the home sidebar and the workspace bar all visible | An immersive Thread mode that owns the screen. Tabs become one compact control, and there is an exit back to the window |
| 2 | **Luminous liquid edges.** Thick flowing strokes graded purple → gold → electric blue, a specular highlight on the top edge, a bloom outside and a soft inner glow | 1 px flat purple outline with an even glow | A gradient-stroke liquid frame (border-box gradient with a mask), animated hue drift, highlight, a two-colour bloom and inner light |
| 3 | **Content-rich objects.** Every object shows its media (video frame, map, images, chart) edge to edge | Mostly empty dark panes. Maps render small inside a lot of chrome; header chips take a third of the height | Content fills the object. Controls become a slim overlay that appears on hover or focus |
| 4 | **Atmosphere.** Nebula depth, falling droplets, light trails, a glowing pool of concentric gold/purple/blue rings | Flat dark gradient, a few thin rain lines, three thin ellipses | A layered backdrop: depth gradients, a particle field, drips falling *from objects*, and a luminous ripple pool |
| 5 | **Header.** LÉLU wordmark, status chips (Live · Researching · Browsing · Creating · 3D · Saving), notifications/3D/fullscreen icons | Window title "NEURAL MAPS STUDY" plus browser-style tabs | A thread header with the real status chips (from the conversation's processing state and activity) and the variant switcher |
| 6 | **Composer.** A glowing pill with attach, image, mic, Stop and a waveform | The plain window composer | An in-environment composer using the same send path (`lelu-universe-send`) and the real Stop (`cancelTurn`) |
| 7 | **Companion integrated.** Her portrait lit by the scene, top-left or top-centre, part of the composition | A 3D full-body figure in a grey box | Her spot gets a lit, haloed stage (portrait framing for the side spots, an orb in Raindrop) |

## Per variant

| Variant | Reference | Current | Target |
|---|---|---|---|
| A Raindrop | Teardrops with **pointed tops**, hanging on liquid strands *from the reply bubble*, **filled with media**, dripping into a glowing pool; side rail of glowing nodes | Near-circles holding clipped text, strands from nowhere, a faint pool | Real teardrop geometry (scalable SVG mask and gradient outline), refraction (backdrop blur, saturate, highlight), strands from LÉLU's reply, a luminous pool with a ripple at each landing; the scrollbar becomes a glowing spine with nodes |
| B Liquid workspace | Organic blobs of different sizes overlapping into a flowing composition; the 3D scene as a central dome; chat column right with an activity checklist | Uniform small panes in a grid, a narrow chat column | Size by importance (the focus object large and central, others orbit), organic radii, connecting light trails, the chat column with her live steps |
| C Ribbon | Each object wrapped in a **flowing liquid ribbon** that crosses the thread; a spine on the right with progress nodes; asset bar | Flat wide rectangles | A ribbon frame (asymmetric radii, a crossing outer stroke, a spine and nodes), a toolbar strip per object, the assets-ready bar |
| D Live | LÉLU card with real step progress; "LÉLU Live" panel with progress bars; centre 2×2 of rich media; tool dock | An empty "No steps" panel, small panes | Her steps and Live panel fed by the conversation's real activity (empty states styled), a centre 2×2 with large media, a tool dock |
| E Chat + browser | 50/50: chat with research cards; a live browser pane with address bar | Chat left, a map right, tabs | The focus pane gets browser chrome (address, back/reload) for web objects; research cards in the chat side |

## Not a discrepancy, to keep
- Real data: maps from the live aspects; feed order, sink and scrub from the real feed state; persistence.
- Companion never over content; reduced-motion respected.

## Functional blocker affecting visuals
- YouTube search through the app's relay returned **503**, so no video frame appears yet (reference A, B and C all centre on a video). WP20 investigates this before the final screenshots.
