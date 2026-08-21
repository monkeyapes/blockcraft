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

## Server addresses

Servers are reached by a name -- `donutsmp.bc` -- rather than an IP, because
nobody shares an IP in a chat message and expects their friends to still have
it tomorrow.

**`.bc` is not a real top-level domain.** It resolves inside Blockcraft and
nowhere else: it will not ping, it will not open in a browser, and no DNS
server has heard of it. The game does the lookup itself, against
[`site/registry.json`](site/registry.json), which is published as a static
file on GitHub Pages -- free, and with no server that has to stay running.

A plain `host:port` always works too. The naming layer sits on top of
addressing and is never a dependency of it, so a registry outage cannot take
every server offline at once.

### Claiming a name

Open a pull request adding one entry to `site/registry.json`:

```json
{
  "version": 1,
  "servers": {
    "donutsmp": { "host": "82.14.203.11", "port": 8787, "title": "Donut SMP" }
  }
}
```

- 3 to 24 characters, `a-z`, `0-9` and hyphens; no leading, trailing or
  doubled hyphens.
- `port` defaults to 8787 and `title` is optional.
- A handful of names are reserved so that nobody can register the one a
  newcomer would assume is official.

Malformed entries are dropped individually rather than rejecting the whole
file, so one bad line cannot take everyone else's server down.

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

## Hosting a server

`Blockcraft Server` is a separate, optional download that runs a server on
your own machine. It is a window over the same server the project already
has -- nothing is reimplemented, so the world a server generates can never
drift from the world a client expects.

```bash
npm run host:dev       # the window, against a fake server
npm run host:package   # the installer
```

`host/prepare.mjs` stages the two things the app ships that are not its own
code: the server bundled to a single file, and a copy of the Node runtime
taken from whatever Node is building the project. Neither is committed -- an
80 MB binary in the repository would cost every clone for the benefit of the
one person building an installer.

**The thing to know before hosting:** your computer is behind a router, so a
server running on it is not reachable from outside your own network until you
either forward the port or run a tunnel. Both are free, and the app says so
rather than letting you find out when a friend cannot join. It will not show
you a LAN address as though it reached the internet.

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
