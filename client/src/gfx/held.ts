/**
 * First-person held item.
 *
 * Builds a small mesh directly in view space each frame: a block as a
 * miniature of its own model (a held slab is a slab), a tool or any other
 * item as its icon extruded into a solid one texel thick, and an empty hand
 * as a bare arm. Animated by a swing timer and a walking bob.
 *
 * The geometry is cached per tile and per block in extrude.ts; this file
 * only decides where in the hand it goes.
 */

import { isBlockItem, itemDef, toolSpec } from '@shared/items.js';
import type { Atlas } from './atlas.js';
import {
  MeshWriter, chain, itemModel, rotX, rotY, rotZ, scale, translate, type Mat, type Model,
} from './extrude.js';

export interface HeldMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

export interface HeldState {
  /** Item id, or null for an empty hand. */
  item: number | null;
  /** 0..1 through the swing animation. */
  swing: number;
  /** Accumulated walk cycle phase, in radians. */
  bob: number;
}

/**
 * Items held like a tool -- gripped at the handle, head up and leaning away
 * -- rather than shown flat like a piece of food. The icons draw every one
 * of these handle bottom-left, head top-right.
 */
const TOOL_TILES = new Set(['bow', 'arrow', 'stick', 'flint_steel', 'shears', 'fishing_rod']);

export function heldAsTool(item: number): boolean {
  const def = itemDef(item);
  return toolSpec(item) !== undefined || (def.attack ?? 0) > 1 || TOOL_TILES.has(def.texture);
}

/** The bare arm: a long box of the 'hand' tile, built once. */
let armModel: Model | null = null;
function arm(): Model {
  if (armModel) return armModel;
  const quads: number[][] = [
    [0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1],
    [0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1],
    [1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0],
    [1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1],
    [0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0],
  ];
  const normals = [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]];
  armModel = {
    quads: 6,
    pos: new Float32Array(quads.flat().map((c) => c - 0.5)),
    uv: new Float32Array(Array.from({ length: 6 }, () => [0, 1, 1, 1, 1, 0, 0, 0]).flat()),
    normal: new Float32Array(normals.flat()),
    tiles: new Array(6).fill('hand'),
  };
  return armModel;
}

const writer = new MeshWriter();

/**
 * Where the item sits in view space, before the swing: the hand's grip
 * point, low on the right of the screen.
 */
export function heldTransform(state: HeldState, kind: 'tool' | 'item' | 'block' | 'hand'): Mat {
  const arc = Math.sin(state.swing * Math.PI);
  const hand = translate(
    0.5 + Math.sin(state.bob) * 0.012,
    -0.44 - arc * 0.2 + Math.abs(Math.cos(state.bob)) * 0.012,
    -0.8,
  );
  // The swing chops forward and down about the wrist.
  const chop = rotX(-arc * 1.2);
  switch (kind) {
    case 'tool':
      // Grip the handle a little up from its end, stand the diagonal
      // upright with the head leaning in toward the middle of the screen,
      // then turn the flat of the tool partly away so its thickness shows.
      return chain(hand, chop, translate(-0.04, 0, 0), rotY(-0.95), rotX(-0.2),
        rotZ(Math.PI / 4 + 0.2), scale(0.66), translate(0.3, 0.3, 0));
    case 'item':
      return chain(hand, chop, translate(-0.06, 0.08, 0), rotY(-0.55), rotX(-0.18), scale(0.5));
    case 'block':
      return chain(hand, chop, translate(-0.04, 0.08, 0), rotX(0.28), rotY(0.72), scale(0.34));
    case 'hand':
      // A forearm rising from the bottom of the screen, tipped away.
      return chain(hand, chop, translate(0.08, -0.16, 0.05), rotY(0.35), rotX(-0.75),
        [0.16, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0.16, 0]);
  }
}

export function buildHeldMesh(atlas: Atlas, state: HeldState): HeldMesh {
  writer.reset();
  const { item } = state;
  if (item === null) {
    writer.model(arm(), atlas, heldTransform(state, 'hand'), 1);
    return writer.finish();
  }
  const { model, block } = itemModel(atlas, item, isBlockItem(item));
  const kind = block ? 'block' : heldAsTool(item) ? 'tool' : 'item';
  writer.model(model, atlas, heldTransform(state, kind), 1);
  return writer.finish();
}
