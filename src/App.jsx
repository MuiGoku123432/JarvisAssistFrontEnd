import React, { useState, useEffect, useRef } from 'react';
import WebGLCanvas from './WebGLCanvas.jsx';
import './App.css';
import bg from './assets/JarvisBackground.svg';


import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  readFile,
  writeFile,
  remove,
  BaseDirectory
} from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';

import * as echarts from 'echarts';
import CircularAudioWave from './libs/circular-audio-wave';

const API_URL      = import.meta.env.VITE_API_URL;
const WS_URL       = import.meta.env.VITE_WS_URL;
const audioFolder  = import.meta.env.VITE_OUTPUT_DIR;
console.log('HERE IS AUDIO FOLDER: ' + audioFolder)

window.echarts = echarts;

const STATES = {
  IDLE:       'IDLE',
  LISTENING:  'LISTENING',
  RECORDING:  'RECORDING',
  PROCESSING: 'PROCESSING',
};

export default function App() {
  const [state, setState] = useState(STATES.IDLE);
  const socketRef   = useRef(null);

  //
  // 1) Always‑on VAD & WAV upload
  //
  useEffect(() => {
    console.debug('[App] invoking start_vad');
    invoke('start_vad')
      .then(() => console.debug('[App] start_vad succeeded'))
      .catch(err => console.error('[App] start_vad error', err));

    let offStart, offEnd, offSaved;
    (async () => {
      offStart = await listen('speech-started', () => {
        console.debug('[Event] 🔥 speech-started');
        setState(STATES.RECORDING);
      });
      offEnd = await listen('speech-ended', () => {
        console.debug('[Event] 💤 speech-ended');
        setState(STATES.PROCESSING);
      });
      offSaved = await listen('audio-saved', async ({ payload: filePath }) => {
        console.debug('[Event] 💾 audio-saved:', filePath);
        try {
          // Read the WAV bytes from Rust's temp dir
          const bytes = await readFile(filePath, { dir: BaseDirectory.Temp });
          console.debug('[App] readFile bytes length:', bytes.length);

          // Upload
          const blob = new Blob([new Uint8Array(bytes)], { type: 'audio/wav' });
          const form = new FormData();
          form.append('audio', blob, 'vad.wav');
          console.debug('[App] uploading audio');
          const res = await fetch(`${API_URL}/upload_audio`, {
            method: 'POST',
            body: form,
          });
          if (!res.ok) {
            console.error('[App] upload failed:', res.status);
          } else {
            console.debug('[App] upload succeeded');
            socketRef.current.send(JSON.stringify({
              type: 'process_audio',
              filename: 'vad.wav',
            }));
          }
        } catch (e) {
          console.error('[App] error in audio-saved handler:', e);
        } finally {
          // Clean up the temp file
          await remove(filePath, { dir: BaseDirectory.Temp }).catch(err =>
            console.warn('[App] removeFile error:', err)
          );
          setState(STATES.IDLE);
        }
      });
    })();

    return () => {
      console.debug('[App] cleaning up VAD listeners & stopping VAD');
      invoke('stop_vad').catch(console.error);
      offStart?.();
      offEnd?.();
      offSaved?.();
    };
  }, []);

  //
  // 2) Initialize the CircularAudioWave
  //
  useEffect(() => {
    const container = document.getElementById('chart-container');
    if (container && !window.wave) {
      console.debug('[App] initializing CircularAudioWave');
      window.wave = new CircularAudioWave(container);
    }
  }, []);

  //
  // 3) WebSocket → trigger listening & handle chat_response
  //
  useEffect(() => {
    console.debug('[WS] connecting to', WS_URL);
    socketRef.current = new WebSocket(WS_URL);

    socketRef.current.onopen = () => {
      console.debug('[WS] connected');
    };

    socketRef.current.onmessage = async (e) => {
      const msg = JSON.parse(e.data);
      console.debug('[WS] message received:', msg);
      switch (msg.type) {
        case 'start_listening':
          console.debug('[WS] start_listening → invoke start_vad');
          await invoke('start_vad').catch(err =>
            console.error('[App] start_vad error:', err)
          );
          setState(STATES.LISTENING);
          break;
        case 'chat_response':
          console.debug('[WS] chat_response:', msg);
          if (msg.audio_url) {
            await downloadAudio(msg.audio_url);
          }
          break;
        default:
          console.warn('[WS] unknown message type:', msg.type);
      }
    };

    socketRef.current.onclose = () => {
      console.warn('[WS] disconnected, retrying in 3s');
      setTimeout(() => {
        // reconnect
        console.debug('[WS] reconnecting...');
        socketRef.current = null;
        socketRef.current = new WebSocket(WS_URL);
      }, 3000);
    };

    return () => {
      console.debug('[WS] cleaning up: close & stop_vad');
      invoke('stop_vad').catch(console.error);
      socketRef.current?.close();
    };
  }, []);

  const isValidWavFile = (header) => {
    return String.fromCharCode(...header.slice(0,4)) === 'RIFF'
        && String.fromCharCode(...header.slice(8,12)) === 'WAVE';
  };

  // plays & cleans up
  const playAudioResponse = async (filePath) => {
    if (!filePath) {
      console.log('No audio path provided');
      return;
    }
    // 1. Guard again in case playAudioResponse is called directly
    if (window.wave.isPlaying()) {
      console.log('Audio is already playing. Skipping playback.');
      return;
    }
  
    try {
      setState(STATES.PROCESSING);
      console.log('Loading audio into CircularAudioWave…');
      await window.wave.loadAudio(filePath);
      
      console.log('Starting playback…');
      await window.wave.play();  
      // ⚡️ this promise only resolves once the buffer’s ended :contentReference[oaicite:0]{index=0}&#8203;:contentReference[oaicite:1]{index=1}
  
    } catch (err) {
      console.error('playAudioResponse error:', err);
  
    } finally {
      // 2. Always clean up afterwards
      try {
        await remove(filePath);
        console.log('Deleted temp file:', filePath);
      } catch (e) {
        console.warn('Failed to delete file:', e);
      }
      setState(STATES.IDLE);
      startListening();  // resume listening loop
    }
  };

// downloads → writes → plays → cleans
const downloadAudio = async (audioUrl) => {
  if (window.wave?.isPlaying()) {
    console.log('Audio is currently playing. Skipping download.');
    return;
  }

  // pause VAD
  await invoke('stop_vad').catch(console.error);

  try {
    console.debug('Downloading audio from:', audioUrl);
    const res = await fetch(audioUrl);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buffer = await res.arrayBuffer();

    // build absolute path
    const parts = audioUrl.split('/');
    const filename = parts[parts.length - 1];
    const filePath = await join(audioFolder, filename);
    console.debug('Writing file to:', filePath);

    // write via your Rust command
    await invoke('write_file', {
      filePath,
      contents: Array.from(new Uint8Array(buffer)),
    });

    // Quick WAV sanity check…
    const header = new Uint8Array((await readFile(filePath)).slice(0, 12));
    if (!isValidWavFile(header)) {
      console.error('Not a valid WAV');
      await removeFile(filePath);
      return;
    }


    // delegate to our player
    await playAudioResponse(filePath);
  } catch (err) {
    console.error('downloadAudio error:', err);
    setState(STATES.IDLE);
  }
};

  //
  // 5) Optional manual trigger button (if you still want it)
  //
  const handleButtonClick = () => {
    console.debug('[UI] manual listen click');
    socketRef.current?.send(JSON.stringify({ type: 'listen' }));
    setState(STATES.LISTENING);
  };

  return (
    <div className="App">
      {/* <WebGLCanvas /> */}
      <img src={bg} alt="Background" style={{ maxHeight: '100%', maxWidth: '100%'}}/>;
      <div className="overlay">
        <button
          id="button"
          className={
            state !== STATES.IDLE ? 'play-button-stop' : 'play-button-start'
          }
          onClick={handleButtonClick}
        >
          J.A.R.V.I.S
        </button>
        <div id="chart-container" className="overlay" />
      </div>
    </div>
  );
}
