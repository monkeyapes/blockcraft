//! Blockcraft's native client. See native/README.md.

fn main() {
    let chunk = worldgen::generate_chunk(1, worldgen::Dimension::Overworld, 0, 0);
    println!("blockcraft-native: {} blocks in a chunk", chunk.len());
}
