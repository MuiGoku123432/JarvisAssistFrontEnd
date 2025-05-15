//! Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::File;
use std::io::{Read, Write};
use std::sync::Arc;
use audio::VadController;
use tauri::Manager;
use tauri_plugin_mic_recorder::init;

mod audio;

#[tauri::command]
fn read_file(file_path: String) -> Result<Vec<u8>, String> {
  let mut file = File::open(&file_path).map_err(|e| format!("Error opening file: {}", e))?;
  let mut buffer = Vec::new();
  file.read_to_end(&mut buffer).map_err(|e| format!("Error reading file: {}", e))?;
  Ok(buffer)
}

#[tauri::command]
fn write_file(file_path: String, contents: Vec<u8>) -> Result<(), String> {
  let mut file = File::create(&file_path).map_err(|e| format!("Error creating file: {}", e))?;
  file.write_all(&contents).map_err(|e| format!("Error writing to file: {}", e))?;
  Ok(())
}

fn main() {
  // Create and share our VAD controller
  let vad = Arc::new(VadController::new());

  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_os::init())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_global_shortcut::Builder::new().build())
    .plugin(tauri_plugin_fs::init())
    .plugin(init())
    .setup(|app| {
      #[cfg(debug_assertions)]
      {
        let window = app.get_webview_window("main").unwrap();
        window.open_devtools();
      }
      Ok(())
    })
    // Inject our audio module state
    .manage(vad)
    // Expose both file I/O and VAD commands
    .invoke_handler(tauri::generate_handler![
      read_file,
      write_file,
      audio::start_vad,
      audio::stop_vad
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

