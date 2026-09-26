//! The heads-up display: crosshair, hotbar and the F3 readout.
//!
//! Built fresh every frame as a flat list of triangles in pixel space -- a few
//! hundred vertices, far cheaper than keeping anything cached in sync. Text
//! uses a tiny 3x5 pixel font defined below, drawn as one quad per lit pixel,
//! so the game needs no font file and no text rendering library.

use crate::content::BlockTable;

#[repr(C)]
#[derive(Clone, Copy, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct HudVertex {
    /// Pixels from the top-left corner.
    pub pos: [f32; 2],
    /// Atlas coordinates; a negative u draws flat `color` instead.
    pub uv: [f32; 2],
    pub color: [f32; 4],
}

/// Hotbar slots, as in the web game.
pub const HOTBAR_SIZE: usize = 9;

pub struct HudInput<'a> {
    pub width: f32,
    pub height: f32,
    pub table: &'a BlockTable,
    pub hotbar: &'a [u8; HOTBAR_SIZE],
    pub selected: usize,
    /// Lines for the F3 overlay, or None when it is hidden.
    pub debug: Option<&'a [String]>,
    /// Whether the mouse is captured; when it is not, a hint says how to.
    pub captured: bool,
}

/// Interface scale: whole multiples only, so the pixel font and the icons
/// stay sharp. Two at 720p, three at 1080p, four at 1440p.
pub fn ui_scale(height: f32) -> f32 {
    (height / 360.0).floor().max(1.0)
}

#[derive(Default)]
struct Builder {
    out: Vec<HudVertex>,
}

impl Builder {
    fn rect(&mut self, x: f32, y: f32, w: f32, h: f32, color: [f32; 4]) {
        self.quad(x, y, w, h, [-1.0; 4], color);
    }

    /// A quad with texture coordinates [u0, v0, u1, v1].
    fn quad(&mut self, x: f32, y: f32, w: f32, h: f32, uv: [f32; 4], color: [f32; 4]) {
        let [u0, v0, u1, v1] = uv;
        let v = |px: f32, py: f32, u: f32, vv: f32| HudVertex {
            pos: [px, py],
            uv: [u, vv],
            color,
        };
        let (a, b, c, d) = (
            v(x, y, u0, v0),
            v(x + w, y, u1, v0),
            v(x + w, y + h, u1, v1),
            v(x, y + h, u0, v1),
        );
        self.out.extend_from_slice(&[a, b, c, a, c, d]);
    }

    /// Hollow rectangle `t` pixels thick.
    fn frame(&mut self, x: f32, y: f32, w: f32, h: f32, t: f32, color: [f32; 4]) {
        self.rect(x, y, w, t, color);
        self.rect(x, y + h - t, w, t, color);
        self.rect(x, y + t, t, h - 2.0 * t, color);
        self.rect(x + w - t, y + t, t, h - 2.0 * t, color);
    }

    /// Draws text with its top-left at (x, y), each font pixel `px` screen
    /// pixels, with a drop shadow so it reads over snow and sky alike.
    fn text(&mut self, x: f32, y: f32, px: f32, s: &str, color: [f32; 4]) {
        let shadow = [0.0, 0.0, 0.0, 0.6 * color[3]];
        for (dx, dy, c) in [(px * 0.5, px * 0.5, shadow), (0.0, 0.0, color)] {
            let mut cx = x + dx;
            for ch in s.chars() {
                if let Some(rows) = glyph(ch) {
                    for (row, bits) in rows.iter().enumerate() {
                        for col in 0..3 {
                            if bits & (0b100 >> col) != 0 {
                                self.rect(
                                    cx + col as f32 * px,
                                    y + dy + row as f32 * px,
                                    px,
                                    px,
                                    c,
                                );
                            }
                        }
                    }
                }
                cx += 4.0 * px;
            }
        }
    }
}

/// Width in screen pixels of `s` drawn at `px`.
pub fn text_width(s: &str, px: f32) -> f32 {
    (s.chars().count() as f32 * 4.0 - 1.0).max(0.0) * px
}

pub fn build(input: &HudInput) -> Vec<HudVertex> {
    let mut b = Builder::default();
    let scale = ui_scale(input.height);
    let (w, h) = (input.width, input.height);

    // Crosshair: a thin white plus with a dark outline, readable on any
    // background without an inverting blend.
    let arm = 5.0 * scale;
    let t = scale.max(2.0);
    let (cx, cy) = ((w / 2.0).floor(), (h / 2.0).floor());
    let dark = [0.0, 0.0, 0.0, 0.5];
    b.rect(
        cx - arm - 1.0,
        cy - t / 2.0 - 1.0,
        2.0 * arm + 2.0,
        t + 2.0,
        dark,
    );
    b.rect(
        cx - t / 2.0 - 1.0,
        cy - arm - 1.0,
        t + 2.0,
        2.0 * arm + 2.0,
        dark,
    );
    let white = [1.0, 1.0, 1.0, 0.9];
    b.rect(cx - arm, cy - t / 2.0, 2.0 * arm, t, white);
    b.rect(cx - t / 2.0, cy - arm, t, 2.0 * arm, white);

    // Hotbar, centred along the bottom edge.
    let slot = 20.0 * scale;
    let bar_w = slot * HOTBAR_SIZE as f32;
    let x0 = ((w - bar_w) / 2.0).floor();
    let y0 = h - slot - 4.0 * scale;
    b.rect(x0, y0, bar_w, slot, [0.0, 0.0, 0.0, 0.45]);
    for (i, &id) in input.hotbar.iter().enumerate() {
        let x = x0 + i as f32 * slot;
        b.frame(x, y0, slot, slot, scale, [0.55, 0.55, 0.55, 0.8]);
        if id != 0 {
            let inset = 3.0 * scale;
            let uv = input.table.tile_uv(input.table.get(id).icon);
            b.quad(
                x + inset,
                y0 + inset,
                slot - 2.0 * inset,
                slot - 2.0 * inset,
                uv,
                [1.0; 4],
            );
        }
    }
    let sel = x0 + input.selected.min(HOTBAR_SIZE - 1) as f32 * slot;
    b.frame(
        sel - scale,
        y0 - scale,
        slot + 2.0 * scale,
        slot + 2.0 * scale,
        scale * 1.5,
        [1.0; 4],
    );

    // The selected block's name above the bar.
    let id = input.hotbar[input.selected.min(HOTBAR_SIZE - 1)];
    if id != 0 {
        let name = &input.table.get(id).name;
        let px = scale;
        let tw = text_width(name, px);
        b.text(((w - tw) / 2.0).floor(), y0 - 9.0 * px, px, name, [1.0; 4]);
    }

    if !input.captured {
        let msg = "CLICK TO PLAY - ESC RELEASES THE MOUSE";
        let px = scale;
        let tw = text_width(msg, px);
        let y = (h / 2.0 + 16.0 * scale).floor();
        b.rect(
            ((w - tw) / 2.0).floor() - 4.0 * px,
            y - 3.0 * px,
            tw + 8.0 * px,
            11.0 * px,
            [0.0, 0.0, 0.0, 0.5],
        );
        b.text(((w - tw) / 2.0).floor(), y, px, msg, [1.0; 4]);
    }

    if let Some(lines) = input.debug {
        let px = scale;
        let line_h = 7.0 * px;
        for (i, line) in lines.iter().enumerate() {
            let y = 4.0 * px + i as f32 * line_h;
            b.rect(
                2.0 * px,
                y - px,
                text_width(line, px) + 4.0 * px,
                line_h,
                [0.0, 0.0, 0.0, 0.4],
            );
            b.text(4.0 * px, y, px, line, [1.0; 4]);
        }
    }
    b.out
}

/// A 3x5 glyph: five rows, top first, three bits each (0b100 is the left
/// column). Lower case draws as upper case.
fn glyph(c: char) -> Option<[u8; 5]> {
    let rows = |s: [&str; 5]| -> [u8; 5] {
        s.map(|r| r.bytes().fold(0u8, |acc, b| (acc << 1) | (b == b'#') as u8))
    };
    Some(rows(match c.to_ascii_uppercase() {
        '0' => ["###", "#.#", "#.#", "#.#", "###"],
        '1' => [".#.", "##.", ".#.", ".#.", "###"],
        '2' => ["###", "..#", "###", "#..", "###"],
        '3' => ["###", "..#", ".##", "..#", "###"],
        '4' => ["#.#", "#.#", "###", "..#", "..#"],
        '5' => ["###", "#..", "###", "..#", "###"],
        '6' => ["###", "#..", "###", "#.#", "###"],
        '7' => ["###", "..#", "..#", ".#.", ".#."],
        '8' => ["###", "#.#", "###", "#.#", "###"],
        '9' => ["###", "#.#", "###", "..#", "###"],
        'A' => [".#.", "#.#", "###", "#.#", "#.#"],
        'B' => ["##.", "#.#", "##.", "#.#", "##."],
        'C' => [".##", "#..", "#..", "#..", ".##"],
        'D' => ["##.", "#.#", "#.#", "#.#", "##."],
        'E' => ["###", "#..", "##.", "#..", "###"],
        'F' => ["###", "#..", "##.", "#..", "#.."],
        'G' => [".##", "#..", "#.#", "#.#", ".##"],
        'H' => ["#.#", "#.#", "###", "#.#", "#.#"],
        'I' => ["###", ".#.", ".#.", ".#.", "###"],
        'J' => ["..#", "..#", "..#", "#.#", ".#."],
        'K' => ["#.#", "#.#", "##.", "#.#", "#.#"],
        'L' => ["#..", "#..", "#..", "#..", "###"],
        'M' => ["#.#", "###", "###", "#.#", "#.#"],
        'N' => ["##.", "#.#", "#.#", "#.#", "#.#"],
        'O' => [".#.", "#.#", "#.#", "#.#", ".#."],
        'P' => ["##.", "#.#", "##.", "#..", "#.."],
        'Q' => [".#.", "#.#", "#.#", "##.", ".##"],
        'R' => ["##.", "#.#", "##.", "#.#", "#.#"],
        'S' => [".##", "#..", ".#.", "..#", "##."],
        'T' => ["###", ".#.", ".#.", ".#.", ".#."],
        'U' => ["#.#", "#.#", "#.#", "#.#", "###"],
        'V' => ["#.#", "#.#", "#.#", "#.#", ".#."],
        'W' => ["#.#", "#.#", "###", "###", "#.#"],
        'X' => ["#.#", "#.#", ".#.", "#.#", "#.#"],
        'Y' => ["#.#", "#.#", ".#.", ".#.", ".#."],
        'Z' => ["###", "..#", ".#.", "#..", "###"],
        '.' => ["...", "...", "...", "...", ".#."],
        ',' => ["...", "...", "...", ".#.", "#.."],
        ':' => ["...", ".#.", "...", ".#.", "..."],
        '-' => ["...", "...", "###", "...", "..."],
        '+' => ["...", ".#.", "###", ".#.", "..."],
        '/' => ["..#", "..#", ".#.", "#..", "#.."],
        '(' => [".#.", "#..", "#..", "#..", ".#."],
        ')' => [".#.", "..#", "..#", "..#", ".#."],
        '%' => ["#.#", "..#", ".#.", "#..", "#.#"],
        '\'' => [".#.", ".#.", "...", "...", "..."],
        ' ' => return Some([0; 5]),
        _ => return None,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glyphs_decode_left_column_first() {
        assert_eq!(glyph('L').unwrap(), [4, 4, 4, 4, 7]);
        assert_eq!(glyph('l'), glyph('L'));
        assert!(glyph('~').is_none());
    }

    #[test]
    fn text_is_one_quad_per_lit_pixel_plus_shadow() {
        let mut b = Builder::default();
        b.text(0.0, 0.0, 1.0, "1", [1.0; 4]);
        let lit = glyph('1')
            .unwrap()
            .iter()
            .map(|r| r.count_ones())
            .sum::<u32>() as usize;
        assert_eq!(b.out.len(), lit * 2 * 6);
    }

    #[test]
    fn the_hotbar_sits_centred_on_the_bottom_edge() {
        let table = BlockTable::load(None).unwrap();
        let hotbar = [1, 2, 3, 0, 0, 0, 0, 0, 0];
        let v = build(&HudInput {
            width: 1280.0,
            height: 720.0,
            table: &table,
            hotbar: &hotbar,
            selected: 0,
            debug: None,
            captured: true,
        });
        let textured: Vec<&HudVertex> = v.iter().filter(|v| v.uv[0] >= 0.0).collect();
        // Three icons, two triangles each.
        assert_eq!(textured.len(), 3 * 6);
        let xs = textured.iter().map(|v| v.pos[0]);
        let min_x = xs.clone().fold(f32::MAX, f32::min);
        let bar_w = 20.0 * ui_scale(720.0) * HOTBAR_SIZE as f32;
        assert!(
            (min_x - ((1280.0 - bar_w) / 2.0 + 3.0 * 2.0)).abs() < 1.0,
            "{min_x}"
        );
        assert!(textured
            .iter()
            .all(|v| v.pos[1] > 600.0 && v.pos[1] < 720.0));
    }
}
