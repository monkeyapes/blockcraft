//! The hosting app's back end.
//!
//! Three jobs: run the bundled server as a child process, stream what it says
//! to the window, and work out this machine's address on the local network.
//! Everything else is in the window.
//!
//! The server is a bundled Node script run by a Node binary that ships beside
//! it. Nothing is rewritten in Rust on purpose: the terrain generator, the
//! protocol and the world logic already exist in TypeScript and are shared
//! with the client. A second implementation here would have to stay identical
//! to that one forever, and the day it quietly stopped being identical, the
//! symptom would be a world that generates differently on the server than on
//! the client -- which is about the worst bug this project could have.

use std::io::{BufRead, BufReader};
use std::net::UdpSocket;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

/// The running server, if there is one.
#[derive(Default)]
struct ServerProcess(Mutex<Option<Child>>);

/// Where the sidecar and the bundled script live once installed.
fn resource(app: &AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    app.path()
        .resolve(name, tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("could not locate {name}: {e}"))
}

#[tauri::command]
fn start_server(
    app: AppHandle,
    state: State<'_, ServerProcess>,
    port: u16,
    seed: String,
) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|_| "server state is poisoned")?;
    if slot.is_some() {
        return Err("a server is already running".into());
    }

    // On Windows the sidecar keeps its .exe suffix; elsewhere it has none.
    let node = resource(&app, if cfg!(windows) { "bin/node.exe" } else { "bin/node" })?;
    let script = resource(&app, "bin/server.mjs")?;

    let mut cmd = Command::new(&node);
    cmd.arg(&script)
        .env("PORT", port.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if !seed.trim().is_empty() {
        cmd.env("SEED", seed.trim());
    }

    // Without this a console window flashes up behind the app on every start,
    // which looks like something went wrong.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not start the server: {e}"))?;

    // Both streams go to the window as the same kind of event. A host reading
    // the log does not care which pipe a line came out of, and splitting them
    // would let the interesting half arrive out of order with the rest.
    for stream in [
        child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
        child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
    ]
    .into_iter()
    .flatten()
    {
        let app = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stream).lines().map_while(Result::ok) {
                let _ = app.emit("server-line", line);
            }
        });
    }

    *slot = Some(child);
    drop(slot);

    // Watch for it ending, however it ends, so the window never shows
    // "running" for a process that has already gone.
    //
    // The lock is taken and released inside one small scope per tick. Holding
    // the guard across the branch that emits would keep the mutex locked
    // while the window is being told about the exit, and stop_server can be
    // called from that same notification.
    let app_for_wait = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(250));

        let finished: Option<Option<i32>> = {
            let state = app_for_wait.state::<ServerProcess>();
            let mut guard = match state.0.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            // Taken by stop_server: it has already reported the exit.
            let status = match guard.as_mut() {
                None => return,
                Some(child) => child.try_wait(),
            };
            match status {
                Ok(Some(s)) => {
                    *guard = None;
                    Some(s.code())
                }
                Ok(None) => None,
                Err(_) => {
                    *guard = None;
                    Some(None)
                }
            }
        };

        if let Some(code) = finished {
            let _ = app_for_wait.emit("server-exit", code);
            return;
        }
    });

    Ok(())
}

#[tauri::command]
fn stop_server(state: State<'_, ServerProcess>) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|_| "server state is poisoned")?;
    if let Some(mut child) = slot.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

/// This machine's address on the local network.
///
/// Found by asking the operating system which interface it would use to reach
/// the outside world and reading the local end of that. Nothing is sent -- a
/// UDP socket has no handshake -- so this works with no network traffic and
/// without caring whether the address it was pointed at exists.
#[tauri::command]
fn lan_address() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("203.0.113.1:80").ok()?;
    let addr = socket.local_addr().ok()?;
    let ip = addr.ip();
    if ip.is_loopback() || ip.is_unspecified() {
        return None;
    }
    Some(ip.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ServerProcess::default())
        .invoke_handler(tauri::generate_handler![start_server, stop_server, lan_address])
        .on_window_event(|window, event| {
            // A server left running after the window closes would hold the
            // port and keep accepting players with nothing watching it.
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<ServerProcess>();
                // let-else rather than `if let`: the latter keeps the Result
                // temporary alive to the end of its block, which outlives the
                // `state` it borrows from.
                let Ok(mut slot) = state.0.lock() else { return };
                if let Some(mut child) = slot.take() {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running the hosting app");
}
