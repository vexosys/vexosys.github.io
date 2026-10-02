'use strict';

var isChannelReady = false;
var isInitiator = false;
var isStarted = false;
var localStream;
var pc;
var turnReady;

let channelSnd;
let starttime;

let camAudio = false;
let appAudio = false;

let inboundStream = null;

// Mock context tracker replacing Socket.io tracking properties on the instance
const socketState = {
    id: null
};

// Central routing dictionary replacing socket.on() mapping matrices
const eventListeners = {};

function registerSocketEvent(event, callback) {
    eventListeners[event] = callback;
}

function emitSocketEvent(event, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: event, payload: payload }));
    } else {
        console.error("WebSocket is not connected. Cannot emit:", event);
    }
}


// Could prompt for room name:
var roomId = prompt('Enter camera name:', '65f570720af337cec5335a70ee88cbfb7df32b5ee33ed0b4a896a0');

if (roomId === '') {
  roomId = '65f570720af337cec5335a70ee88cbfb7df32b5ee33ed0b4a896a0';
}

// Initialize native web socket attachment logic
// Adjust 'ws://localhost:3000' to match your host endpoint if running across external ports
const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
const ws = new WebSocket(wsUrl);

ws.onopen = function() {
    console.log('Connected to WebSocket Server');
    // Equivalent initialization hook to replace standard baseline registration loops
    emitSocketEvent('createorjoin', { roomId: roomId, client: true });
    console.log('Attempted to createorjoin roomId', roomId);
};

ws.onmessage = function(eventMessage) {
    try {
        const packet = JSON.parse(eventMessage.data);
        const eventName = packet.event;
        const payload = packet.payload;

        if (eventListeners[eventName]) {
            if (Array.isArray(payload)) {
                eventListeners[eventName].apply(null, payload);
            } else {
                eventListeners[eventName](payload);
            }
        }
    } catch (err) {
        console.error("Error parsing incoming message frame:", err);
    }
};

ws.onerror = function(error) {
    console.error("WebSocket Error encountered:", error);
};

ws.onclose = function() {
    console.log("WebSocket Connection down.");
};

// Event Subscriptions via the custom Native Event Mapping System
registerSocketEvent('created', function(room) {
    console.log('Created room ' + room);
    isInitiator = true;
});

registerSocketEvent('join', function(room, id, numClients) {
    console.log('New peer joins, room: ' + room + ', ' + " client id: " + id);
    
    // Save assigned runtime ID tracking reference to mimic Socket.io mechanics
    socketState.id = id;
    isChannelReady = true;

    if(numClients > 1)
        isInitiator = true;

    maybeStart();
});

registerSocketEvent('joined', function(msg) {
  console.log('joined: %o %o %o ', msg , socketState.id, msg.from  );
  isChannelReady = true;
});

registerSocketEvent('log', function(array) {
  console.log.apply(console, array);
});

function sendMessage(message) {
    console.log('Client sending message: ', message);
    emitSocketEvent('message', message);
}


// This client receives a message router handler configuration
registerSocketEvent('message', function(message) {
  console.log('Client received message:', message);

   if (message.type === 'offer') {
    if (!isInitiator && !isStarted) {
      maybeStart();
    }

    pc.setRemoteDescription(new RTCSessionDescription(message.desc));
    doAnswer();
  } else if (message.type === 'answer' && isStarted) {
    pc.setRemoteDescription(new RTCSessionDescription(message.desc));
  } else if (message.type === 'candidate' && isStarted) {

    var candidate = new RTCIceCandidate({
      sdpMLineIndex: message.candidate.sdpMLineIndex,
      sdpMid: message.candidate.sdpMid,
      candidate: message.candidate.candidate
    });
    pc.addIceCandidate(candidate);
  } 
  
});



async function maybeStart() {
  console.log('>>>>>>> maybeStart() ', isStarted, localStream, isChannelReady);
  if (!isStarted  && isChannelReady) {
    console.log('>>>>>> creating peer connection');
    createPeerConnection();

    if( appAudio)
    {
      localVideoStream();
      
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});

      var localVideo = document.querySelector('#localVideo');
      localVideo.srcObject = stream;
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      const transceiver = pc.getTransceivers().find(t => t.sender && t.sender.track === stream.getAudioTracks()[0]);
      const {codecs} = RTCRtpSender.getCapabilities('audio');
      const selectedCodecIndex = codecs.findIndex(c => c.mimeType === 'audio/PCMA');
      transceiver.setCodecPreferences([codecs[selectedCodecIndex]]);
    }
    else if (camAudio) 
    {
      var tvrs = pc.addTransceiver("audio", {
                direction: "recvonly"
      });

      const codecs = RTCRtpReceiver.getCapabilities('audio').codecs;;
      const selectedCodecIndex = codecs.findIndex(c => c.mimeType === 'audio/PCMA');
      tvrs.setCodecPreferences([codecs[selectedCodecIndex]]);

      remoteVideo.muted = false;
    }
   
    isStarted = true;
    if (isInitiator) {
        doCall();
    }
  }
}

 let receivedChannel;

function createPeerConnection() {
  try {
      pc = new RTCPeerConnection(
      {
          iceServers         : [{'urls': 'stun:stun.l.google.com:19302'}],
          iceTransportPolicy : 'all',
          bundlePolicy       : 'max-bundle',
          rtcpMuxPolicy      : 'require',
          sdpSemantics       : 'unified-plan'
      });


   

    pc.ondatachannel = (event) => {
    // This is your 'receivedChannel'
    receivedChannel = event.channel;
    
    // Configure matching binary type
    receivedChannel.binaryType = "arraybuffer";

    // Handle Open Event
    receivedChannel.onopen = () => {
        console.log("Received channel is open and ready to use.");
        // Reply back immediately if desired
       // receivedChannel.send("hi onopen testing you 2");

        term.write('\r\n\x1b[32m*** WebRTC Channel Open ***\x1b[0m\r\n\r\n');

          // Send initial dimensions
       // sendResizeSignal(term.cols, term.rows);

          const emptyJsonBuffer = encoder.encode('{}').buffer;
          receivedChannel.send(emptyJsonBuffer);

    };

    // Handle Close Event
    receivedChannel.onclose = () => {

        console.log("Received data channel is closed.");

        // 1. Notify the user before cleanup (Optional)
        term.write('\r\n\x1b[31m*** Session Closed. Cleaning up... ***\x1b[0m\r\n');

        // 2. Remove event listeners to prevent memory leaks
        window.removeEventListener('resize', fitAddon.fit);

        // 3. Destroy the Xterm instance and detach it from the DOM
        term.dispose();


    };

    // Complete handled 'onmessage' function
    receivedChannel.onmessage = (event) => {


       const buffer = event.data;
      if (!buffer || buffer.byteLength === 0) return;

      //const view = new Uint8Array(buffer);
      const cmd = String.fromCharCode(new Uint8Array(buffer)[0]); // Byte 0 = Command Opcode
      const payloadBytes = buffer.slice(1); // Payload bytes

      switch (cmd) {
        case CMD_SERVER.OUTPUT:
          // Decode payload bytes back to string for Xterm[cite: 1]
          term.write(decoder.decode(payloadBytes));
          break;

        case CMD_SERVER.SET_WINDOW_TITLE: {
          const title = decoder.decode(payloadBytes);
          document.title = title;
          document.getElementById('page-title').textContent = title;
          break;
        }

        case CMD_SERVER.SET_PREFERENCES:
          try {
            const prefs = JSON.parse(decoder.decode(payloadBytes));
            Object.keys(prefs).forEach((key) => {
              term.options[key] = prefs[key];
            });
            fitAddon.fit();
          } catch (err) {
            console.error('Failed to parse preferences payload:', err);
          }
          break;

        default:
          console.warn('Unknown Server Command Opcode:', cmd);
          break;
      }






        };

        //receivedChannel.close();
    };


    channelSnd = pc.createDataChannel("chat", { ordered: true });
    channelSnd.binaryType = 'arraybuffer'; // Configure channel for binary handling
    
     channelSnd.onopen = function()
     {
        console.log("onopen");
        // channelSnd.send('Hi you!');



     }
    
     channelSnd.onmessage = function(event)
     {
         console.log("onmessage event.data " + event.data);
         //channelSnd.send('Hi you!');
        // channelSnd.close();
     }

     channelSnd.onclose = function()
     {
         console.log("onclose " );

     }
        

    channelSnd.onerror = function(event)
    {
        console.error("onerror An operational failure occurred:", event.error.message);
        // Log telemetry or attempt recovery here
    }


        
    pc.onicecandidate = handleIceCandidate;
    pc.ontrack = ontrack;
    pc.onremovestream = handleRemoteStreamRemoved;
    pc.addEventListener('iceconnectionstatechange', e => onIceStateChange(pc, e));
    console.log('Created RTCPeerConnnection');
  } catch (e) {
    console.log('Failed to create PeerConnection, exception: ' + e.message);
    alert('Cannot create RTCPeerConnection object.');
  }
}


function handleIceCandidate(event) {
  console.log('icecandidate event: ', event);
  if (event.candidate) {
    sendMessage({
      room: roomId,
      type: 'candidate',
      candidate: event.candidate
    });
  } else {
    console.log('End of candidates.');
  }
}

function handleCreateOfferError(event) {
    console.log('createOffer() error: ', event);
}

function doCall() {
    console.log('Sending offer to peer');
    pc.createOffer(setLocalAndSendMessage, handleCreateOfferError);
}

function doAnswer() {
    console.log('Sending answer to peer.');
    pc.createAnswer().then(
        setLocalAndSendMessage,
        onCreateSessionDescriptionError
    );
}

function setLocalAndSendMessage(sessionDescription) {
    // for changing bandwidth,bitrate and audio stereo/mono
    // sessionDescription.sdp = sessionDescription.sdp.replace("useinbandfec=1", "useinbandfec=1; minptime=10; cbr=1; stereo=1; sprop-stereo=1; maxaveragebitrate=510000");
    // sessionDescription.sdp = sessionDescription.sdp.replace("useinbandfec=1", "useinbandfec=1; minptime=10; stereo=1; maxaveragebitrate=510000");

    if( starttime && starttime.length)
    sessionDescription.sdp = sessionDescription.sdp.replaceAll("level-asymmetry-allowed=1", "level-asymmetry-allowed=1; Enc=" + starttime);

    pc.setLocalDescription(sessionDescription);
    console.log('setLocalAndSendMessage sending message', sessionDescription);

    sendMessage({
        room: roomId,
        type: sessionDescription.type,
        starttime:starttime,
        camAudio:camAudio,
        appAudio:appAudio,
        desc: sessionDescription
    });
}

function onCreateSessionDescriptionError(error) {
    //log('Failed to create session description: ' + error.toString());
    console.log('Failed to create session description: ' + error.toString());
}


function ontrack({
    transceiver,
    receiver,
    streams: [stream]
}) {
    var track = transceiver.receiver.track;
    var trackid = stream.id;

    if (!inboundStream) {
            inboundStream = new MediaStream();
        }
        inboundStream.addTrack(track);
        remoteVideo.srcObject = inboundStream;

        remoteVideo.play()
            .then(() => {
                // if (cv) {
                //     cv.width = el.offsetWidth;;
                //     cv.height = el.offsetHeight
                // }
            })
            .catch((e) => {
                console.log("play eror %o ", e);
            });


       
        stream.onaddtrack = () => console.log("stream.onaddtrack");
        stream.onremovetrack = () => console.log("stream.onremovetrack");
        transceiver.receiver.track.onmute = () => console.log("transceiver.receiver.track.onmute " + track.id);
        transceiver.receiver.track.onended = () => console.log("transceiver.receiver.track.onended " + track.id);
        transceiver.receiver.track.onunmute = () => {
        console.log("transceiver.receiver.track.onunmute " + track.id);
 

  };


}


function handleRemoteStreamRemoved(event) {
    console.log('Remote stream removed. Event: ', event);
}

function hangup() {
    console.log('Hanging up.');
    stop();
   
}

function handleRemoteHangup() {
    console.log('Session terminated.');
    stop();
}

function stop() {
    isStarted = false;
    if(pc)
    {
       pc.close();
       pc = null;
    }

    inboundStream = null;

    isChannelReady = false;
    isInitiator = false;


}

function onIceStateChange(pc, event) {
    switch (pc.iceConnectionState) {
        case 'checking': {
            console.log('checking...');
        }
        break;
        case 'connected':
            console.log('connected...');
            break;
        case 'completed':
            console.log('completed...');
            break;
        case 'failed':
            console.log('failed...');
            break;
        case 'disconnected':
            console.log('Peerconnection disconnected...');
            break;
        case 'closed':
            console.log('failed...');
            break;
    }
}




  // --- Protocol Command Identifiers ---
  const CMD_CLIENT = {
    INPUT: '0',
    RESIZE_TERMINAL: '1',
    PAUSE: '2',
    RESUME: '3'
  };

  const CMD_SERVER = {
    OUTPUT: '0',
    SET_WINDOW_TITLE: '1',
    SET_PREFERENCES: '2'
  };



const encoder = new TextEncoder();
const decoder = new TextDecoder();


const term = new window.Terminal({
    cursorBlink: true,
    fontFamily: 'Courier New, monospace',
    fontSize: 14
  });

  const fitAddon = new window.FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal-container'));
  fitAddon.fit();

  window.addEventListener('resize', () => fitAddon.fit());


  term.onData((data) => {
      sendControlCommand(CMD_CLIENT.INPUT, data);
    });

    // Window resize handler -> Send Command '1'
    term.onResize(({ cols, rows }) => {
      sendResizeSignal(cols, rows);
    });


  // --- UI Control Buttons (Pause / Resume Commands) ---
  document.getElementById('btn-pause').addEventListener('click', () => {
    sendControlCommand(CMD_CLIENT.PAUSE);
    term.write('\r\n\x1b[33m[Stream Paused]\x1b[0m\r\n');
  });

  document.getElementById('btn-resume').addEventListener('click', () => {
    sendControlCommand(CMD_CLIENT.RESUME);
    term.write('\r\n\x1b[32m[Stream Resumed]\x1b[0m\r\n');
  });





  // // Generic Frame Sender: [1-Byte Code][Payload String]
  // function sendControlCommand(cmdCode, payload = '') {
  //   if (receivedChannel && receivedChannel.readyState === 'open') {
  //     receivedChannel.send(cmdCode + payload);
  //   }
  // }


function sendControlCommand(cmdCode, payload = '') {
  if (receivedChannel && receivedChannel.readyState === 'open') {
   // const payloadBytes = typeof payload === 'string' ? encoder.encode(payload) : payload;
   // const packet = new Uint8Array(1 + payloadBytes.byteLength);

  //  packet[0] = cmdCode; // First byte represents command opcode
   // packet.set(payloadBytes, 1); // Remaining bytes contain encoded payload



    receivedChannel.send(encoder.encode(cmdCode + payload));
  }
}




  // Convenience function to package CMD_CLIENT.RESIZE_TERMINAL

function sendResizeSignal(cols, rows) {
  const jsonPayload = JSON.stringify({ cols: cols, rows: rows });
  sendControlCommand(CMD_CLIENT.RESIZE_TERMINAL, jsonPayload);
}



// document.addEventListener('visibilitychange', () => {
//     if (document.hidden) {
//         // Automatically pause when the user leaves the tab
//         sendControlCommand(CMD_CLIENT.PAUSE);
//         term.write('\r\n\x1b[33m[Tab Inactive: Stream Automatically Paused]\x1b[0m\r\n');
//     } else {
//         // Automatically resume when the user returns to the tab
//         sendControlCommand(CMD_CLIENT.RESUME);
//         term.write('\r\n\x1b[32m[Tab Active: Stream Automatically Resumed]\x1b[0m\r\n');
//     }
// });