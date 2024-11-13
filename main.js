import { MediaManager } from "./managers/mediaManager";
import { mediasoupClientManager } from "./managers/mediasoupClientManager";

document.addEventListener('DOMContentLoaded', () => {
  const mediaManager = new MediaManager();
  const mediasoupManager = new mediasoupClientManager(mediaManager);

  // UI Controls
  const muteAudioButton = document.getElementById('muteAudio');
  const muteVideoButton = document.getElementById('muteVideo');
  const leaveButton = document.querySelector('.leave-button');

  muteAudioButton.addEventListener('click', () => {
    const isEnabled = mediaManager.toggleAudio();
    muteAudioButton.querySelector('.control-button-label').textContent =
      isEnabled ? 'Mute' : 'Unmute';

    if (isEnabled) {
      muteAudioButton.querySelector('.control-button-circle').classList.remove('mute-active');
    } else {
      muteAudioButton.querySelector('.control-button-circle').classList.add('mute-active');
    }
  });

  muteVideoButton.addEventListener('click', () => {
    const isEnabled = mediaManager.toggleVideo();
    muteVideoButton.querySelector('.control-button-label').textContent =
      isEnabled ? 'Stop Video' : 'Start Video';
    if (isEnabled) {
      muteVideoButton.querySelector('.control-button-circle').classList.remove('mute-active');
    } else {
      muteVideoButton.querySelector('.control-button-circle').classList.add('mute-active');
    }
  });

  leaveButton.addEventListener('click', () => {
    window.location.href = '/'; // Or your preferred leave room behavior
  });


  // Recording UI events
  document.getElementById('startRecordButton').addEventListener('click', async () => {
    try {
      await mediasoupManager.startRecording('both');
      // Update UI to show recording status
    } catch (error) {
      console.error('Failed to start recording:', error);
      // Show error message to user
    }
  });

  document.getElementById('stopRecordButton').addEventListener('click', async () => {
    try {
      await mediasoupManager.stopRecording('both');
      // Update UI to show recording stopped
    } catch (error) {
      console.error('Failed to stop recording:', error);
      // Show error message to user
    }
  });
});