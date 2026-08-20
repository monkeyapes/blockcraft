//! Blockcraft desktop shell.
//!
//! The game itself is the web client; this wraps it in a native window so it
//! ships as a single executable with no browser and no dev server.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to start Blockcraft");
}
