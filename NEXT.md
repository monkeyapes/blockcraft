# Where to pick up

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

### The blocker, and how to remove it

The decisive test is a single flat surface filling the frame, where *any* line
is an artifact. That needs a known camera pose, and the camera cannot be
driven from automation: pointer lock requires a real user gesture, and an
automated click does not satisfy it. Nothing is exposed on `window` either.

**Suggested fix: a debug pose parameter** -- `?pose=x,y,z,yaw,pitch` -- that
places the camera without pointer lock. That makes the artifact reproducible
on demand instead of depending on flying to the right spot by hand, and it
would pay for itself the first time anyone investigates a rendering question
again.

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
