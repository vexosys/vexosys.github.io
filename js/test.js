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


// Helper function to check if candidate contains a private IP address or local mDNS address
function isPrivateIp(ip) {
  const normalizedIp = ip.toLowerCase();

  // Block .local mDNS hostnames
  if (normalizedIp.endsWith('.local')) return true;

  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = ip.match(ipv4Pattern);

  if (match) {
    const octets = match.slice(1, 5).map(Number);
    if (octets[0] === 127) return true; // Loopback
    if (octets[0] === 10) return true; // Private
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true; // Private
    if (octets[0] === 192 && octets[1] === 168) return true; // Private
    if (octets[0] === 169 && octets[1] === 254) return true; // Link-local
    if (octets[0] === 0) return true;
    return false;
  }

  if (normalizedIp === '::1') return true; // Loopback
  if (normalizedIp.startsWith('fc') || normalizedIp.startsWith('fd')) return true; // Unique Local
  if (
    normalizedIp.startsWith('fe8') ||
    normalizedIp.startsWith('fe9') ||
    normalizedIp.startsWith('fea') ||
    normalizedIp.startsWith('feb')
  ) {
    return true; // Link-Local
  }

  return false;
}

function isPublicCandidate(candidateString) {
  const parts = candidateString.split(' ');
  if (parts.length < 5) return false;
  const ip = parts[4];
  return !isPrivateIp(ip);
}



// Read GUI state for Public IP candidates filter
function isPublicOnlyFilterEnabled() {
  const checkbox = document.querySelector('#publicOnlyFilter');
  return checkbox ? checkbox.checked : false;
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

    const candStr = message.candidate && message.candidate.candidate;



    // Filter incoming remote candidate if Public-only filter is enabled
    if (isPublicOnlyFilterEnabled() && candStr && !isPublicCandidate(candStr)) {
      console.log('Filtered out private/non-public remote ICE candidate:', candStr);
      return;
    }

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


function createPeerConnection() {
  try {
    pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        // Add a TURN server using transport=tcp
        {
          urls: 'turn:openrelay.metered.ca:80?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turn:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ],
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      sdpSemantics: 'unified-plan'
    });

    pc.ondatachannel = (event) => {
    // This is your 'receivedChannel'
    const receivedChannel = event.channel;
    
    // Configure matching binary type
    receivedChannel.binaryType = "arraybuffer";

    // Handle Open Event
    receivedChannel.onopen = () => {
        console.log("Received channel is open and ready to use.");
        // Reply back immediately if desired
        receivedChannel.send("hi onopen testing you 2");
    };

    // Handle Close Event
    receivedChannel.onclose = () => {
        console.log("Received channel is closed 2.");
    };

    // Complete handled 'onmessage' function
    receivedChannel.onmessage = (event) => {
        const rawData = event.data;
          //console.log("Remote received plain text string:", rawData);
       // 1. Handle Text Data
        if (typeof rawData === "string") {
            try {
                // Check if it is a JSON object
                const parsedJson = JSON.parse(rawData);
                console.log("Remote received JSON Object:", parsedJson);
                } catch (e) {
                // If parsing fails, treat it as a standard string
                console.log("Remote received plain text string:", rawData);
            }
        } 
        // 2. Handle Binary Data (ArrayBuffer)
        else if (rawData instanceof ArrayBuffer) {
            console.log(`Remote received binary data of size: ${rawData.byteLength} bytes`);
         
        }

        // 3. Create your binary data (e.g., a 4-byte buffer)
        const buffer = new ArrayBuffer(4);
        const view = new Int32Array(buffer);
        view[0] = 42; // Example data`


         receivedChannel.send(buffer);
        };

        //receivedChannel.close();
    };


     channelSnd = pc.createDataChannel("chat"); 
    
     channelSnd.onopen = function()
     {
         console.log("onopen");
         channelSnd.send('Hi you!');
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
    const candStr = event.candidate.candidate;



    // Filter outgoing local candidate if Public-only filter is enabled
    if (isPublicOnlyFilterEnabled() && candStr && !isPublicCandidate(candStr)) {
      console.log('Filtered out private/non-public local ICE candidate:', candStr);
      return;
    }

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



async function checkWebRtcRoles1() {
  try {
    const stats = await pc.getStats();
    
    stats.forEach(report => {
      // 1. Check ICE Roles
      if (report.type === 'transport') {
        console.log(`ICE Role: ${report.iceRole}`); 
        // Outputs: "controlling" or "controlled"
      }
      
      // 2. Check DTLS Roles
      if (report.type === 'certificate') {

      }
    });
  } catch (error) {
    console.error("Error fetching WebRTC stats:", error);
  }
}



async function checkWebRtcRoles2() {
  if (!pc) {
    console.warn("PeerConnection object does not exist yet.");
    return;
  }

  // FIX: Verify localDescription is not null before checking SDP
  if (pc.localDescription && pc.localDescription.sdp) {
    const sdp = pc.localDescription.sdp;
    
    if (sdp.includes("a=setup:actpass")) {
      console.log("DTLS Role: Willing to be client or server");
    } else if (sdp.includes("a=setup:active")) {
      console.log("DTLS Role: Client");
    } else if (sdp.includes("a=setup:passive")) {
      console.log("DTLS Role: Server");
    }
  } else {
    console.log("SDP is not ready yet. Wait for createOffer/createAnswer to finish.");
  }
}



async function checkDtlsState() {
  const stats = await pc.getStats();
  let state = 'unknown';
  stats.forEach((report) => {
    if (report.type === 'transport') {
      state = report.dtlsState; // "connected", "connecting", "failed", etc.

        console.log("Error fetching WebRTC stats:", state);
    }
  });
  return state;
}