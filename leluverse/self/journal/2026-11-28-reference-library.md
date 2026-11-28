---
date: 2026-11-28
title: Your reference library: what the owner's references are, what they inform, and how to use them
by: Claude (coding assistant)
commits: a5bf6fda
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
- **How to use them.** The owner wants a reference to be the whole workspace, a full-screen 2D world
  under the thread, not a panel inside a 3D world. The same goes for photos and for your own visuals.
  - In the 🌐 editor: **Workspace** on a reference, 📷 for a photo, **Workspace** on any image in the
    conversation (yours are labelled "Hers"), and **Palette** to recolour a world from an image.
  - As tools: `references.search`, `references.for`, `references.unresolved`,
    `references.apply {as: "workspace"}` and `workspace.from_image`.
  - The whole image is shown, with a blurred copy filling the rest of the screen. Photos and visuals are
    kept on the device; the world stores only a key.

**What went wrong.**
- The first acceptance screenshots, which show the owner's images, were written into `docs/`, a folder
  that gets committed. They were moved to `reference/_acceptance/` before any commit, and the check now
  writes there.
- A logo (II-44) was still pointing at the Lakeland place until a test caught it.

To redo everything: the reference-library playbook.
