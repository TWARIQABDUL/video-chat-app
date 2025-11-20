const express = require('express'); 
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // 1. Join Room
  socket.on('join room', (roomName) => {
    socket.join(roomName);
    socket.room = roomName; 
    
    // IMPORTANT: Only tell EXISTING users that a new person is here.
    socket.to(roomName).emit('user-joined', socket.id);
  });

  // 2. Handle Mute Toggle (New)
  socket.on('toggle-mute', (isMuted) => {
    if (socket.room) {
      // Tell everyone else in the room that this user muted/unmuted
      socket.broadcast.to(socket.room).emit('user-muted', { 
        userId: socket.id, 
        isMuted: isMuted 
      });
    }
  });

  // 3. Chat Messages
  socket.on('chat message', (msg) => {
    if (socket.room) {
      socket.broadcast.to(socket.room).emit('chat message', msg);
    }
  });

  // 4. WebRTC Signaling
  socket.on('signal', (data) => {
    io.to(data.target).emit('signal', { ...data, sender: socket.id });
  });

  // 5. Disconnect
  socket.on('disconnect', () => {
    if (socket.room) {
      socket.to(socket.room).emit('user-left', socket.id);
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});