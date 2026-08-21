# Where to pick up

## Next up: `.bc` addresses and a hosting app

Asked for, agreed, and started. `shared/src/address.ts` exists and is
complete as a module, but it is **not wired to anything and has no tests
yet** -- that is step one, not a leftover.

### What `donutsmp.bc` costs to make real

`.bc` is not a real top-level domain and never will be. It resolves inside
Blockcraft and nowhere else: it will not ping, it will not open in a browser,
and no DNS server has heard of it. That is normal for a game, and it is why
the game has to do the lookup itself.

A memorable name has to resolve *somewhere*, so something has to hold the
mapping. The free option that needs no server kept running: a `registry.json`
published on the GitHub Pages site that already exists. A name is claimed by
adding a line to it. If the registry cannot be reached, direct `host:port`
addresses keep working -- naming sits on top of addressing and must never
become a dependency of it.

### The order to build it

1. **Tests for `address.ts`.** Parsing is where this fails quietly: a name
   that only nearly matches resolves to nothing, and the error looks like the
   server being down rather than like a typo.
2. **Publish `site/registry.json`** and teach the client to fetch and cache
   it. Handle unreachable, malformed, and unknown-name separately -- they need
   different messages.
3. **Wire it into the multiplayer pane**, replacing the raw address box.
4. **The hosting app.** A second Tauri exe wrapping the existing server, with
   a UI: start/stop, the address to share, who is connected, a log, and world
   selection.

### The part to be honest about up front

A home PC is behind NAT, so *hosting is not free of effort even though it is
free of cost*. There are two ways out and the app should say so plainly
rather than letting someone discover it when nobody can join:

- **Port forwarding** -- free, no third party, needs router access.
- **A free tunnel** (playit.gg, Cloudflare Tunnel, ngrok all have free
  tiers) -- no router access needed, and gives a public address the registry
  can point at.

The host app should detect which situation the user is in and offer the
matching path, because "why can nobody join my server" is the question that
kills self-hosting.

## Open: the hosting app's Start button, in a packaged install

Everything under it is verified. The bundled Node runtime runs the bundled
server, a real client connects to it, and a multiplayer session works end to
end -- server log `[net] Tester joined (1 online)`, client HUD `players 1
online`, matching seeds on both sides. The window's own lifecycle, address
ranking, port validation and log handling are covered against a fake backend.

What is **not** verified is the one seam between them: clicking Start in the
packaged app, and the Tauri event plumbing that carries the server's output
back to the window.

Two things block automating it, and neither is the app's fault:

- Screen automation resolves applications through the Start menu, so it
  cannot see an app running out of `target/release`.
- Installing it first stalls: the NSIS installer raises a UAC prompt, and
  Windows blocks input to elevated processes from anything lower, so a
  silent install cannot be completed unattended either.

**To close it:** install `Blockcraft Server_0.2.0_x64-setup.exe`, open it,
press Start. Expected: the pill turns green, the log fills with the same
lines the server printed above, and an address appears marked as reachable on
your network only. If the pill stays on "Starting…" the resource paths are
wrong; if it flips to "Failed" the log will say why.

## Open: horizontal lines on block faces

Still unsolved. This session eliminated most of the field, including the
hypothesis the previous session was built on, so read the eliminations before
spending time here.

### The old metric was measuring the wrong thing

The previous note leaned on "18.6% of surface vertices have light < 0.12" and
concluded the artifact came from faces bordering enclosed air pockets. That
number is real but it is **not evidence of a bug**: a face sealed inside the
terrain is supposed to be black, and 55.6% of exposed faces in the sample
chunk look onto sealed air. The metric counted correct behaviour.

The discriminating question is narrower: *is any face that a player can see
too dark?* Split faces on whether the voxel they look onto has any light in
it, and only report the visible ones.

Answer, seed 59708, chunk (0,3), full column:

    exposed faces:      2232
      onto sealed air:  1240  (55.6%)  hidden, darkness expected
      onto lit air:      992  (44.4%)  a player can see these
    VISIBLE faces at the ambient floor: 0  (0.00%)

**Zero.** No face a player can see is black. The lighting engine does not
produce this artifact.

### Ruled out this session

- **Section boundaries.** The dark rate is flat across `Y mod 16`; the
  apparent clustering at y=50..53 was just the bottom edge of a `y > 50`
  filter. Sections are innocent.
- **Lighting seams between adjacent quads.** Every corner shared by two
  coplanar quads was compared, for `light * ao` -- which is exactly what the
  fragment shader draws, `vShade = aLight * aAO`. 2905 shared corners, **0**
  disagreements, worst spread 0.000. The surface is provably continuous.
  (Comparing only `light` would have missed AO, which is a separate vertex
  attribute at index 6. Compare the product.)
- **Texture rims.** Every block tile's border row was measured against its
  interior. Only `log_top` is darker (-24), which is the deliberate bark ring
  on a cut log. Nothing else exceeds ±13.
- **Mipmap bleed.** There are no mipmaps: the atlas is `NEAREST`/`NEAREST`
  with `CLAMP_TO_EDGE`.
- **Same-id face culling.** The mesher drops a face when the neighbour is the
  same block id. It is the only rule that can remove a face a player would
  have seen through, but no see-through blocks occur in the sample chunk, so
  it never fires there.
- **Atlas bleed** (previous session). Widening the UV inset from a quarter
  texel to a half changed nothing; four texels made it *worse*. A bleed fix
  cannot do that.

### What is left

The geometry and the shading inputs are both provably clean, so the remaining
candidates are on the GPU side or in the camera:

- Z-fighting or precision between adjacent chunk meshes at distance.
- A rasterisation artifact at particular camera angles.
- Or: what was seen is the intended per-face shading (top 1.0, sides 0.8 and
  0.65, bottom 0.5) reading as banding on terraced terrain, which is a design
  question rather than a bug.

A frame captured from the live build did show 30 rows 8-11 luminance darker
than their neighbours -- but that detector cannot separate an artifact from a
legitimate terrace step, where a top face genuinely meets a side face 35%
darker. It needs a flat surface to be meaningful.

### The blocker is gone: `?pose=` and `?seed=`

The decisive test is a single flat surface filling the frame, where *any* line
is an artifact. That needed a known camera pose, and the camera could not be
driven from automation -- pointer lock requires a real user gesture, and a
synthetic click does not satisfy it.

Both parameters now exist, so a finding can carry the URL that shows it:

    /play/?seed=59708&pose=8,72,8,0,-89.9        x,y,z,yaw,pitch in degrees
    /play/?seed=59708&pose=8,72,8                keep the current facing

`?pose=` places the camera and holds it there -- flying on, vertical speed
zeroed, and the usual drop-onto-solid-ground step suppressed, since a pose
that falls somewhere else on load is not a pose. `?seed=` pre-fills the seed
box, because a pose without a seed points at whatever terrain the next random
world happens to make. Parsing is in `client/src/pose.ts` and refuses anything
it cannot use exactly, rather than half-applying it; `tests/pose.ts` covers
that with 28 checks.

**Known limit:** the same URL reproduces the same world and the same camera,
but not the same *frame* -- time of day still advances, so two runs differ in
overall brightness. Compare geometry and relative row-to-row variation, not
absolute pixels. A `?time=` parameter would close that if frame-exact
comparison is ever needed.

### A warning about which surface to test on

The first attempt used water, and the result was worthless: water is
translucent, so it brightens over shallow sand, and the `water` tile has 17
luminance of row variation of its own. Both were mistaken for banding.

**Use an opaque, uniform surface** -- a stone plateau, or a platform built for
the purpose. Check the tile's own row variation first with
`tests/diagnostics/tile-borders.ts`, and subtract it before believing
anything.

Reproduce the headless analyses with:

    npx tsx tests/diagnostics/visible-face-darkness.ts
    npx tsx tests/diagnostics/face-continuity.ts
    npx tsx tests/diagnostics/tile-borders.ts

They are kept in `tests/diagnostics/`, out of `npm test`, because each one is
written to *disprove* something rather than to pass. See the README there.

## Done and verified

- Published: <https://github.com/monkeyapes/blockcraft>, site live at
  <https://monkeyapes.github.io/blockcraft/>, v0.1.0 installer attached and
  downloading, MIT licensed with the Archivo OFL shipped alongside.
- Pointer lock recovery (`client/src/pointerlock.ts`). Two earlier attempts
  were wrong: the first latched a permanent verdict on one refusal, the
  second retried on a timer that could never succeed because capture needs a
  user gesture. There is now no permanent state -- every click asks again.
- Stone-button launcher, shipped and matching the design canvas.
- Touch build: mobile entry screen, on-screen controls, reduced defaults.
- The web build is path-portable (`base: './'`), so it works at a domain root
  and at `/play/`. Absolute asset paths 404 in the subdirectory case.
