import { CONFIG } from "../config";
import io from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";
import { getRoomName } from "../libs/queryParser";

export class mediasoupClientManager {
  constructor(mediaManager) {
    this.socket = io(CONFIG.SERVER_URL);
    this.device = null;
    this.mediaManager = mediaManager;
    this.producerTransport = null;
    this.consumerTransports = [];
    this.audioProducer = null;
    this.videoProducer = null;
    this.consumingTransports = [];
    this.rtpCapabilities = null;
    this.activeRecordings = new Map(); // Track active recordings by producer ID

    this.setupSocketListeners();
  }

  setupSocketListeners() {
    this.socket.on('connection-success', ({ socketId }) => {
      console.log('Connected with socket ID:', socketId);
      this.start();
    });

    // when a new remote peer joins, called twice per peer. one for audio another for video
    this.socket.on('new-producer', ({ producerId }) => {
      this.signalNewConsumerTransport(producerId);
    });

    this.socket.on('producer-closed', ({ remoteProducerId }) => {
      this.handleProducerClosed(remoteProducerId);
    });

    // Add recording status listeners
    this.socket.on('recording-started', ({ producerId, fileName }) => {
      this.activeRecordings.set(producerId, fileName);
      this.notifyRecordingStatus('started', producerId, fileName);
    });

    this.socket.on('recording-stopped', ({ producerId, filePath }) => {
      this.activeRecordings.delete(producerId);
      this.notifyRecordingStatus('stopped', producerId, filePath);
    });

    this.socket.on('recording-error', ({ producerId, error }) => {
      this.notifyRecordingStatus('error', producerId, error);
    });
  }

  async start() {
    try {
      await this.mediaManager.getLocalStream();
      this.showLocalVideo();
      this.joinRoom();
    } catch (error) {
      console.error('Failed to start:', error);
    }
  }

  showLocalVideo() {
    const localVideo = document.getElementById('localVideo');
    localVideo.srcObject = this.mediaManager.localStream;
  }

  joinRoom() {
    const roomName = getRoomName();
    this.socket.emit('joinRoom', { roomName: roomName, userName: "Guest" }, (data) => {
      this.rtpCapabilities = data.rtpCapabilities;
      this.createDevice();
    });
  }

  async createDevice() {
    try {
      this.device = new mediasoupClient.Device();
      await this.device.load({ routerRtpCapabilities: this.rtpCapabilities });
      console.log("Device created: ", this.device)
      this.createSendTransport();
    } catch (error) {
      console.error('Failed to create device:', error);
    }
  }

  createSendTransport() {
    this.socket.emit('createWebRtcTransport', { consumer: false }, ({ params }) => {
      if (params.error) {
        console.error(params.error);
        return;
      }

      this.producerTransport = this.device.createSendTransport(params);
      this.setupTransportListeners();
    });
  }

  setupTransportListeners() {
    this.producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        console.log("connecting to transport listeners")
        this.socket.emit('transport-connect', { dtlsParameters });
        callback();
      } catch (error) {
        errback(error);
      }
    });

    this.producerTransport.on('produce', async (parameters, callback, errback) => {
      try {
        this.socket.emit('transport-produce', {
          kind: parameters.kind,
          rtpParameters: parameters.rtpParameters,
          appData: parameters.appData,
        }, ({ id, producersExist }) => {
          callback({ id });
          if (producersExist) {
            console.log("getProducers()")
            this.getProducers()
          };
        });
      } catch (error) {
        errback(error);
      }
    });

    this.connectSendTransport();
  }

  async connectSendTransport() {
    const stream = this.mediaManager.localStream;
    const audioTrack = stream.getAudioTracks()[0];
    const videoTrack = stream.getVideoTracks()[0];

    this.audioProducer = await this.producerTransport.produce({
      track: audioTrack
    });

    this.videoProducer = await this.producerTransport.produce({
      track: videoTrack,
      ...CONFIG.ENCODING_PARAMETERS
    });

    this.setupProducerListeners();
  }

  setupProducerListeners() {
    ['audioProducer', 'videoProducer'].forEach(producer => {
      this[producer].on('trackended', () => {
        console.log(`${producer} track ended`);
      });

      this[producer].on('transportclose', () => {
        console.log(`${producer} transport closed`);
      });
    });
  }

  async signalNewConsumerTransport(remoteProducerId) {
    if (this.consumingTransports.includes(remoteProducerId)) return;
    this.consumingTransports.push(remoteProducerId);

    this.socket.emit('createWebRtcTransport', { consumer: true }, ({ params }) => {
      if (params.error) {
        console.error(params.error);
        return;
      }

      const consumerTransport = this.device.createRecvTransport(params);
      this.setupConsumerTransport(consumerTransport, remoteProducerId, params.id);
    });
  }

  setupConsumerTransport(consumerTransport, remoteProducerId, serverConsumerTransportId) {
    consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        this.socket.emit('transport-recv-connect', {
          dtlsParameters,
          serverConsumerTransportId
        });
        callback();
      } catch (error) {
        errback(error);
      }
    });

    this.connectRecvTransport(consumerTransport, remoteProducerId, serverConsumerTransportId);
  }

  getProducers() {
    this.socket.emit('getProducers', producerIds => {
      producerIds.forEach(id => this.signalNewConsumerTransport(id));
    });
  }

  async connectRecvTransport(consumerTransport, remoteProducerId, serverConsumerTransportId) {
    this.socket.emit('consume', {
      rtpCapabilities: this.device.rtpCapabilities,
      remoteProducerId,
      serverConsumerTransportId,
    }, async ({ params }) => {
      if (params.error) {
        console.error('Cannot Consume');
        return;
      }

      console.log("params", params)

      const consumer = await consumerTransport.consume(params);
      this.consumerTransports.push({
        consumerTransport,
        serverConsumerTransportId: params.id,
        producerId: remoteProducerId,
        consumer,
      });

      const newElem = document.createElement('div');
      newElem.setAttribute('id', `td-${remoteProducerId}`);
      // audio-container is hidden from css
      newElem.setAttribute('class', params.kind === 'audio' ? 'audio-container' : 'video-container');

      const mediaElem = params.kind === 'audio'
        ? `<audio id="${remoteProducerId}" autoplay></audio>`
        : `<video id="${remoteProducerId}" muted autoplay playsinline></video>`;

      newElem.innerHTML = mediaElem;
      document.getElementById('videoContainer').appendChild(newElem);

      const mediaStream = new MediaStream([consumer.track]);
      document.getElementById(remoteProducerId).srcObject = mediaStream;

      this.handleNewConsumer(params);
    });
  }

  handleNewConsumer(params) {
    this.socket.emit('consumer-resume', { serverConsumerId: params.serverConsumerId });
  }

  handleProducerClosed(remoteProducerId) {
    const producerToClose = this.consumerTransports.find(
      transportData => transportData.producerId === remoteProducerId
    );

    if (producerToClose) {
      producerToClose.consumerTransport.close();
      producerToClose.consumer.close();

      this.consumerTransports = this.consumerTransports.filter(
        transportData => transportData.producerId !== remoteProducerId
      );

      const elem = document.getElementById(`td-${remoteProducerId}`);
      if (elem) elem.remove();
    }
  }

  // Add recording control methods
  async startRecording(type = 'both') {
    try {
      if (type === 'audio' || type === 'both') {
        await this.startStreamRecording(this.audioProducer);
      }
      if (type === 'video' || type === 'both') {
        await this.startStreamRecording(this.videoProducer);
      }
    } catch (error) {
      console.error('Failed to start recording:', error);
      throw error;
    }
  }

  async stopRecording(type = 'both') {
    try {
      if (type === 'audio' || type === 'both') {
        await this.stopStreamRecording(this.audioProducer);
      }
      if (type === 'video' || type === 'both') {
        await this.stopStreamRecording(this.videoProducer);
      }
    } catch (error) {
      console.error('Failed to stop recording:', error);
      throw error;
    }
  }

  async startStreamRecording(producer) {
    if (!producer) {
      throw new Error('No producer available for recording');
    }

    return new Promise((resolve, reject) => {
      this.socket.emit('startRecording', { producerId: producer.id }, (response) => {
        if (response.error) {
          reject(new Error(response.error));
        } else {
          this.activeRecordings.set(producer.id, response.fileName);
          resolve(response);
        }
      });
    });
  }

  async stopStreamRecording(producer) {
    if (!producer) {
      throw new Error('No producer available for recording');
    }

    return new Promise((resolve, reject) => {
      this.socket.emit('stopRecording', { producerId: producer.id }, (response) => {
        if (response.error) {
          reject(new Error(response.error));
        } else {
          this.activeRecordings.delete(producer.id);
          resolve(response);
        }
      });
    });
  }

  isRecording(type = 'both') {
    if (type === 'audio') {
      return this.audioProducer && this.activeRecordings.has(this.audioProducer.id);
    }
    if (type === 'video') {
      return this.videoProducer && this.activeRecordings.has(this.videoProducer.id);
    }
    return (
      (this.audioProducer && this.activeRecordings.has(this.audioProducer.id)) ||
      (this.videoProducer && this.activeRecordings.has(this.videoProducer.id))
    );
  }

  notifyRecordingStatus(status, producerId, details) {
    // Emit custom event for UI updates
    const event = new CustomEvent('recordingStatusChange', {
      detail: {
        status,
        producerId,
        details,
        isAudio: this.audioProducer?.id === producerId,
        isVideo: this.videoProducer?.id === producerId
      }
    });
    window.dispatchEvent(event);
  }

}