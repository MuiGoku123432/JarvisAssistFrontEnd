import React from 'react';
import ReactDOM from 'react-dom';
import App from './App.jsx';
//import CircularAudioWave from '../node_modules/circular-audio-wave/dist/circular-audio-wave.min.js';

document.addEventListener('DOMContentLoaded', function() {
  const rootElement = document.getElementById('root');
  if (rootElement) {
    ReactDOM.render(<App />, rootElement);
  } else {
    console.error('Root element not found');
  }
});