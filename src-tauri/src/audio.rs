// src-tauri/src/audio.rs
use std::{
  fs::File,
  io::BufWriter,
  path::PathBuf,
  sync::{Arc, Mutex, mpsc},
  thread,
  time::Duration,
};
use cpal::{traits::{DeviceTrait, HostTrait, StreamTrait}, SampleFormat, StreamConfig};
use hound::{WavSpec, WavWriter};
use tauri::{AppHandle, Manager, State, Emitter};
use voice_activity_detector::VoiceActivityDetector;
use chrono::Utc;

// Adjusted VAD thresholds for reduced sensitivity
const POS_THRESHOLD: f32 = 0.9; // speech start probability threshold (increased from 0.3)
const NEG_THRESHOLD: f32 = 0.4; // speech end probability threshold (increased from 0.2)

pub struct VadController {
  tx: Mutex<Option<mpsc::Sender<()>>>,
}

impl VadController {
  pub fn new() -> Self {
    Self { tx: Mutex::new(None) }
  }

  pub fn start(&self, app_handle: AppHandle) {
    let mut guard = self.tx.lock().unwrap();
    if guard.is_some() { return; }
    let (stop_tx, stop_rx) = mpsc::channel();
    *guard = Some(stop_tx);

    thread::spawn(move || {
      // Initialize VAD model
      let detector = Arc::new(Mutex::new(
        VoiceActivityDetector::builder()
          .sample_rate(16_000_i64)
          .chunk_size(512_usize)
          .build()
          .unwrap(),
      ));

      // Select a 16kHz input config
      let host = cpal::default_host();
      let device = host.default_input_device().expect("No input device");
      let supported_cfg = device.supported_input_configs().unwrap()
        .find(|cfg| cfg.min_sample_rate().0 <= 16_000 && cfg.max_sample_rate().0 >= 16_000)
        .expect("No 16kHz input config")
        .with_sample_rate(cpal::SampleRate(16_000));
      let config: StreamConfig = supported_cfg.clone().into();

      // WAV writer state
      let mut wav_writer: Option<WavWriter<BufWriter<File>>> = None;
      let mut wav_path: Option<PathBuf> = None;

      // Ring buffer and speech flag
      let mut ring: Vec<i16> = Vec::new();
      let mut is_speaking = false;

      let det_clone = detector.clone();
      let app_clone = app_handle.clone();
      let err_fn = |err| eprintln!("cpal error: {:?}", err);
      let timeout = Some(Duration::from_millis(100));

      // Build input stream for U8, I16, F32 formats
      let stream = match supported_cfg.sample_format() {
        SampleFormat::U8 => device.build_input_stream(
          &config,
          move |data: &[u8], _| {
            ring.extend(data.iter().map(|&u| ((u as i16 - 128) << 8)));
            while ring.len() >= 512 {
              process_chunk(&mut ring, &det_clone, &app_clone, &mut wav_writer, &mut wav_path, &mut is_speaking);
            }
          },
          err_fn,
          timeout,
        ).unwrap(),
        SampleFormat::I16 => device.build_input_stream(
          &config,
          move |data: &[i16], _| {
            ring.extend_from_slice(data);
            while ring.len() >= 512 {
              process_chunk(&mut ring, &det_clone, &app_clone, &mut wav_writer, &mut wav_path, &mut is_speaking);
            }
          },
          err_fn,
          timeout,
        ).unwrap(),
        SampleFormat::F32 => device.build_input_stream(
          &config,
          move |data: &[f32], _| {
            ring.extend(data.iter().map(|&f| (f * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16));
            while ring.len() >= 512 {
              process_chunk(&mut ring, &det_clone, &app_clone, &mut wav_writer, &mut wav_path, &mut is_speaking);
            }
          },
          err_fn,
          timeout,
        ).unwrap(),
        fmt => panic!("Unsupported format: {:?}", fmt),
      };

      stream.play().unwrap();
      let _ = stop_rx.recv();
    });
  }

  pub fn stop(&self) {
    let mut guard = self.tx.lock().unwrap();
    if let Some(tx) = guard.take() {
      let _ = tx.send(());
    }
  }
}

// Process one 512-sample chunk
fn process_chunk(
  ring: &mut Vec<i16>,
  detector: &Arc<Mutex<VoiceActivityDetector>>,
  app: &AppHandle,
  wav_writer: &mut Option<WavWriter<BufWriter<File>>>,
  wav_path: &mut Option<PathBuf>,
  is_speaking: &mut bool,
) {
  let frame: Vec<i16> = ring.drain(..512).collect();
  // Normalize & pre-emphasis
  let max_amp = frame.iter().map(|&s| (s as f32).abs()).fold(0.0, f32::max);
  let gain = if max_amp > 0.0 { (0.1 * i16::MAX as f32) / max_amp } else { 1.0 };
  let mut last = 0.0f32;
  let normed: Vec<i16> = frame.into_iter().map(|s| {
    let x = s as f32;
    let y = (x - 0.97 * last) * gain;
    last = x;
    y.clamp(i16::MIN as f32, i16::MAX as f32) as i16
  }).collect();

  // VAD
  let prob = detector.lock().unwrap().predict(normed.clone());
  //println!("🔊 VAD probability = {}", prob);

  // Handle speech boundaries and WAV writing
  if !*is_speaking && prob > POS_THRESHOLD {
    *is_speaking = true;
    // Start new WAV file
    let mut path = std::env::temp_dir();
    path.push(format!("vad_{}.wav", Utc::now().timestamp_millis()));
    let spec = WavSpec { channels: 1, sample_rate: 16000, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    *wav_writer = Some(WavWriter::create(&path, spec).unwrap());
    *wav_path = Some(path.clone());
    let _ = app.emit("speech-started", ());
  }

  if *is_speaking {
    if let Some(writer) = wav_writer.as_mut() {
      for &sample in &normed { writer.write_sample(sample).unwrap(); }
    }
  }

  if *is_speaking && prob < NEG_THRESHOLD {
    *is_speaking = false;
    if let Some(mut writer) = wav_writer.take() { writer.finalize().unwrap(); }
    if let Some(path) = wav_path.take() {
      let path_str = path.to_string_lossy().into_owned();
      let _ = app.emit("audio-saved", path_str);
    }
    let _ = app.emit("speech-ended", ());
  }
}

#[tauri::command]
pub fn start_vad(state: State<'_, Arc<VadController>>, app: AppHandle) {
  println!("▶️ start_vad invoked");
  state.start(app);
}

#[tauri::command]
pub fn stop_vad(state: State<'_, Arc<VadController>>) {
  state.stop();
}