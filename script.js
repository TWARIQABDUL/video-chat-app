const socket = io();

// --- UI Elements ---
const lobby = document.getElementById('lobby');
const roomContainer = document.getElementById('room-container');
const roomInput = document.getElementById('room-name-input');
const joinBtn = document.getElementById('join-btn');
const createBtn = document.getElementById('create-btn');
const roomIdDisplay = document.getElementById('room-id');
const videosContainer = document.getElementById('videos');

// --- Lobby Logic ---

joinBtn.addEventListener('click', () => {
    const room = roomInput.value.trim();
    if (room) startRoom(room);
    else alert("Please enter a room name");
});

createBtn.addEventListener('click', () => {
    const randomRoom = "room-" + Math.random().toString(36).substr(2, 6);
    startRoom(randomRoom);
});

const urlParams = new URLSearchParams(window.location.search);
const roomFromUrl = urlParams.get('room');
if (roomFromUrl) roomInput.value = roomFromUrl;

// --- Video Chat Logic ---
let localStream;
let peers = {};
const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

function startRoom(roomName) {
    lobby.style.display = 'none';
    roomContainer.style.display = 'flex';
    roomIdDisplay.textContent = roomName;
    
    window.history.pushState({}, '', `?room=${roomName}`);
    if (audioContext.state === 'suspended') audioContext.resume();

    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            const localVideo = document.getElementById('localVideo');
            localVideo.srcObject = stream;
            localStream = stream;
            
            // Inject Mute Badge for Local User if it doesn't exist
            const localCard = localVideo.parentElement;
            if (!document.getElementById('mute-local')) {
                const badge = document.createElement('div');
                badge.id = 'mute-local';
                badge.className = 'mute-badge';
                badge.textContent = '🔇';
                localCard.appendChild(badge);
            }

            socket.emit('join room', roomName);
        })
        .catch(err => {
            console.error('Camera Error:', err);
            alert("Could not access camera/microphone.");
        });
}

// --- Socket Events ---

socket.on('user-joined', userId => {
    console.log("New user joined:", userId);
    createPeer(userId, true); 
});

socket.on('signal', async (data) => {
    const { sender, sdp, ice } = data;
    if (!peers[sender]) createPeer(sender, false);
    const pc = peers[sender];

    if (sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        if (sdp.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('signal', { target: sender, sdp: pc.localDescription });
        }
    } else if (ice) {
        await pc.addIceCandidate(new RTCIceCandidate(ice)).catch(e => {});
    }
});

// HANDLE REMOTE MUTE
socket.on('user-muted', ({ userId, isMuted }) => {
    const badge = document.getElementById(`mute-${userId}`);
    if (badge) {
        badge.style.display = isMuted ? 'flex' : 'none';
    }
});

socket.on('user-left', id => {
    if (peers[id]) peers[id].close();
    delete peers[id];
    document.getElementById(`video-${id}`)?.parentElement.remove();
});

// --- Peer Connection ---

function createPeer(userId, initiator) {
    const pc = new RTCPeerConnection(config);
    peers[userId] = pc;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.ontrack = (e) => {
        const videoId = `video-${userId}`;
        if (!document.getElementById(videoId)) {
            const div = document.createElement('div');
            div.className = 'video-card';
            
            const video = document.createElement('video');
            video.id = videoId;
            video.autoplay = true;
            video.playsInline = true;
            video.srcObject = e.streams[0];
            
            const span = document.createElement('span');
            span.className = 'participant-name';
            span.textContent = `User ${userId.substr(0,4)}`;
            
            // CREATE MUTE BADGE (Hidden by default)
            const badge = document.createElement('div');
            badge.className = 'mute-badge';
            badge.id = `mute-${userId}`;
            badge.textContent = '🔇';

            div.appendChild(video);
            div.appendChild(span);
            div.appendChild(badge);
            videosContainer.appendChild(div);
        }
    };

    pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('signal', { target: userId, ice: e.candidate });
    };

    if (initiator) {
        pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .then(() => socket.emit('signal', { target: userId, sdp: pc.localDescription }));
    }
}

// --- Chat Logic ---
const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');

form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.value) {
        socket.emit('chat message', input.value);
        addMessage(input.value, 'self');
        input.value = '';
    }
});
socket.on('chat message', (msg) => addMessage(msg, 'other'));

function addMessage(msg, type) {
    const div = document.createElement('div');
    div.textContent = msg;
    div.className = type;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
}

// --- CONTROLS (Mute, Video, Screen, Leave) ---

// 1. MUTE BUTTON
document.getElementById('mute-btn').addEventListener('click', (e) => {
    const track = localStream.getAudioTracks()[0];
    track.enabled = !track.enabled;
    const isMuted = !track.enabled;

    // Update UI
    e.target.textContent = isMuted ? '🔇' : '🎤';
    e.target.style.background = isMuted ? '#EF4444' : '#374151';
    
    // Show Local Badge
    const myBadge = document.getElementById('mute-local');
    if(myBadge) myBadge.style.display = isMuted ? 'flex' : 'none';

    // Tell Server
    socket.emit('toggle-mute', isMuted);
});

// 2. VIDEO OFF BUTTON
document.getElementById('video-btn').addEventListener('click', (e) => {
    if (isScreenSharing) return alert("Stop screen sharing first.");
    const track = localStream.getVideoTracks()[0];
    track.enabled = !track.enabled;
    e.target.textContent = track.enabled ? '📹' : '📷❌';
});

// 3. SCREEN SHARE BUTTON (Google Meet Style)
const screenBtn = document.getElementById('screen-btn');
let isScreenSharing = false;
let camVideoTrack;

screenBtn.addEventListener('click', async () => {
  const localVideo = document.getElementById('localVideo');

  if (!isScreenSharing) {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = screenStream.getVideoTracks()[0];
      
      // Save Camera Track
      camVideoTrack = localStream.getVideoTracks()[0];

      // Replace tracks for Peers
      for (let id in peers) {
        const sender = peers[id].getSenders().find(s => s.track.kind === 'video');
        if (sender) sender.replaceTrack(screenTrack);
      }

      // Update Local Stream & UI
      localStream.removeTrack(camVideoTrack);
      localStream.addTrack(screenTrack);
      localVideo.srcObject = screenStream;
      
      // Add class for "Contain" mode (No Crop)
      localVideo.classList.add('screen-share-mode'); 

      screenTrack.onended = stopScreenShare;
      isScreenSharing = true;
      screenBtn.textContent = '🛑 Stop';
      screenBtn.style.background = '#EF4444';
      
    } catch (err) {
      console.error("Screen share cancelled", err);
    }
  } else {
    stopScreenShare();
  }
});

function stopScreenShare() {
  if (!isScreenSharing) return;
  const screenTrack = localStream.getVideoTracks()[0];
  screenTrack.stop();

  // Restore Camera
  localStream.removeTrack(screenTrack);
  localStream.addTrack(camVideoTrack);
  
  const localVideo = document.getElementById('localVideo');
  localVideo.srcObject = localStream;
  localVideo.classList.remove('screen-share-mode'); 

  // Restore for Peers
  for (let id in peers) {
    const sender = peers[id].getSenders().find(s => s.track.kind === 'video');
    if (sender) sender.replaceTrack(camVideoTrack);
  }

  isScreenSharing = false;
  screenBtn.textContent = '🖥️';
  screenBtn.style.background = '#374151';
}

document.getElementById('leave-btn').addEventListener('click', () => {
    window.location.href = "/"; 
});