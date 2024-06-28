
import { invoke } from '@tauri-apps/api/tauri';
import { readDir, removeFile } from '@tauri-apps/api/fs';
import { join } from '@tauri-apps/api/path';

class ExtendedCircularAudioWave extends CircularAudioWave {
    constructor(elem, opts = {}) {
      super(elem, opts);
      this.onended = this.onended.bind(this);
    }
  
    isPlaying() {
      return this.playing;
    }
  
    resetPlaying() {
      this.playing = false;
    }
  
    async onended() {
      if (!this.opts.loop) {
        this.playing = false;
        console.log('Audio ended, context closed');
        this.context.close();
        this.sourceNode.buffer = null;
        this.reset();
  
        this.context = new AudioContext();
        this.sourceNode = this.context.createBufferSource();
        this.analyser = this.context.createAnalyser();
  
        if (this.filePath) {
          try {
            await removeFile(this.filePath);
            console.log('File deleted:', this.filePath);
          } catch (err) {
            console.error('Error deleting file:', err);
          }
        }
      }
    }
    async loadAudio(filePath) {

        if (this.sourceNode.buffer && this.offlineContext.buffer) {
            this.sourceNode.buffer = null;
            this.offlineContext.buffer = null;
        }
        console.log(filePath);
        this.filePath = filePath;
        this._setupAudioNodes();
        this._setupOfflineContext();
    
        try {
          const fileContent = await invoke('read_file', { filePath });
          const buffer = await this.context.decodeAudioData(new Uint8Array(fileContent).buffer);
    
          this.sourceNode.buffer = buffer;
          this.offlineSource.buffer = buffer;
          this.offlineSource.start(0);
          this.offlineContext.startRendering();
    
          return new Promise((resolve, reject) => {
            this.offlineContext.oncomplete = e => {
              let buffer = e.renderedBuffer;
              this.bpm = this._getBPM([buffer.getChannelData(0), buffer.getChannelData(1)]);
    
              this._init();
              resolve();
            };
    
            this.offlineContext.onerror = err => {
              console.error('Error during offline rendering:', err);
              reject(err);
            };
          });
        } catch (error) {
          console.error('Error loading audio:', error);
        }
      }

    async reloadAudio(fileUrl) {
        if (this.sourceNode.buffer && this.offlineContext.buffer) {
            this.sourceNode.buffer = null;
            this.offlineContext.buffer = null;
        }
        this.loadAudio(fileUrl);
    }
  }
  
  export default ExtendedCircularAudioWave;