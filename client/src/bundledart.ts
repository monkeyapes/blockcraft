/**
 * Optional hand-picked art layered over the procedural atlas at startup.
 *
 * The game still generates every texture from code with zero assets by
 * default -- this is purely additive. Each name here is fetched from
 * public/textures/<name>.png if present; anything missing just keeps its
 * procedural tile, and deleting the folder entirely falls back to exactly
 * what shipped before this existed.
 */

/** Atlas tile names this layer knows how to override, if art exists for them. */
const BUNDLED_NAMES = [
  'diamond_ore', 'coal_ore',
  'pickaxe_wood', 'pickaxe_stone', 'pickaxe_iron', 'pickaxe_diamond',
  'sword_diamond',
];

export async function loadBundledArt(): Promise<Map<string, ImageBitmap>> {
  const out = new Map<string, ImageBitmap>();
  await Promise.all(BUNDLED_NAMES.map(async (name) => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}textures/${name}.png`);
      if (!res.ok) return;
      out.set(name, await createImageBitmap(await res.blob()));
    } catch {
      // No network, no file, or a corrupt image: that tile just stays
      // procedural, the same as any other name this layer doesn't cover.
    }
  }));
  return out;
}
