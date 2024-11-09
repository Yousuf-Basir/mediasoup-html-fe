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
      newElem.setAttribute('class', params.kind === 'audio' ? 'audio-container': 'video-container');

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
}