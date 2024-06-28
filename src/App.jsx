import React, { useState, useEffect } from 'react';
import WebGLCanvas from './WebGLCanvas.jsx';
import './App.css';
import { readBinaryFile, readDir, removeFile } from '@tauri-apps/api/fs';
import { join } from '@tauri-apps/api/path';
import * as echarts from 'echarts';
import CircularAudioWave from './libs/circular-audio-wave';

// Ensure echarts is available globally
window.echarts = echarts;

const audioFolder = 'D:/repos/jarvis-appV2/jarvis-app/src-tauri/target/debug/outputs'; // Replace with the path to your audio folder

const App = () => {
  const [initialized, setInitialized] = useState(false);

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
  }, []);

  const handleButtonClick = async () => {
    console.log('Button clicked');
    if (!initialized) {
      try {
        console.log('IN THE BAD PLACE AFTER INITIALIZE');
        const entries = await readDir(audioFolder);
        const wavFiles = entries.filter(entry => entry.name.toLowerCase().endsWith('.wav'));
        console.log('WAV files:', wavFiles);

        if (wavFiles.length > 0) {
          console.log('We have a WAV file to play!');
          const filePath = await join(audioFolder, wavFiles[0].name);
          console.log('File path:', filePath);
          console.log('Loading initial audio...');
          console.log('THIS IS IT IT IS HAPPENING', await readDir(audioFolder));
          console.log('THIS IS IT IT IS HAPPENING', await readBinaryFile(filePath));

          await window.wave.loadAudio(filePath); // Replace with the actual path to your initial audio file
          await window.wave.play();
          await removeFile(filePath);
          console.log('File deleted:', filePath);
          setInitialized(true);
          setTimeout(() => {
            startMonitoringLoop();
          }, 5000)
        }
        
      } catch (error) {
        console.error('Error during initial audio load:', error);
      }
    }
    else {
      console.warn('Audio already loaded');
    }
  };

  const startMonitoringLoop = () => {
    const monitorFolder = async () => {
      if (window.wave.isPlaying()) {
        console.log('Audio is currently playing');
        return; // Skip if the audio is currently playing
      }

      try {
        const entries = await readDir(audioFolder);
        const wavFiles = entries.filter(entry => entry.name.toLowerCase().endsWith('.wav'));
        console.log('WAV files:', wavFiles);

        if (wavFiles.length > 0) {
          console.log('We have a WAV file to play!');
          const filePath = await join(audioFolder, wavFiles[0].name);
          console.log('File path:', filePath);

          try {
            console.log('Trying to reload audio');
            await window.wave.reLoadAudio(filePath);
            
            if (!window.wave.isPlaying()) {
              await window.wave.play()
              await removeFile(filePath);
              console.log('File deleted:', filePath);
            }
            //await window.wave.onended();
            
            
          } catch (err) {
            console.error('Error during playback:', err);
          }
        }
      } catch (err) {
        console.error('Error reading directory:', err);
      }
    };

    //monitorFolder(); // Check immediately
    const intervalId = setInterval(monitorFolder, 1000); // Check every second

    return () => clearInterval(intervalId); // Clean up the interval on unmount
  };

  return (
    <div className='App'>
      <WebGLCanvas />
      <div className="overlay">
        <div>
          <button id="button" className="play-button" onClick={handleButtonClick}>J.A.R.V.I.S</button>
        </div>
        <div id="chart-container" className='overlay'></div>
      </div>
    </div>
  );
};

export default App;
