# Where to pick up

## Open: dark horizontal lines on block faces

Real, reproducible, **not** caused by the lighting revamp — verified by A/B
test: with flat per-face lighting the artifact is worse (8 lines vs 3), so it
predates that work.

What is established:

- The dark pixels are `[7,5,3]` = the block's base colour x 0.06, which is
  exactly `AMBIENT_FLOOR` in `client/src/mesher.ts`. So the light there is 0.
- Sky light propagation is correct. Verified on real terrain: 15 through open
  air, 0 inside solid blocks, stepping down properly under overhangs.
- The dark faces border **enclosed air pockets** inside the terrain, whose
  air genuinely has sky light 0. Next to a face at 0.65 that is a 10x jump
  and reads as a hard black line.
- With every neighbouring chunk loaded the mesher emits exactly the right
  face count (256 for one exposed plane) and no dark vertices, so the culling
  itself is sound on flat ground.

**Atlas bleed is ruled out.** The edge-row check looked convincing --
`ender_face` sits directly above `grass_side` and its bottom row has
luminance 17, which shaded lands near the observed values -- but widening the
UV inset from a quarter texel to a half changed nothing, and widening it to
four texels made the artifact *worse*. A bleed fix cannot do that. The inset
was left at a half texel because that is the correct value for NEAREST
sampling and the comment already claimed it, but it fixes nothing here.

The unanswered question: **why are those pocket faces visible from outside at
all**, rather than hidden behind the surface geometry in front of them? That
is where to start. Get the camera right up against an affected wall and look
at point-blank range -- if the line survives that, it is geometry rather than
a distance or precision artifact.

Reproduce headlessly by meshing the real seed used during the investigation:

    new ClientWorld(59708, Dimension.Overworld)  // chunks (-1..1, 2..4)

and counting vertices with `light < 0.12` above y=50. It was 18.6% of surface
vertices.

## Done and verified this session

- Pointer lock recovery (`client/src/pointerlock.ts`). Two earlier attempts
  were wrong: the first latched a permanent verdict on one refusal, the
  second retried on a timer that could never succeed because capture needs a
  user gesture. There is now no permanent state -- every click asks again.
- Stone-button launcher, shipped and matching the design canvas.
- Touch build: mobile entry screen, on-screen controls, reduced defaults.
