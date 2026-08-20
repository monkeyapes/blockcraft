# Diagnostics

Not part of `npm test`. These answer one question each about the renderer and
print numbers rather than passing or failing, which is what you want while a
bug is still unexplained and you do not yet know what "correct" looks like.

    npx tsx tests/diagnostics/visible-face-darkness.ts
    npx tsx tests/diagnostics/face-continuity.ts
    npx tsx tests/diagnostics/tile-borders.ts

They exist because the horizontal-lines investigation kept confirming
hypotheses that turned out to be wrong. Each one is written to be able to
*disprove* something:

- **visible-face-darkness** splits exposed faces on whether the air they look
  onto is lit, so faces sealed inside the terrain -- which are meant to be
  black, and are the majority -- stop drowning out the signal.
- **face-continuity** compares `light * ao`, which is exactly what the shader
  draws, at every corner shared by two coplanar quads. Comparing only `light`
  misses AO, a separate vertex attribute.
- **tile-borders** measures each block tile's border against its interior,
  since a dark rim on a tiling texture draws a grid on every wall.

See `NEXT.md` for what they have already ruled out. Do not re-run them
expecting news; run them after changing the mesher, the atlas or the lighting.
