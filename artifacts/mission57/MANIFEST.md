# Mission 5.7 — evidence manifest

All screenshots are of the real application (vite dev server, port 5180) driven
by `scripts/asre/m57-chat-surface.cjs`. Nothing is a mock or a placeholder.

| File | What it shows |
| --- | --- |
| 00-home.png | the app as it boots, before anything is opened |
| 01-chat-universe.png | Chat Universe open without an account |
| 02-conversation.png | a conversation window, empty |
| 03-surface-summoned.png | the surface LÉLU's `asre.reconstruct` put in the thread |
| 04-reconstruction-in-chat.png | the reconstruction in three.js inside the chat, with the evidence bar (OBSERVED 1,405 / INFERRED 9,155 / GENERATED 10,560, 15,860 triangles) |
| 05-numerical-in-chat.png | voxel inspection in the chat: 64×64×64 lattice, plane 32 of 63, 5,164 boundary cells, mean fused confidence 0.524 |
| 06-character-in-chat.png | the persistent character and its v0002 (hair → afro) with a live render |
| 07-restored-in-chat.png | the restore of the hair group as a new version |
| 08-export-in-chat.png | the exported asset in the Forge panel, with the Forge's ASRE history |
| 09-after-reload.png | the same conversation after a full page reload: the surfaces are still there |
| results.json | every check, the tool outputs, page errors, and the screenshot list |

Code commit: `8adaf34b` (summon bus, in-chat surface, tool summons).
Evidence commit: the commit that added this file.

Reproduce:

```
LELU_ASRE_ROOT=/tmp/m57/asre FORGE_ASSET_ROOT=/tmp/m57/assets \
LELU_TOOLS=$HOME/lelu-tools LELU_BLENDER_BIN=$HOME/lelu-tools/blender-4.2.23-linux-x64/blender \
LD_LIBRARY_PATH=$HOME/libs/usr/lib/x86_64-linux-gnu \
npx vite --host 0.0.0.0 --port 5180 --strictPort

FONTCONFIG_FILE=$HOME/m57fonts/etc/fonts.conf FONTCONFIG_PATH=$HOME/m57fonts/etc \
LD_LIBRARY_PATH=$HOME/libs/usr/lib/x86_64-linux-gnu \
node scripts/asre/m57-chat-surface.cjs
```
