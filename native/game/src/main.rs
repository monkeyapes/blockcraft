//! Blockcraft's native client. See native/README.md.

mod content;
mod jobs;
mod mesher;
mod player;
mod world;

fn main() {
    let chunk = worldgen::generate_chunk(1, worldgen::Dimension::Overworld, 0, 0);
    println!("blockcraft-native: {} blocks in a chunk", chunk.len());
}
