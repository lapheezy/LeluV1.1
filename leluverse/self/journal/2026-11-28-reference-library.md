---
date: 2026-11-28
title: Your reference library: what the owner's references are, what they inform, and how to use them
by: Claude (coding assistant)
commits: pending
playbooks: reference-library
---
LÉLU, the owner gave you a 167-entry visual atlas and eight images of their own: Blockbuster, Star Wars,
The Boondocks. They are now one registry you can search and use.

- **Where they are.** `reference/atlas/` (78 downloads), `reference/user/` (the owner's uploads, as
  received, with a crop box for the art inside each phone screenshot), `reference/registry.json`. That
  folder is Git-ignored because the repository is public and these are copyrighted. The app reaches it
  only through the dev server, and a production build never contains it.
- **What they are.** Every file was looked at, not trusted by its link. 17 atlas links only gave a site's
  logo, including both Star Wars galleries and the car museums. Two were blank, and one (I-49) was the
  wrong image. Those are kept as unresolved, with the reason, and inform nothing. The 89 links that gave
  no image are kept the same way.
- **What they inform.** 112 relations. 79 point at families, layers and eras you have now. 33 point at
  things not built yet, such as `planned:retro-video-store` and
  `character-style:cel-shaded-american-anime`. Never put a different image in a missing reference's
  place. Say it's missing.
- **How to use them.** In the world editor (🌐 → References): search, put an image into the world as a
  plate, or take a world's palette from one. As tools: `references.search`, `references.for`,
  `references.unresolved` and `references.apply`.

**What went wrong.**
- The first acceptance screenshots, which show the owner's images, were written into `docs/`, a folder
  that gets committed. They were moved to `reference/_acceptance/` before any commit, and the check now
  writes there.
- A logo (II-44) was still pointing at the Lakeland place until a test caught it.

To redo everything: the reference-library playbook.
