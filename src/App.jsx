import React, { useState, useEffect, useRef, useCallback } from 'react';
import WebGLCanvas from './WebGLCanvas.jsx';
import './App.css';
import { readBinaryFile, readDir, removeFile, writeFile } from '@tauri-apps/api/fs';
import { join } from '@tauri-apps/api/path';
import * as echarts from 'echarts';
import CircularAudioWave from './libs/circular-audio-wave';
import { invoke } from '@tauri-apps/api/tauri';
import RecordRTC from 'recordrtc';

window.echarts = echarts;
const audioFolder = 'D:/repos/jarvis-appV2/jarvis-app/src-tauri/target/debug/outputs';

const STATES = {
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  RECORDING: 'RECORDING',
  PROCESSING: 'PROCESSING',
};

const App = () => {
  const [messages, setMessages] = useState([]);
  const socketRef = useRef(null);
  const [currentState, setCurrentState] = useState(STATES.IDLE);
  const recorderRef = useRef(null);
  const timeoutRef = useRef(null);

  const logState = useCallback((action) => {
    console.log(`${action} - Current State: ${currentState}`);
  }, [currentState]);

  const setState = useCallback((newState) => {
    logState(`Transitioning from ${currentState} to ${newState}`);
    setCurrentState(newState);
  }, [currentState, logState]);

  useEffect(() => {
    const chartContainer = document.getElementById('chart-container');
    if (chartContainer) {
      console.log('Chart container found');
      if (!window.wave) {
        console.log('Initializing CircularAudioWave Component');
        window.wave = new CircularAudioWave(chartContainer);
      }
    } else {
      console.error('Chart container not found');
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (recorderRef.current) {
        recorderRef.current.destroy();
      }
    };
  }, []);

  useEffect(() => {
    const connectWebSocket = async () => {
      try {
        const wsUrl = await invoke('get_websocket_url');
        socketRef.current = new WebSocket(wsUrl);

        socketRef.current.onopen = () => {
          console.log('WebSocket Connected');
          startListening();
        };

        socketRef.current.onmessage = handleWebSocketMessage;

        socketRef.current.onclose = () => {
          console.log('WebSocket Disconnected');
          setTimeout(connectWebSocket, 3000);
        };

        socketRef.current.onerror = (error) => {
          console.error('WebSocket Error:', error);
        };
      } catch (error) {
        console.error('Error connecting to WebSocket:', error);
      }
    };

    connectWebSocket();

    // Set up interval to call startListening every 5 seconds
    const intervalId = setInterval(() => {
      startListening();
    }, 5000);

    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (recorderRef.current) {
        recorderRef.current.destroy();
      }

      clearInterval(intervalId);
    };
  }, []);

  const handleWebSocketMessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('Received WebSocket message:', data);
      switch(data.type) {
        case 'chat_response':
          console.log('Received chat response');
          if (data.audio_url) {
            await downloadAudio(data.audio_url);
          }
          break;
        case 'transcription_result':
          console.log('Received transcription result:', data.text);
          break;
        case 'start_listening':
          console.log('Server requested to start listening');
          await startRecording();
          break;
        case 'stop_listening_response':
          console.log('Server confirmed stop listening');
          break;
        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
    }
  };


  const startListening = () => {
    console.log('startListening called');
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      console.log('Sending listen request to server');
      socketRef.current.send(JSON.stringify({ type: 'listen' }));
    } else {
      console.error('WebSocket is not open. Cannot start listening.');
    }
  };

  const startRecording = async () => {
    console.log('startRecording called');
    if (recorderRef.current) {
      console.log('Recording is already in progress. Skipping.');
      return;
    }
    if (window.wave && window.wave.isPlaying()) {
      console.log('Audio is currently playing. Skipping recording.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorderRef.current = new RecordRTC(stream, {
        type: 'audio',
        mimeType: 'audio/wav',
        recorderType: RecordRTC.StereoAudioRecorder,
        numberOfAudioChannels: 1,
      });

      recorderRef.current.startRecording();
      console.log('Recording started');

      // Stop recording after 5 seconds
      timeoutRef.current = setTimeout(() => {
        stopRecording();
      }, 5000);
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  };

  const stopRecording = () => {
    console.log('stopRecording called');
    if (recorderRef.current) {
      recorderRef.current.stopRecording(async () => {
        console.log('Recording stopped');

        let blob = await recorderRef.current.getBlob();
        console.log('Recorded audio blob size:', blob.size, 'bytes');

        if (blob.size > 0) {
          await uploadAudioFile(blob);
        } else {
          console.warn('No audio data recorded');
          //alert('No audio was detected. Please try speaking louder or check your microphone.');
        }

        // Destroy the recorder
        recorderRef.current.destroy();
        recorderRef.current = null;
      });
    } else {
      console.warn('Attempted to stop recording, but recorder was not initialized');
    }
  };


  const uploadAudioFile = useCallback(async (blob) => {
    logState('uploadAudioFile called');
    if (!(blob instanceof Blob) || blob.size === 0) {
      console.error('Invalid or empty blob object:', blob);
      setState(STATES.IDLE);
      return;
    }

    try {
      const formData = new FormData();
      formData.append('audio', blob, 'temp_audio.wav');

      console.log('Uploading audio file...');
      const response = await fetch('http://192.168.254.23:5000/upload_audio', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        console.log('Audio file uploaded successfully');
        const responseText = await response.text();
        console.log('Server response:', responseText);
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          console.log('Sending process_audio message via WebSocket');
          socketRef.current.send(JSON.stringify({
            type: 'process_audio',
            filename: 'temp_audio.wav'
          }));
        } else {
          console.error('WebSocket is not open, cannot send process_audio message');
          setState(STATES.IDLE);
        }
      } else {
        const errorText = await response.text();
        console.error('Failed to upload audio file:', response.status, response.statusText, errorText);
        setState(STATES.IDLE);
      }
    } catch (error) {
      console.error('Error uploading audio file:', error);
      setState(STATES.IDLE);
    }
  }, [setState, logState]);

  const isValidWavFile = (header) => {
    const riffHeader = String.fromCharCode(...header.slice(0, 4));
    const waveHeader = String.fromCharCode(...header.slice(8, 12));
    return riffHeader === 'RIFF' && waveHeader === 'WAVE';
  };

  const downloadAudio = async (audioUrl) => {
    if (window.wave && window.wave.isPlaying()) {
      console.log('Audio is currently playing. Skipping download.');
      return;
    }
    try {
      console.log('Downloading audio from:', audioUrl);
      const response = await fetch(audioUrl, { method: 'GET' });
      
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const fileName = 'output.wav';
        const filePath = await join(audioFolder, fileName);
        // Use the new write_file function
        await invoke('write_file', { 
          filePath: filePath, 
          contents: Array.from(new Uint8Array(arrayBuffer)) 
        });
        console.log('Audio file saved to:', filePath);

        // Verify the file
        const fileContent = await readBinaryFile(filePath);
        const header = new Uint8Array(fileContent.slice(0, 12));
        if (!isValidWavFile(header)) {
          console.error('Downloaded file is not a valid WAV file');
          await removeFile(filePath);
          return null;
        }

        await playAudioResponse(filePath);
        return filePath;
      } else {
        console.error('Failed to download audio file');
        return null;
      }
    } catch (error) {
      console.error('Error downloading audio:', error);
      return null;
    }
  };

  const playAudioResponse = async (filePath) => {
    console.log('Starting playAudioResponse with path:', filePath);
    console.log('AUDIO IS PLAYING: >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> ', window.wave.isPlaying());

    if (!filePath) {
      console.log('No audio file path provided');
      return;
    }
  

    if (window.wave.isPlaying()) {
      console.log('Audio is currently playing');
      return;
    }

    try {
      console.log('Trying to play audio');
      const fileContent = await readBinaryFile(filePath);
      const header = new Uint8Array(fileContent.slice(0, 12));
      console.log('File header:', Array.from(header).map(b => b.toString(16).padStart(2, '0')).join(' '));

      console.log('Audio STARTED******************************');
      await window.wave.loadAudio(filePath);
      await window.wave.play();
      
      await removeFile(filePath);
      console.log('File deleted:', filePath);
    } catch (err) {
      console.error('Error during playback:', err);
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