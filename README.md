# Blockcraft

An original voxel sandbox: generate a world from a seed, mine and build in it,
automate it with **NoVolt**, and finish it against the dragon in the End.

Written from scratch in TypeScript — a hand-written WebGL2 renderer, no game
engine, and no image assets at all: every built-in texture is generated from
code at startup.

**[Play in your browser](https://monkeyapes.github.io/blockcraft/play/)** ·
**[Download for Windows](https://github.com/monkeyapes/blockcraft/releases/latest)**

## What is in it

- **Terrain as a pure function of its seed**, so every player generates the same
  world independently and only edits cross the network. That is what makes
  multiplayer cheap enough to run from home.
- **Survival**: four tool and armour tiers, crafting with a recipe book, hunger
  that gates healing, mobs after dark, beds that skip the night.
- **Three dimensions** and a real ending: Nether → blaze rods and ender pearls →
  eyes of ender → the End, and a dragon at the far side.
- **NoVolt**, the automation layer. Energy has *pressure*, and pressure falls off
  with conduit distance and with load — so where you put a generator matters,
  and an overloaded network slows down rather than blacking out.
- **Six vehicles**: skateboard, car, truck, boat, plane, helicopter.
- **Resource packs**: drop in any Minecraft-style pack and it loads at its own
  resolution.
- **Desktop and browser**, with touch controls on a phone.

## Running it

```bash
npm install
npm run dev          # client + server
npm test             # 740 checks
npm run build
```

Desktop build (needs the Rust toolchain and the Tauri CLI):

```bash
npm run desktop:build
```

The installer lands in `desktop/src-tauri/target/release/bundle/nsis/`.

## Debug parameters

The browser build takes two query parameters, which exist so a rendering
question can be reproduced from a link instead of by flying there and hoping:

| Parameter | Effect |
|---|---|
| `?pose=x,y,z,yaw,pitch` | Places the camera exactly and holds it there. Angles in degrees, and optional -- `?pose=x,y,z` keeps the current facing. |
| `?seed=...` | Pre-fills the seed box, so the pose refers to the world it was recorded in. |

    /play/?seed=59708&pose=8,72,8,0,-89.9

Same world, same camera, every time. Time of day still advances, so two runs
differ in brightness -- compare geometry, not absolute pixels.

## Layout

| Path | What it is |
|---|---|
| `client/` | The game: renderer, world, machines, UI |
| `server/` | Authoritative multiplayer server |
| `shared/` | Terrain, blocks, items, recipes, NoVolt — used by both |
| `desktop/` | Tauri wrapper for the Windows build |
| `site/` | The marketing site, deployable to GitHub Pages |
| `design/` | Design canvas source for the launcher |
| `tests/` | The test suite |

## Licence

MIT — see [LICENSE](LICENSE). Use it, fork it, sell it; just keep the notice.

The one third-party thing in the repository is the Archivo font, which is under
the SIL Open Font License. Details and the full text are in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Credits

Blockcraft is an original voxel sandbox, heavily inspired by **Minecraft** by
Mojang Studios. It is not affiliated with, endorsed by, or connected to Mojang
or Microsoft in any way, and shares no code or artwork with it.

Resource packs you load are the work of their authors, stay on your machine, and
are never redistributed here. Please respect each pack's licence.
