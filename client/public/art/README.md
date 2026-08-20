# Version art

Drop `version-hero.png` in here and the launcher picks it up. No code change,
no build step beyond the usual one.

Without the file the launcher shows a dashed "version art" placeholder rather
than a broken image, so a fresh clone still looks deliberate.

## Constraints

- **Aspect ratio 8:3.** The frame holds that ratio whatever the window does
  and crops with `object-fit: cover`, so keep anything important away from
  the extreme edges.
- **The bottom third is covered** by a dark gradient carrying the title and
  strapline. Put detail you want seen in the upper two thirds; the bottom
  should be quieter ground, sky, or water that reads fine half-hidden.
- **Pixel art, drawn with `image-rendering: pixelated`.** Author it small and
  let the browser scale it: **384×144** is plenty and stays crisp at any
  size. Do not pre-scale it in an editor with smoothing on — that blurs the
  hard edges the whole style depends on.
- Palette to match the game: grass `#5f9e46`, gold `#e6b64c`, sky-blue
  `#4a7fa8`, deep background `#0a0d13`, stone greys around `#6d6d70`.

## Prompt for PixelLab

It has to be **original work**. Blockcraft is its own game — no Minecraft
characters, mobs, logos, or recognisable landmarks, and nothing that reads as
a copy of somebody's key art. The prompt below describes this game's own
content: the NoVolt machines, the vehicles, the three dimensions.

> Wide pixel-art key art banner for an original voxel sandbox game. A blocky
> cubic landscape at golden hour: terraced green grass hills with square
> trees on the left, a sandy shore and blue water in the middle distance, tall
> stone cliffs on the right. In the foreground a small industrial setup built
> from cubes — a copper-coloured generator, glowing amber conduit cables
> running along the ground to a boxy machine, a conveyor belt carrying ore.
> A small propeller plane banks through the upper sky. Far right, a dark
> jagged portal frame glowing violet. Warm orange sunset sky with flat blocky
> clouds. Limited palette: leaf green, sand, slate grey, amber gold, deep
> navy shadow. Chunky visible pixels, hard edges, no anti-aliasing, no
> outlines around shapes, flat posterised shading in two or three tones per
> surface, isometric-leaning perspective. Detail concentrated in the upper
> two thirds; the lower third simple ground and water.

### Variations worth trying

Swap the middle clause to shift the emphasis:

- **Automation** — "a working factory of cubic machines: crusher, sawmill and
  quarry linked by glowing amber conduit, conveyor belts feeding ore into a
  hopper, a water wheel turning in a river"
- **Adventure** — "a caped figure on a rooftop overlooking the valley, a
  distant winged silhouette circling a pale spire under a starry sky"
- **The Nether** — "a cavern of dark red stone lit by lakes of lava, blocky
  fire, a stone bridge crossing the gap"

### Settings

- Size **384×144** if the tool takes an arbitrary size. If it only offers
  squares, generate **256×256** or **512×512** and crop to 8:3 — compose
  knowing the top and bottom will go.
- No outline / no border, if offered: the game's own art has none, and an
  outlined banner sits oddly against it.
- Low colour count, if offered — 16 to 32 reads closest to the in-game look.

### After generating

Save as `version-hero.png` in this folder and rebuild. Check it in the
launcher rather than in an image viewer: the crop, the title scrim over the
bottom third, and the turf strip along the base all change how it reads.
