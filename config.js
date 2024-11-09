export const CONFIG = {
    // SERVER_URL: 'https://103.191.179.241:3210/mediasoup',
    SERVER_URL: 'https://api-media.quarkshub.com/mediasoup',
    VIDEO_CONSTRAINTS: {
      width: { min: 640, max: 1920 },
      height: { min: 400, max: 1080 }
    },
    ENCODING_PARAMETERS: {
      encodings: [
        { rid: 'r0', maxBitrate: 100000, scalabilityMode: 'S1T3' },
        { rid: 'r1', maxBitrate: 300000, scalabilityMode: 'S1T3' },
        { rid: 'r2', maxBitrate: 900000, scalabilityMode: 'S1T3' }
      ],
      codecOptions: {
        videoGoogleStartBitrate: 1000
      }
    }
  };
  