import { CONFIG } from "../config";

export class MediaManager {
  constructor() {
    this.localStream = null;
    this.audioEnabled = true;
    this.videoEnabled = true;
  }

  async getLocalStream() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: CONFIG.VIDEO_CONSTRAINTS
      });
      return this.localStream;
    } catch (error) {
      console.error('Failed to get local stream:', error);
      throw error;
    }
  }

  toggleAudio() {
    if (this.localStream) {
      this.audioEnabled = !this.audioEnabled;
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = this.audioEnabled;
      });
      return this.audioEnabled;
    }
  }

  toggleVideo() {
    if (this.localStream) {
      this.videoEnabled = !this.videoEnabled;
      this.localStream.getVideoTracks().forEach(track => {
        track.enabled = this.videoEnabled;
      });
      return this.videoEnabled;
    }
  }
}