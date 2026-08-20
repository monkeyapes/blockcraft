# Third-party notices

Blockcraft itself is MIT licensed — see [LICENSE](LICENSE). The game generates
every block and item texture in code and ships no image assets, so the list
below is short.

## Archivo (font)

Copyright 2020 The Archivo Project Authors,
<https://github.com/Omnibus-Type/Archivo>

Licensed under the **SIL Open Font License, Version 1.1**. The full licence
text is included at [licenses/Archivo-OFL.txt](licenses/Archivo-OFL.txt), as
the OFL requires when the font is redistributed.

The font is bundled rather than linked from a CDN because the desktop build
runs with no network, where a remote webfont would silently fall back. It
appears in the repository at:

- `client/src/fonts/archivo.woff2` — bundled into the game by Vite
- `site/fonts/archivo.woff2` — used by the marketing site

Reserved Font Name: **Archivo**. If you fork this project and modify the font
file itself, the OFL requires you to rename it; using it unmodified, as here,
carries no such requirement.

## Resource packs

Any Minecraft-style resource pack you load stays on your machine and is never
redistributed by this project. Those packs are their authors' work — please
respect the licence each one ships with.

## Not included

Blockcraft contains no code or artwork from Minecraft, and is not affiliated
with Mojang Studios or Microsoft.
