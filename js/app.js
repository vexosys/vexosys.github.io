const SUPABASE_URL = 'https://dabwulkpyquthvearbfw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_1V4Zaw720lrIPx8IqmuxmA_ri32Bdqu';

let supabaseClient;
let channel;
let myRole = null; 
const myClientId = 'client_' + Math.random().toString(36).substr(2, 9);

let activeDataChannel = null; 
let pc = null;
let roomTopic = "";

let remoteDescriptionSet = false;
const remoteIceQueue = [];

let receivedChannel;



// ==========================================
// VIEWER ENGINE CODE (INITIATOR)
// ==========================================
async function initiateViewerConnection() {
  console.log(`[Viewer PeerConnection] Constructing new RTCPeerConnection instance...`);
  
  remoteDescriptionSet = false;
  remoteIceQueue.length = 0;

  pc = new RTCPeerConnection(
      {
          iceServers         : [{'urls': 'stun:stun.l.google.com:19302'}],
          iceTransportPolicy : 'all',
          bundlePolicy       : 'max-bundle',
          rtcpMuxPolicy      : 'require',
          sdpSemantics       : 'unified-plan'
      });

  console.log(`[Viewer DataChannel] Generating 'bidirectional-chat' transmission track...`);
  activeDataChannel = pc.createDataChannel("bidirectional-chat", { ordered: true });
  setupDataChannelListeners(activeDataChannel);

  // DETECTION LAYER 1: Monitors standard peer state drop events
  pc.onconnectionstatechange = () => {
    console.log(`WebRTC Link Pipeline State: ${pc.connectionState}`);
    
    if (pc.connectionState === "disconnected" || pc.connectionState === "failed" || pc.connectionState === "closed") {
      handleServerDisconnect("WebRTC pipeline dropped/failed.");
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`[Viewer ICE] Local Candidate Generated:`, event.candidate);
      channel.send({
        type: 'broadcast',
        event: 'signal-to-host',
        payload: {
          clientId: myClientId,
          signal: {
            type: 'candidate',
            candidate: event.candidate
          }
        }
      });
    }
  };


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

   
  };


  console.log(`[Viewer PeerConnection] Creating local SDP Offer payload...`);
  const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
  await pc.setLocalDescription(offer);

  console.log("Signaling: Channel sync confirmed. Routing SDP Offer payload to Host...");
  channel.send({
    type: 'broadcast',
    event: 'signal-to-host',
    payload: {
      clientId: myClientId,
      signal: {
        type: offer.type,
        sdp: offer.sdp
      }
    }
  });
}

// Handler function to process server exit updates cleanly across layout frames
function handleServerDisconnect(reason) {
  const errorMessage = `[CRITICAL] Server Disconnected! Reason: ${reason}`;
  console.error(errorMessage);

  // Print notice directly to the user UI using your layout element hooks
  const titleDisplay = document.getElementById('roleTitle');
  if (titleDisplay) {
    titleDisplay.innerText = "Status: Server Offline / Disconnected";
    titleDisplay.style.color = "#ff3333";
  }

  // Cleanup broken session allocations
  activeDataChannel = null;
  if (pc) {
    pc.close();
    pc = null;
  }
}

async function processRemoteIceQueue() {
  console.log(`[Viewer ICE Pipeline] Flushing ${remoteIceQueue.length} queued remote candidates.`);
  while (remoteIceQueue.length > 0) {
    const candidatePayload = remoteIceQueue.shift();
    try {
      await pc.addIceCandidate(candidatePayload);
      console.log("[Viewer ICE Success] Queued Remote Candidate successfully applied.");
    } catch (e) {
      console.error("[Viewer ICE Error] Failed to process queued candidate:", e);
    }
  }
}

function setupDataChannelListeners(dc) {
  dc.onopen = () => {
    console.log("SCTP Link: Data stream channel successfully established.");
    const titleDisplay = document.getElementById('roleTitle');
    if (titleDisplay) {
      titleDisplay.innerText = "Role: Viewer (Connected to Server)";
      titleDisplay.style.color = "";
    }
  };

  dc.onmessage = (msgEvent) => {
    console.log(`Server message: ${msgEvent.data}`);
  };

  dc.onerror = (error) => {
    console.error(`[Viewer DataChannel Error]:`, error);
  };
  
  dc.onclose = () => {
    console.log("SCTP Link: Data stream closed by server terminal.");
    handleServerDisconnect("SCTP Data channel pipeline severed by remote endpoint.");
  };
}

function initViewer() {
  var roomId = prompt('Enter camera name:', 'ARVIND');
  if (roomId === '' || !roomId) {
    roomId = 'ARVIND';
  }

  roomTopic = roomId;
  myRole = 'viewer';
  
  console.log(`[Viewer] Initializing targeting target room tag: ${roomId}`);
  
  if (!supabaseClient) {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  channel = supabaseClient.channel(roomId);

  console.log(`Viewer attached to endpoint gateway channel room: ${roomTopic}...`);

  let offerSent = false;

  channel
    .on('broadcast', { event: 'signal-to-viewer' }, async ({ payload }) => {
      const { targetId, signal } = payload;
      if (targetId !== myClientId) return;

      if (!pc) return;

      if (signal.type === 'answer') {
        console.log(`[Viewer PeerConnection] Clean Answer received from Server.`);
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
          remoteDescriptionSet = true;
          await processRemoteIceQueue();
        } catch (err) {
          console.error("Critical error setting remote description:", err);
        }
      } 
      else if (signal.type === 'candidate' && signal.candidate) {
        console.log(`[Viewer PeerConnection] Clean ICE Candidate received:`, signal.candidate);

        const candidateInstance = new RTCIceCandidate({
          candidate: signal.candidate.candidate,
          sdpMid: signal.candidate.sdpMid || "0",
          sdpMLineIndex: parseInt(signal.candidate.sdpMLineIndex || 0, 10)
        });

        if (!remoteDescriptionSet) {
          remoteIceQueue.push(candidateInstance);
        } else {
          try {
            await pc.addIceCandidate(candidateInstance);
          } catch (e) {
            console.error("Error applying remote ice candidate:", e);
          }
        }
      }
    })
    // DETECTION LAYER 2: Monitors Supabase Realtime presence track drops natively
    .on('presence', { event: 'leave' }, ({ leftPresences }) => {
      leftPresences.forEach((presence) => {
        // The server does not track a specific clientId, so it leaves without it, 
        // or acts as the primary occupant drop indicator in a 1-to-1 setup.
        console.log("[Supabase Presence Leave Detected] A participant left the room mesh.");
        handleServerDisconnect("Room channel presence synchronizer signaled endpoint departure.");
      });
    })
    .on('presence', { event: 'sync' }, () => {
      if (!offerSent) {
        offerSent = true;
        initiateViewerConnection();
      }
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        console.log("Realtime Network Connection established.");
        await channel.track({ clientId: myClientId });
      }
    });
}

function triggerSend() {
  const input = document.getElementById('chatInput');
  const messageText = input.value.trim();

  if (!messageText) return;

  if (activeDataChannel && activeDataChannel.readyState === "open") {
    activeDataChannel.send(messageText);
    console.log(`Viewer Sent: ${messageText}`);
    input.value = "";
  } else {
    console.log("Error: The active text pipeline channel state is not OPEN.");
  }
}

initViewer();



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