# Launcher design canvas

Working files for the stone-button launcher design, published as a Claude
Design canvas. `blockcraft-launcher.html` is the seeded, publishable page;
everything else is the source it is built from.

- `Main.dc.html` — the launcher's Play screen
- `Multiplayer.dc.html` — the Multiplayer screen
- `Buttons.dc.html` — the stone button system, every state and variant
- `canvas.json` — artboard layout and the notes on the canvas
- `*.png` — block textures exported from the game's own atlas, so the
  mockups use the real art rather than an approximation

To change the design: edit the `.dc.html` files, re-seed, and republish to
the same artifact URL. The seeded output is generated — never edit it by hand.

The design is implemented in the game itself in `client/src/style.css`
(the `--bevel*` tokens and the `.btn` family) and `client/src/ui/skin.ts`
(which paints the block textures in as CSS variables at startup).
