// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;

// Define a command to read a file's content
#[tauri::command]
fn read_file(file_path: String) -> Result<Vec<u8>, String> {
    let mut file = match File::open(&file_path) {
        Ok(file) => file,
        Err(err) => return Err(format!("Error opening file: {}", err)),
    };
    
    let mut buffer = Vec::new();
    match file.read_to_end(&mut buffer) {
        Ok(_) => Ok(buffer),
        Err(err) => Err(format!("Error reading file: {}", err)),
    }
}

#[tauri::command]
fn write_file(file_path: String, contents: Vec<u8>) -> Result<(), String> {
    let mut file = match File::create(&file_path) {
        Ok(file) => file,
        Err(err) => return Err(format!("Error creating file: {}", err)),
    };

    match file.write_all(&contents) {
        Ok(_) => Ok(()),
        Err(err) => Err(format!("Error writing to file: {}", err)),
    }
}

#[tauri::command]
fn get_websocket_url() -> String {
    "ws://192.168.254.23:8765".to_string()
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![read_file, write_file, get_websocket_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}