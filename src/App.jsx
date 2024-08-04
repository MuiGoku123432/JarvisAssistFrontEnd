import React, { useState, useEffect, useRef } from 'react';
import WebGLCanvas from './WebGLCanvas.jsx';
import './App.css';
import { readBinaryFile, readDir, removeFile } from '@tauri-apps/api/fs';
import { join } from '@tauri-apps/api/path';
import * as echarts from 'echarts';
import CircularAudioWave from './libs/circular-audio-wave';
import { invoke } from '@tauri-apps/api/tauri';


window.echarts = echarts;

const audioFolder = 'D:/repos/jarvis-appV2/jarvis-app/src-tauri/target/debug/outputs';

const App = () => {
  const [initialized, setInitialized] = useState(false);
  const [messages, setMessages] = useState([]);
  const socketRef = useRef(null);
  const [isListening, setIsListening] = useState(false);
  const audioMonitorRef = useRef(null);


  useEffect(() => {
    const chartContainer = document.getElementById('chart-container');
    if (chartContainer) {
      console.log('Chart container found');
      if (!window.wave) {
        console.log('Initializing CircularAudioWave Component');
        window.wave = new CircularAudioWave(chartContainer);
      }
      initializeAudio();
    } else {
      console.error('Chart container not found');
    }
  }, []);

  const initializeAudio = async () => {
    try {
      console.log('Initializing audio...');
      const entries = await readDir(audioFolder);
      const wavFiles = entries.filter(entry => entry.name.toLowerCase().endsWith('.wav'));
      console.log('WAV files:', wavFiles);

      if (wavFiles.length > 0) {
        console.log('We have a WAV file to play!');
        const filePath = await join(audioFolder, wavFiles[0].name);
        console.log('File path:', filePath);
        console.log('Loading initial audio...');

        await window.wave.loadAudio(filePath);
        await window.wave.play();
        await window.wave.resetPlaying();
        await window.wave.stop();

        await removeFile(filePath);
        console.log('File deleted:', filePath);
        setInitialized(true);
      }
    } catch (error) {
      console.error('Error during initial audio load:', error);
    }
  };


    useEffect(() => {
      const connectWebSocket = async () => {
        try {
          // Get the WebSocket URL from the Rust backend
          const wsUrl = await invoke('get_websocket_url');
          socketRef.current = new WebSocket(wsUrl);
  
          socketRef.current.onopen = () => {
            console.log('WebSocket Connected');
            setIsListening(true);
            startListening();
          };

      socketRef.current.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        console.log('Received WebSocket message:', data);
        switch(data.type) {
          case 'chat_response':
            console.log('Received chat response');
            setMessages(prev => [...prev, { type: 'assistant', content: data.response }]);
            // Remove audio playback from here
            startListening();
            break;
          case 'listen_response':
            if (data.detected_text) {
              setMessages(prev => [...prev, { type: 'user', content: data.detected_text }]);
              processUserInput(data.detected_text);
            } else {
              startListening();
            }
            break;
          default:
            console.log('Unknown message type:', data.type);
        }
      };

      socketRef.current.onclose = () => {
        console.log('WebSocket Disconnected');
        setIsListening(false);
        setTimeout(connectWebSocket, 3000);
      };

      socketRef.current.onerror = (error) => {
        console.error('WebSocket Error:', error);
        setIsListening(false);
      };
    } catch (error) {
      console.error('Error connecting to WebSocket:', error);
    }
  };

    connectWebSocket();

    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    // Start monitoring for audio files
    startAudioMonitoring();

    return () => {
      // Clean up the interval when the component unmounts
      if (audioMonitorRef.current) {
        clearInterval(audioMonitorRef.current);
      }
    };
  }, []);

  const startAudioMonitoring = () => {
    if (initialized && window.wave.isPlaying()) {
      return; // Skip if the audio is currently playing
    }
    if (audioMonitorRef.current) {
      clearInterval(audioMonitorRef.current);
    }

    audioMonitorRef.current = setInterval(async () => {
      await checkAndPlayAudio();
    }, 1000); // Check every second
  };

  const checkAndPlayAudio = async () => {
    try {
      const entries = await readDir(audioFolder);
      const wavFiles = entries.filter(entry => entry.name.toLowerCase().endsWith('.wav'));

      if (wavFiles.length > 0) {
        const filePath = await join(audioFolder, wavFiles[0].name);
        await playAudioResponse(filePath);
        //await removeFile(filePath);
      }
    } catch (error) {
      console.error('Error checking for audio files:', error);
    }
  };

  const startListening = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ command: 'listen' }));
      setIsListening(true);
    }
  };

  const processUserInput = (input) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ command: 'chat', message: input }));
    }
  };

  const playAudioResponse = async (filePath) => {
    console.log('Starting playAudioResponse with path:', filePath);
    console.log('AUDIO IS PLAYING: >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> ', window.wave.isPlaying());

    if (window.wave.isPlaying()) {
      console.log('Audio is currently playing');
      await removeFile(filePath);
      console.log('File deleted:', filePath);
      return; // Skip if the audio is currently playing
    }

    try {
      console.log('Trying to reload audio');
      
          console.log('Audio STARTED******************************');
          await window.wave.loadAudio(filePath);
          await window.wave.play()
          
          await removeFile(filePath);
          console.log('File deleted:', filePath);
      
    } catch (err) {
      console.error('Error during playback:', err);
    }
  };

  const handleButtonClick = () => {
    connectWebSocket();
    if (isListening) {
      setIsListening(false);
      if (socketRef.current) {
        socketRef.current.close();
      }
    } else {
      startListening();
    }
  };

  return (
    <div className='App'>
      <WebGLCanvas />
      <div className="overlay">
        <div>
          <button id="button" className={isListening ? 'play-button-stop' : 'play-button-start'} onClick={handleButtonClick}>
            {'J.A.R.V.I.S'}
          </button>
        </div>
        <div id="chart-container" className='overlay'></div>
      </div>
    </div>
  );
};

export default App;