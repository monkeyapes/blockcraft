//! The block and item table, read from `assets/content.json`.
//!
//! The TypeScript registries are the source of truth; `tools/export-native.ts`
//! flattens them into JSON with every texture already resolved to an atlas
//! slot, so nothing here has to know a texture's name or how the atlas was
//! laid out. The file format is documented in native/README.md.
//!
//! At load time the JSON is turned into [`BlockTable`], which answers the
//! questions the hot loops ask -- is this id opaque, what boxes does it draw
//! -- with plain array indexing. The mesher asks "is it opaque" several
//! times per vertex; a hash lookup or an `Option` chase there would be most
//! of its cost.

use std::path::Path;

use serde::Deserialize;

/// The JSON format this build understands. Must match `FORMAT` in
/// tools/export-native.ts; a mismatch means the export is newer or older than
/// the code, and reading it anyway would silently misplace fields.
pub const FORMAT: u32 = 1;

/// The exported files, compiled in so the executable runs from anywhere
/// without an assets folder beside it. `--assets <dir>` overrides them, which
/// is how a fresh export is tried without rebuilding.
pub const EMBEDDED_CONTENT: &str = include_str!("../../assets/content.json");
pub const EMBEDDED_ATLAS: &[u8] = include_bytes!("../../assets/atlas.png");

#[derive(Debug, Deserialize)]
pub struct ContentFile {
    pub format: u32,
    pub atlas: AtlasInfo,
    pub blocks: Vec<BlockJson>,
    pub items: Vec<ItemJson>,
}

#[allow(dead_code)] // tile_px: part of the format, for tools and Phase 2 UI
#[derive(Debug, Deserialize, Clone)]
pub struct AtlasInfo {
    pub file: String,
    /// Tiles per row (and per column; the atlas is square).
    pub grid: u32,
    /// Pixels per tile edge.
    pub tile_px: u32,
    /// Atlas edge in pixels, `grid * tile_px`.
    pub size: u32,
    /// Tile names in slot order, for debugging and for tools.
    pub tiles: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct BlockJson {
    pub id: u8,
    pub name: String,
    /// Atlas slots for [top, bottom, side].
    pub textures: [u16; 3],
    pub icon: u16,
    pub solid: bool,
    pub opaque: bool,
    pub translucent: bool,
    pub liquid: bool,
    pub breakable: bool,
    pub light: u8,
    pub hardness: f32,
    pub replaceable: bool,
    pub climbable: bool,
    pub slipperiness: f32,
    pub speed_factor: f32,
    pub bounce: f32,
    pub cross: Option<Cross>,
    pub shape: Option<ShapeJson>,
}

#[derive(Debug, Deserialize, Clone, Copy, PartialEq)]
pub struct Cross {
    pub height: f32,
    pub inset: f32,
}

#[derive(Debug, Deserialize)]
pub struct ShapeJson {
    pub visual: Vec<BoxJson>,
    pub collision: Vec<BoxJson>,
    pub selection: Vec<BoxJson>,
    /// The shape depends on neighbours (fences, panes, doors). The boxes
    /// above are how it looks standing alone; neighbour-aware shapes are a
    /// later phase.
    pub dynamic: bool,
}

#[derive(Debug, Deserialize, Clone, Copy)]
pub struct BoxJson {
    pub min: [f32; 3],
    pub max: [f32; 3],
    /// Per-box texture slots [top, bottom, side], overriding the block's own.
    pub tex: Option<[u16; 3]>,
}

/// Items are read and checked now, and used by the inventory in Phase 2.
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct ItemJson {
    pub id: u16,
    pub name: String,
    pub icon: u16,
    pub stack: u32,
    pub places: Option<u16>,
}

/// A box in cell-local space, 0..1 on each axis.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Aabb {
    pub min: [f32; 3],
    pub max: [f32; 3],
}

impl Aabb {
    pub const FULL: Aabb = Aabb {
        min: [0.0; 3],
        max: [1.0; 3],
    };
}

/// One box of a block's drawn model, with the textures its faces show.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ModelBox {
    pub aabb: Aabb,
    pub textures: [u16; 3],
}

/// Everything the game knows about one block id.
///
/// `hardness` (mining time) and `dynamic` (neighbour-aware shapes) are
/// carried for Phase 2; creative-style instant breaking and stand-alone
/// shapes need neither yet.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct BlockInfo {
    pub name: String,
    pub textures: [u16; 3],
    pub icon: u16,
    pub known: bool,
    pub solid: bool,
    pub opaque: bool,
    pub translucent: bool,
    pub liquid: bool,
    pub breakable: bool,
    pub light: u8,
    pub hardness: f32,
    pub replaceable: bool,
    pub climbable: bool,
    pub slipperiness: f32,
    pub speed_factor: f32,
    pub bounce: f32,
    pub cross: Option<Cross>,
    /// Drawn boxes. Empty for air and for crossed-plane plants.
    pub visual: Vec<ModelBox>,
    /// What a body bumps into. Only consulted when `solid`.
    pub collision: Vec<Aabb>,
    /// What the cursor hits and outlines.
    pub selection: Vec<Aabb>,
    pub dynamic: bool,
    /// Fills its cell, so the cheap paths apply.
    pub full_cube: bool,
}

impl BlockInfo {
    /// What an id without a definition reads as: nothing at all. Treating it
    /// as air keeps a world written by a newer build walkable and visible.
    fn unknown() -> Self {
        BlockInfo {
            name: "Unknown".into(),
            textures: [0; 3],
            icon: 0,
            known: false,
            solid: false,
            opaque: false,
            translucent: false,
            liquid: false,
            breakable: false,
            light: 0,
            hardness: 0.0,
            replaceable: true,
            climbable: false,
            slipperiness: 0.0,
            speed_factor: 1.0,
            bounce: 0.0,
            cross: None,
            visual: Vec::new(),
            collision: Vec::new(),
            selection: Vec::new(),
            dynamic: false,
            full_cube: false,
        }
    }

    fn from_json(b: &BlockJson) -> Self {
        let to_aabb = |x: &BoxJson| Aabb {
            min: x.min,
            max: x.max,
        };
        let (visual, collision, selection, dynamic, full_cube) = match &b.shape {
            None => (
                vec![ModelBox {
                    aabb: Aabb::FULL,
                    textures: b.textures,
                }],
                vec![Aabb::FULL],
                vec![Aabb::FULL],
                false,
                true,
            ),
            Some(s) => (
                s.visual
                    .iter()
                    .map(|x| ModelBox {
                        aabb: to_aabb(x),
                        textures: x.tex.unwrap_or(b.textures),
                    })
                    .collect(),
                s.collision.iter().map(to_aabb).collect(),
                s.selection.iter().map(to_aabb).collect(),
                s.dynamic,
                false,
            ),
        };
        BlockInfo {
            name: b.name.clone(),
            textures: b.textures,
            icon: b.icon,
            known: true,
            solid: b.solid,
            opaque: b.opaque,
            translucent: b.translucent,
            liquid: b.liquid,
            breakable: b.breakable,
            light: b.light,
            hardness: b.hardness,
            replaceable: b.replaceable,
            climbable: b.climbable,
            slipperiness: b.slipperiness,
            speed_factor: b.speed_factor,
            bounce: b.bounce,
            cross: b.cross,
            // Air draws nothing, whatever the registry lists for it.
            visual: if b.id == 0 { Vec::new() } else { visual },
            collision,
            selection,
            dynamic,
            full_cube,
        }
    }
}

/// The block table, indexed by id, plus the atlas geometry.
pub struct BlockTable {
    blocks: Vec<BlockInfo>,
    /// Copies of the hottest flags, dense so the mesher's inner loop stays
    /// in cache.
    pub opaque: [bool; 256],
    pub solid: [bool; 256],
    /// Opaque and a full cube: the only blocks that hide a neighbour's face.
    pub hides: [bool; 256],
    pub atlas: AtlasInfo,
    pub items: Vec<ItemJson>,
}

impl BlockTable {
    pub fn from_json(text: &str) -> Result<Self, String> {
        let file: ContentFile =
            serde_json::from_str(text).map_err(|e| format!("content.json: {e}"))?;
        Self::from_file(file)
    }

    pub fn from_file(file: ContentFile) -> Result<Self, String> {
        if file.format != FORMAT {
            return Err(format!(
                "content.json is format {}, this build reads format {FORMAT}; re-run tools/export-native.ts or rebuild",
                file.format
            ));
        }
        let slots = file.atlas.grid * file.atlas.grid;
        let mut blocks: Vec<BlockInfo> = (0..256).map(|_| BlockInfo::unknown()).collect();
        for b in &file.blocks {
            let referenced = b.textures.iter().chain(std::iter::once(&b.icon)).chain(
                b.shape
                    .iter()
                    .flat_map(|s| s.visual.iter().filter_map(|x| x.tex.as_ref()))
                    .flatten(),
            );
            for &slot in referenced {
                if u32::from(slot) >= slots {
                    return Err(format!(
                        "block {} ({}) uses atlas slot {slot}, but the atlas has {slots}",
                        b.id, b.name
                    ));
                }
            }
            blocks[b.id as usize] = BlockInfo::from_json(b);
        }
        let mut opaque = [false; 256];
        let mut solid = [false; 256];
        let mut hides = [false; 256];
        for (i, b) in blocks.iter().enumerate() {
            opaque[i] = b.opaque;
            solid[i] = b.solid;
            hides[i] = b.opaque && b.full_cube;
        }
        Ok(BlockTable {
            blocks,
            opaque,
            solid,
            hides,
            atlas: file.atlas,
            items: file.items,
        })
    }

    /// Loads content.json from a directory, or the compiled-in copy.
    pub fn load(dir: Option<&Path>) -> Result<Self, String> {
        match dir {
            Some(d) => {
                let path = d.join("content.json");
                let text = std::fs::read_to_string(&path)
                    .map_err(|e| format!("{}: {e}", path.display()))?;
                Self::from_json(&text)
            }
            None => Self::from_json(EMBEDDED_CONTENT),
        }
    }

    #[inline]
    pub fn get(&self, id: u8) -> &BlockInfo {
        &self.blocks[id as usize]
    }

    /// Looks a block up by its display name. For tests and the starter
    /// hotbar; several ids can share a name (conveyor facings), and this
    /// returns the lowest.
    pub fn id_by_name(&self, name: &str) -> Option<u8> {
        self.blocks
            .iter()
            .position(|b| b.known && b.name == name)
            .map(|i| i as u8)
    }

    /// Placing into a cell holding this is allowed: air, a liquid, or
    /// something replaceable (tall grass).
    pub fn is_replaceable(&self, id: u8) -> bool {
        let b = self.get(id);
        id == 0 || b.liquid || b.replaceable
    }

    /// Texture coordinates of an atlas slot, as [u0, v0, u1, v1].
    ///
    /// Inset by half a texel, exactly like the web atlas, so nearest
    /// sampling at a tile's very edge never picks up its neighbour's pixels.
    pub fn tile_uv(&self, slot: u16) -> [f32; 4] {
        let grid = self.atlas.grid as f32;
        let inset = 0.5 / self.atlas.size as f32;
        let col = (slot as u32 % self.atlas.grid) as f32;
        let row = (slot as u32 / self.atlas.grid) as f32;
        [
            col / grid + inset,
            row / grid + inset,
            (col + 1.0) / grid - inset,
            (row + 1.0) / grid - inset,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table() -> BlockTable {
        BlockTable::load(None).expect("embedded content.json parses")
    }

    #[test]
    fn embedded_content_parses_and_has_the_core_blocks() {
        let t = table();
        assert_eq!(t.atlas.grid * t.atlas.tile_px, t.atlas.size);
        assert_eq!(
            t.atlas.tiles.len() as u32 <= t.atlas.grid * t.atlas.grid,
            true
        );
        let grass = t.get(1);
        assert_eq!(grass.name, "Grass Block");
        assert!(grass.solid && grass.opaque && grass.full_cube);
        // Top, bottom and side are different tiles for grass.
        assert_ne!(grass.textures[0], grass.textures[2]);
        assert!(!t.get(0).solid && !t.get(0).opaque && t.get(0).visual.is_empty());
    }

    #[test]
    fn shapes_come_through_with_their_boxes() {
        let t = table();
        let conveyor = t.get(t.id_by_name("Conveyor Belt").unwrap());
        assert!(!conveyor.full_cube);
        assert_eq!(conveyor.visual.len(), 1);
        assert!((conveyor.visual[0].aabb.max[1] - 3.0 / 16.0).abs() < 1e-6);
        assert_eq!(conveyor.collision.len(), 1);

        let torch = t.get(t.id_by_name("Torch").unwrap());
        assert_eq!(torch.light, 14);
        // The torch is picked by a box a little fatter than its stick.
        assert!(torch.selection[0].min[0] < torch.visual[0].aabb.min[0]);
    }

    #[test]
    fn plants_are_crosses_with_no_collision() {
        let t = table();
        let grass = t.get(t.id_by_name("Tall Grass").unwrap());
        assert!(grass.cross.is_some());
        assert!(grass.visual.is_empty());
        assert!(grass.collision.is_empty());
        assert_eq!(grass.selection.len(), 1);
    }

    #[test]
    fn water_and_glass_are_translucent_not_opaque() {
        let t = table();
        for name in ["Water", "Glass"] {
            let b = t.get(t.id_by_name(name).unwrap());
            assert!(b.translucent && !b.opaque, "{name}");
        }
        assert!(t.get(t.id_by_name("Water").unwrap()).liquid);
    }

    #[test]
    fn unknown_ids_read_as_nothing() {
        let t = table();
        let unused = (1..=255u8).find(|&i| !t.get(i).known).expect("a free id");
        let b = t.get(unused);
        assert!(!b.solid && !b.opaque && b.visual.is_empty());
    }

    #[test]
    fn tile_uvs_stay_inside_their_tile() {
        let t = table();
        let g = t.atlas.grid as f32;
        let [u0, v0, u1, v1] = t.tile_uv(t.atlas.grid as u16 + 1);
        assert!(u0 > 1.0 / g && u1 < 2.0 / g);
        assert!(v0 > 1.0 / g && v1 < 2.0 / g);
    }

    #[test]
    fn a_wrong_format_is_refused() {
        let text = EMBEDDED_CONTENT.replacen("\"format\": 1", "\"format\": 99", 1);
        assert!(BlockTable::from_json(&text).is_err());
    }

    #[test]
    fn items_have_names_and_icons() {
        let t = table();
        assert!(!t.items.is_empty());
        assert!(t.items.iter().any(|i| i.name == "Stick"));
        assert!(t.items.iter().all(|i| i.id >= 256));
    }
}
