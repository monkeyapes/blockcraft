/**
 * The vocabulary block models are written in.
 *
 * No imports, so a content pack can build shapes without importing the
 * registry that loads it (see blockids.ts for why that matters).
 *
 * Coordinates are 0..1 inside the cell, y up. North is -z, east +x, south
 * +z, west -x -- the same convention the conveyors use.
 */

/**
 * An axis-aligned box in cell-local space.
 *
 * `tex` overrides the block's own textures for this one box, as a single
 * tile name for every face or [top, bottom, side]. A campfire's logs and its
 * flames, or a door's frame and its window, are different boxes of the same
 * block with different art.
 */
export interface Box {
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
  tex?: string | [string, string, string];
}

/**
 * The block at an offset from the cell being shaped.
 *
 * A fence reaches toward the fences beside it, a pane joins its neighbours,
 * a door knows whether it is the top or the bottom half. Shapes that depend
 * on neighbours get one of these; `around(0, -1, 0)` is the block below.
 */
export type Around = (dx: number, dy: number, dz: number) => number;

/** A shape that is either fixed or worked out from the neighbours. */
export type Shape = Box[] | ((around: Around) => Box[]);

/**
 * Everything a block's geometry has to answer, which is three different
 * questions:
 *
 *  - what is drawn            (visual)
 *  - what a body bumps into   (collision)
 *  - what the cursor hits     (selection)
 *
 * They usually agree, and each defaults to the one before it. They are
 * allowed to differ because the game needs them to: a fence is drawn one
 * block tall but blocks you at one and a half so nothing jumps it; a flower
 * is drawn as crossed planes, has no collision at all, and is selected by a
 * small box around its stem.
 */
export interface ShapeEntry {
  visual?: Shape;
  /** Defaults to `visual`. Only consulted for blocks that are solid. */
  collision?: Shape;
  /** Defaults to `visual`, or for a cross to a box round the plant. */
  selection?: Shape;
  /**
   * Draw as two crossed planes rather than boxes -- grass, flowers, crops,
   * saplings. The block's side texture is drawn on both planes.
   */
  cross?: boolean | { height?: number; inset?: number };
}

/** A box given in sixteenths, which is how block art is authored. */
export function px(
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  tex?: Box['tex'],
): Box {
  const box: Box = { x0: x0 / 16, y0: y0 / 16, z0: z0 / 16, x1: x1 / 16, y1: y1 / 16, z1: z1 / 16 };
  if (tex !== undefined) box.tex = tex;
  return box;
}

/** A slab of the given height, sitting on the cell floor. */
export function slab(height: number): Box[] {
  return [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: height, z1: 1 }];
}

/** A square post running the full height, inset from the cell walls. */
export function post(inset: number): Box[] {
  return [{ x0: inset, y0: 0, z0: inset, x1: 1 - inset, y1: 1, z1: 1 - inset }];
}

/** Facings, as quarter turns clockwise from north seen from above. */
export const NORTH = 0;
export const EAST = 1;
export const SOUTH = 2;
export const WEST = 3;

/** Unit step for a facing, as [dx, dz]. */
export const FACING_STEP: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [1, 0], [0, 1], [-1, 0],
];

/**
 * Turns a shape authored facing north to face another way.
 *
 * Author once, rotate three times: stairs, doors and gates all come in four
 * facings, and four hand-written copies are four chances to get one wrong.
 */
export function rotateBoxes(boxes: Box[], quarterTurns: number): Box[] {
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0) return boxes.map((b) => ({ ...b }));
  return boxes.map((b) => {
    let { x0, z0, x1, z1 } = b;
    for (let i = 0; i < turns; i++) {
      // (x, z) -> (1 - z, x): the north edge (z = 0) lands on the east edge.
      const nx0 = 1 - z1;
      const nx1 = 1 - z0;
      const nz0 = x0;
      const nz1 = x1;
      x0 = nx0; x1 = nx1; z0 = nz0; z1 = nz1;
    }
    return { ...b, x0, x1, z0, z1 };
  });
}

/** Moves boxes by a whole-cell-fraction offset. */
export function shiftBoxes(boxes: Box[], dx: number, dy: number, dz: number): Box[] {
  return boxes.map((b) => ({
    ...b, x0: b.x0 + dx, x1: b.x1 + dx, y0: b.y0 + dy, y1: b.y1 + dy, z0: b.z0 + dz, z1: b.z1 + dz,
  }));
}
