/**
 * The fluids pack: water and lava that flow.
 *
 * Block.Water and Block.Lava (defined in blocks.ts) are the *sources*: the
 * still water of an ocean, a lake, a poured bucket. Everything this pack adds
 * is what a source spills: flowing water one step weaker per block it has
 * travelled, and a column falling straight down. A chunk stores one byte per
 * block with no room for a level beside it, so the level is part of the id,
 * the way a conveyor's facing is.
 *
 * Every state of one fluid shares a family with its source. Liquids are
 * already replaceable, so the server would take a level change anyway; the
 * family is what says, in data, that these are one thing -- and it keeps
 * the flowing states out of the creative menu's catalogue of blocks.
 *
 * This file is data plus a few id lookups the renderer, the physics and the
 * simulation all share. It imports values only from blockids.ts, like every
 * pack. How the fluids move is client/src/content/fluids.ts; the rules that
 * need the block registry (what a current washes away, which way it pushes)
 * are in shared/src/fluids.ts.
 */

import { Block } from '../blockids.js';
import type { BlockSpec, ContentPack } from './types.js';

// --- the two fluids ------------------------------------------------------------

export interface FluidKind {
  readonly name: 'water' | 'lava';
  readonly source: number;
  /** Flowing states, weakest last: flows[0] is level 1, one block from a source. */
  readonly flows: readonly number[];
  /** A column falling straight down: full strength, full height. */
  readonly falling: number;
  /** Seconds between updates of one cell: water is brisk, lava creeps. */
  readonly tick: number;
  /**
   * How far a spreading edge looks for somewhere lower to go. Water finds a
   * hole four blocks away and heads for it, which is what makes a stream run
   * to a cliff edge instead of spreading into a puddle.
   */
  readonly slopeDistance: number;
  /** Two sources beside each other over a floor make a third. */
  readonly infinite: boolean;
}

export const WATER_FLUID: FluidKind = {
  name: 'water',
  source: Block.Water,
  flows: [
    Block.WaterFlow1, Block.WaterFlow2, Block.WaterFlow3, Block.WaterFlow4,
    Block.WaterFlow5, Block.WaterFlow6, Block.WaterFlow7,
  ],
  falling: Block.WaterFalling,
  tick: 0.25,
  slopeDistance: 4,
  infinite: true,
};

export const LAVA_FLUID: FluidKind = {
  name: 'lava',
  source: Block.Lava,
  flows: [Block.LavaFlow1, Block.LavaFlow2, Block.LavaFlow3],
  falling: Block.LavaFalling,
  tick: 1.5,
  slopeDistance: 2,
  infinite: false,
};

export const FLUIDS: readonly FluidKind[] = [WATER_FLUID, LAVA_FLUID];

/** A falling state's level: it feeds its neighbours as strongly as a source. */
export const FALLING_LEVEL = 0;

// --- per-id lookups ----------------------------------------------------------------
//
// Flat tables over the byte a chunk stores, because the mesher asks these
// questions for every liquid cell it draws and the physics for every body
// every frame.

/** 0 not a fluid, 1 water, 2 lava. */
const KIND = new Uint8Array(256);
/** 0 for a source or a falling column, else the flowing level. */
const LEVEL = new Uint8Array(256);
const SOURCE = new Uint8Array(256);
const FALLING = new Uint8Array(256);
/** Surface height of each state, as a fraction of the block. */
const HEIGHT = new Float32Array(256);

/**
 * A source's surface sits a little below the top of its cell -- the lip you
 * see at the edge of a lake -- and each level down is a step lower. Water
 * drops one ninth a level and lava, with half as many levels, two ninths, so
 * the thinnest edge of either is a sliver rather than nothing.
 */
export const SOURCE_HEIGHT = 8 / 9;

for (const [n, f] of FLUIDS.entries()) {
  const kind = n + 1;
  const step = 8 / (f.flows.length + 1);
  KIND[f.source] = kind;
  SOURCE[f.source] = 1;
  HEIGHT[f.source] = SOURCE_HEIGHT;
  KIND[f.falling] = kind;
  FALLING[f.falling] = 1;
  HEIGHT[f.falling] = 1;
  f.flows.forEach((id, i) => {
    KIND[id] = kind;
    LEVEL[id] = i + 1;
    HEIGHT[id] = (8 - step * (i + 1)) / 9;
  });
}

export function fluidOf(id: number): FluidKind | null {
  const k = KIND[id & 255];
  return k === 0 ? null : FLUIDS[k - 1];
}

/** Are these two ids states of the same fluid? False if either is not a fluid. */
export function sameFluid(a: number, b: number): boolean {
  const k = KIND[a & 255];
  return k !== 0 && k === KIND[b & 255];
}

export function isWater(id: number): boolean {
  return KIND[id & 255] === 1;
}

export function isLava(id: number): boolean {
  return KIND[id & 255] === 2;
}

/** Still water or lava: the only thing a bucket can scoop up. */
export function isFluidSource(id: number): boolean {
  return SOURCE[id & 255] === 1;
}

export function isFalling(id: number): boolean {
  return FALLING[id & 255] === 1;
}

/** Any state that is not a source: what flows, falls and dries up. */
export function isFlowing(id: number): boolean {
  return KIND[id & 255] !== 0 && SOURCE[id & 255] === 0;
}

/**
 * How far this state is from its source, as the flow rule counts it:
 * 0 for a source and for a falling column (both feed at full strength),
 * 1..n for flowing water or lava. -1 for anything that is not a fluid.
 */
export function fluidLevel(id: number): number {
  return KIND[id & 255] === 0 ? -1 : LEVEL[id & 255];
}

/** Surface height of a fluid state within its cell, 0..1. 0 for non-fluids. */
export function fluidHeight(id: number): number {
  return HEIGHT[id & 255];
}

// --- blocks --------------------------------------------------------------------------

/**
 * Flowing states are liquids like their source -- you swim in them, a
 * block placed into one simply replaces it -- but nobody mines a stream,
 * it drops nothing, and it is not something you can pick from the creative
 * menu: you pour a source and let it run.
 */
function flowingSpec(id: number, name: string, fluid: FluidKind, texture: string): BlockSpec {
  const lava = fluid.name === 'lava';
  return {
    id, name, textures: [fluid.name, fluid.name, texture],
    solid: false, opaque: false, translucent: true, liquid: true,
    breakable: false, hardness: 0,
    light: lava ? 15 : 0,
    replaceable: true,
    family: fluid.name,
    drops: () => [],
  };
}

const BLOCKS: BlockSpec[] = [
  ...WATER_FLUID.flows.map((id) => flowingSpec(id, 'Flowing Water', WATER_FLUID, 'water_flow')),
  flowingSpec(Block.WaterFalling, 'Falling Water', WATER_FLUID, 'water_flow'),
  ...LAVA_FLUID.flows.map((id) => flowingSpec(id, 'Flowing Lava', LAVA_FLUID, 'lava_flow')),
  flowingSpec(Block.LavaFalling, 'Falling Lava', LAVA_FLUID, 'lava_flow'),
];

export const FLUIDS_PACK: ContentPack = {
  name: 'fluids',
  blocks: BLOCKS,
  items: [],
  shapes: [],
  recipes: [],
  smelting: [],
  fuel: [],
  // What water and lava leave where they meet. Liquids are replaceable, so
  // the server already accepts these; they are listed so the rule is stated
  // where the fluids are, and tests/content.ts checks each one.
  transitions: [
    [Block.Lava, Block.Obsidian],
    ...[...LAVA_FLUID.flows, Block.LavaFalling].map((id): [number, number] => [id, Block.Cobblestone]),
    ...[...LAVA_FLUID.flows, Block.LavaFalling].map((id): [number, number] => [id, Block.Stone]),
    ...[Block.Water, ...WATER_FLUID.flows, Block.WaterFalling].map((id): [number, number] => [id, Block.Stone]),
  ],
};
