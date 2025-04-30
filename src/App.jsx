import React, { useState, useEffect, useRef, useCallback } from 'react';
import WebGLCanvas from './WebGLCanvas.jsx';
import './App.css';
import { readBinaryFile, removeFile } from '@tauri-apps/api/fs';
import { join } from '@tauri-apps/api/path';
import * as echarts from 'echarts';
import CircularAudioWave from './libs/circular-audio-wave';
import { invoke } from '@tauri-apps/api/tauri';
import RecordRTC from 'recordrtc';
import { MicVAD } from '@ricky0123/vad-web';

window.echarts = echarts;
const audioFolder = 'D:/repos/jarvis-appV2/jarvis-app/src-tauri/target/debug/outputs';

const STATES = {
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  RECORDING: 'RECORDING',
  PROCESSING: 'PROCESSING',
};

const App = () => {
  const [currentState, setCurrentState] = useState(STATES.IDLE);
  const socketRef = useRef(null);
  const recorderRef = useRef(null);
  const vadRef = useRef(null);
  const vadInitializedRef = useRef(false);
  const timeoutRef = useRef(null);
  const silenceTimeoutRef = useRef(null);

  const logState = useCallback((action) => {
    console.log(`${action} - Current State: ${currentState}`);
  }, [currentState]);

  const setState = useCallback((newState) => {
    logState(`Transitioning from ${currentState} to ${newState}`);
    if (currentState === newState) return;
    setCurrentState(newState);
  }, [currentState, logState]);

  useEffect(() => {
    const chartContainer = document.getElementById('chart-container');
    if (chartContainer && !window.wave) {
      console.log('Initializing CircularAudioWave');
      window.wave = new CircularAudioWave(chartContainer);
    }

    initVAD();
    return () => {
      clearTimeout(timeoutRef.current);
      clearTimeout(silenceTimeoutRef.current);
      recorderRef.current?.destroy();
      vadRef.current?.destroy();
    };
  }, []);

  const initVAD = async () => {
    try {
      vadRef.current = await MicVAD.new({
        onSpeechStart: () => {
          if (currentState !== STATES.RECORDING) startRecording();
          clearTimeout(silenceTimeoutRef.current);
        },
        onSpeechEnd: async (audio) => {
          if (audio?.audioData && currentState === STATES.RECORDING) {
            recorderRef.current?.stopRecording(() => {
              recorderRef.current.destroy();
              recorderRef.current = null;
            });
            setState(STATES.PROCESSING);
            const wavBlob = new Blob([audio.audioData], { type: 'audio/wav' });
            await uploadAudioFile(wavBlob);
          } else {
            silenceTimeoutRef.current = setTimeout(async () => {
              if (currentState === STATES.RECORDING) await stopRecording();
            }, 500);
          }
        },
        positiveSpeechThreshold: 0.80,
        negativeSpeechThreshold: 0.75,
        minSpeechFrames: 5,
        preSpeechPadFrames: 10,
        redemptionFrames: 30,
        silenceCaptureDuration: 0.5,
        returnAudioData: true,
      });
      vadInitializedRef.current = true;
    } catch (error) {
      console.error('VAD init error:', error);
    }
  };

  useEffect(() => {
    const connectWebSocket = async () => {
      try {
        const wsUrl = await invoke('get_websocket_url');
        socketRef.current = new WebSocket(wsUrl);
        socketRef.current.onopen = () => startListening();
        socketRef.current.onmessage = handleWebSocketMessage;
        socketRef.current.onclose = () => setTimeout(connectWebSocket, 3000);
      } catch (error) {
        console.error('WebSocket error:', error);
      }
    };
    connectWebSocket();
    return () => {
      socketRef.current?.close();
      clearTimeout(timeoutRef.current);
      clearTimeout(silenceTimeoutRef.current);
      recorderRef.current?.destroy();
      vadRef.current?.destroy();
    };
  }, []);

  const handleWebSocketMessage = async (event) => {
    const data = JSON.parse(event.data);
    switch (data.type) {
      case 'chat_response':
        if (data.audio_url) await downloadAudio(data.audio_url);
        break;
      case 'start_listening':
        await activateVAD();
        break;
      default:
        break;
    }
  };

  const startListening = () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'listen' }));
      setState(STATES.LISTENING);
    }
  };

  const activateVAD = async () => {
    if (window.wave?.isPlaying()) return;
    if (!vadInitializedRef.current) await initVAD();
    try {
      await vadRef.current.start();
      setState(STATES.LISTENING);
    } catch {
      await startRecording();
    }
  };

  const deactivateVAD = async () => {
    try {
      await vadRef.current.pause();
      if (currentState === STATES.RECORDING) await stopRecording();
    } catch (e) { console.error(e); }
  };

  const startRecording = async () => {
    if (recorderRef.current || window.wave?.isPlaying()) return;
    clearTimeout(timeoutRef.current);
    clearTimeout(silenceTimeoutRef.current);
    setState(STATES.RECORDING);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorderRef.current = new RecordRTC(stream, {
        type: 'audio', mimeType: 'audio/wav', recorderType: RecordRTC.StereoAudioRecorder,
        numberOfAudioChannels: 1, desiredSampRate: 16000,
      });
      await recorderRef.current.startRecording();
      timeoutRef.current = setTimeout(() => stopRecording(), 10000);
    } catch (error) {
      console.error(error);
      setState(STATES.IDLE);
    }
  };

  const stopRecording = async () => {
    clearTimeout(timeoutRef.current);
    if (!recorderRef.current) return;
    setState(STATES.PROCESSING);
    return new Promise((resolve) => {
      recorderRef.current.stopRecording(async () => {
        const blob = await recorderRef.current.getBlob();
        recorderRef.current.destroy();
        recorderRef.current = null;
        if (blob.size) await uploadAudioFile(blob);
        else setState(STATES.IDLE);
        resolve(true);
      });
    });
  };

  const uploadAudioFile = useCallback(async (blob) => {
    setState(STATES.PROCESSING);
    const audioBlob = blob.type === 'audio/wav' ? blob : new Blob([blob], { type: 'audio/wav' });
    const formData = new FormData();
    formData.append('audio', audioBlob, 'temp_audio.wav');
    try {
      const res = await fetch('http://192.168.254.23:5000/upload_audio', {
        method: 'POST', body: formData
      });
      if (res.ok) {
        socketRef.current.send(JSON.stringify({ type: 'process_audio', filename: 'temp_audio.wav' }));
      } else setState(STATES.IDLE);
    } catch (e) {
      console.error(e); setState(STATES.IDLE);
    }
  }, [setState]);

  const isValidWavFile = (header) => {
    return String.fromCharCode(...header.slice(0,4)) === 'RIFF'
        && String.fromCharCode(...header.slice(8,12)) === 'WAVE';
  };

  const downloadAudio = async (audioUrl) => {
    // 1. Don’t even start if already playing
    if (window.wave && window.wave.isPlaying()) {
      console.log('Audio is currently playing. Skipping download.');
      return;
    }
  
    await deactivateVAD();  // your VAD pause logic
    try {
      console.log('Downloading audio from:', audioUrl);
      const res = await fetch(audioUrl);
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  
      const buffer = await res.arrayBuffer();
      const filePath = await join(audioFolder, 'output.wav');
      await invoke('write_file', {
        filePath,
        contents: Array.from(new Uint8Array(buffer)),
      });
  
      // Quick WAV sanity check…
      const header = new Uint8Array((await readBinaryFile(filePath)).slice(0, 12));
      if (!isValidWavFile(header)) {
        console.error('Not a valid WAV');
        await removeFile(filePath);
        return;
      }
  
      // 2. Now play (and await full playback) before returning
      await playAudioResponse(filePath);
      return filePath;
  
    } catch (err) {
      console.error('downloadAudio error:', err);
      setState(STATES.IDLE);
    }
  };

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
        await removeFile(filePath);
        console.log('Deleted temp file:', filePath);
      } catch (e) {
        console.warn('Failed to delete file:', e);
      }
      setState(STATES.IDLE);
      startListening();  // resume listening loop
    }
  };

  const handleButtonClick = () => {
    console.log('handleButtonClick called');
    startListening();
  };

  return (
    <div className='App'>
      <WebGLCanvas />
      <div className="overlay">
        <div>
          <button id="button" className={currentState !== STATES.IDLE ? 'play-button-stop' : 'play-button-start'} onClick={handleButtonClick}>
            {'J.A.R.V.I.S'}
          </button>
        </div>
        <div id="chart-container" className='overlay'></div>
      </div>
    </div>
  );
};

export default App;