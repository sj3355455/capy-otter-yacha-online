const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
app.use(cors({
    origin: "*",
    methods: ["GET", "POST"]
}));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

let rooms = {}; // key: roomId, value: { id, name, password, players: {}, countdownTimer, currentMap }
let playerConnections = 0;

function generateRoomId() {
    return Math.random().toString(36).substring(2, 9);
}

function broadcastRoomList() {
    // Send a safe version of rooms (without passwords) to everyone in the lobby
    const roomList = Object.values(rooms).map(room => ({
        id: room.id,
        name: room.name,
        hasPassword: !!room.password,
        playerCount: Object.keys(room.players).length
    }));
    io.emit('roomListUpdate', roomList); // Send to all connected sockets
}

function checkReadyAndStart(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const p1 = Object.values(room.players).find(p => p.role === 'Player1');
    const p2 = Object.values(room.players).find(p => p.role === 'Player2');
    
    if (p1 && p2 && p1.isReady && p2.isReady) {
        if (!room.countdownTimer) {
            let count = 3;
            io.to(roomId).emit('countdown', count);
            room.countdownTimer = setInterval(() => {
                count--;
                if (count > 0) {
                    io.to(roomId).emit('countdown', count);
                } else {
                    clearInterval(room.countdownTimer);
                    room.countdownTimer = null;
                    // Reset ready states for next time
                    p1.isReady = false;
                    p2.isReady = false;
                    
                    const randomIndices = {
                        map: Math.floor(Math.random() * 3), // meadow, colosseum, dojo
                        p1: Math.floor(Math.random() * 4), // capy, otter, owl, quokka
                        p2: Math.floor(Math.random() * 4)
                    };
                    io.to(roomId).emit('startGame', { players: room.players, randomIndices });
                }
            }, 1000);
        }
    } else {
        if (room.countdownTimer) {
            clearInterval(room.countdownTimer);
            room.countdownTimer = null;
            io.to(roomId).emit('countdownCancelled');
        }
    }
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    playerConnections++;
    socket.roomId = null;

    // Send initial room list to the newly connected user
    socket.emit('roomListUpdate', Object.values(rooms).map(room => ({
        id: room.id,
        name: room.name,
        hasPassword: !!room.password,
        playerCount: Object.keys(room.players).length
    })));

    socket.on('createRoom', (data) => {
        if (socket.roomId) return; // Already in a room
        
        const roomId = generateRoomId();
        const roomName = data.name || `Room ${roomId}`;
        const password = data.password || null;

        rooms[roomId] = {
            id: roomId,
            name: roomName,
            password: password,
            players: {},
            countdownTimer: null,
            currentMap: 'meadow'
        };

        // Creator becomes Player1
        rooms[roomId].players[socket.id] = {
            role: 'Player1',
            x: 250,
            y: 250,
            selectedChar: 'capybara',
            isReady: false
        };

        socket.roomId = roomId;
        socket.join(roomId);
        
        socket.emit('roomJoined', { roomId, role: 'Player1', map: rooms[roomId].currentMap });
        broadcastRoomList();
    });

    socket.on('joinRoom', (data) => {
        if (socket.roomId) return; // Already in a room

        const { roomId, password } = data;
        const room = rooms[roomId];

        if (!room) {
            socket.emit('roomError', 'Room does not exist.');
            return;
        }

        if (room.password && room.password !== password) {
            socket.emit('roomError', 'Incorrect password.');
            return;
        }

        const playerCount = Object.keys(room.players).length;
        if (playerCount >= 2) {
            socket.emit('roomError', 'Room is full.');
            return;
        }

        // Determine role
        let role = 'Spectator';
        if (Object.values(room.players).filter(p => p.role === 'Player1').length === 0) {
            role = 'Player1';
        } else if (Object.values(room.players).filter(p => p.role === 'Player2').length === 0) {
            role = 'Player2';
        }

        room.players[socket.id] = {
            role: role,
            x: role === 'Player1' ? 250 : 720,
            y: 250,
            selectedChar: role === 'Player1' ? 'capybara' : 'otter',
            isReady: false
        };

        socket.roomId = roomId;
        socket.join(roomId);

        socket.emit('roomJoined', { roomId, role: role, map: room.currentMap });
        // Send state of already existing players to the new player
        socket.emit('roomState', { players: room.players, map: room.currentMap });
        // Broadcast new player to others in the room
        socket.to(roomId).emit('newPlayer', { id: socket.id, playerInfo: room.players[socket.id] });
        
        broadcastRoomList();
    });

    socket.on('leaveRoom', () => {
        if (!socket.roomId) return;
        const roomId = socket.roomId;
        const room = rooms[roomId];

        if (room) {
            delete room.players[socket.id];
            socket.leave(roomId);
            socket.to(roomId).emit('playerDisconnected', socket.id);

            // Cancel countdown if any
            if (room.countdownTimer) {
                clearInterval(room.countdownTimer);
                room.countdownTimer = null;
                io.to(roomId).emit('countdownCancelled');
            }

            // If room is empty, delete it
            if (Object.keys(room.players).length === 0) {
                delete rooms[roomId];
            }
            broadcastRoomList();
        }
        socket.roomId = null;
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        playerConnections--;
        if (socket.roomId) {
            const roomId = socket.roomId;
            const room = rooms[roomId];
            if (room) {
                delete room.players[socket.id];
                socket.to(roomId).emit('playerDisconnected', socket.id);
                if (room.countdownTimer) {
                    clearInterval(room.countdownTimer);
                    room.countdownTimer = null;
                    io.to(roomId).emit('countdownCancelled');
                }
                if (Object.keys(room.players).length === 0) {
                    delete rooms[roomId];
                }
                broadcastRoomList();
            }
        }
    });

    socket.on('charSelected', (charName) => {
        if (!socket.roomId) return;
        const room = rooms[socket.roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].selectedChar = charName;
            socket.to(socket.roomId).emit('opponentCharSelected', { id: socket.id, role: room.players[socket.id].role, charName });
        }
    });

    socket.on('mapSelected', (mapName) => {
        if (!socket.roomId) return;
        const room = rooms[socket.roomId];
        if (room) {
            room.currentMap = mapName;
            socket.to(socket.roomId).emit('mapSelected', mapName);
        }
    });

    socket.on('playerReady', (isReady) => {
        if (!socket.roomId) return;
        const room = rooms[socket.roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].isReady = isReady;
            io.to(socket.roomId).emit('playerReadyState', { id: socket.id, role: room.players[socket.id].role, isReady });
            checkReadyAndStart(socket.roomId);
        }
    });

    socket.on('returnToLobby', () => {
        if (!socket.roomId) return;
        const room = rooms[socket.roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].isReady = false;
            io.to(socket.roomId).emit('playerReadyState', { id: socket.id, role: room.players[socket.id].role, isReady: false });
        }
        socket.to(socket.roomId).emit('opponentReturnedToLobby');
    });

    socket.on('playerStateUpdate', (state) => {
        if (!socket.roomId) return;
        const room = rooms[socket.roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id] = { ...room.players[socket.id], ...state };
            socket.to(socket.roomId).emit('playerMoved', { id: socket.id, playerInfo: room.players[socket.id] });
        }
    });

    socket.on('keyPress', (data) => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('opponentKeyPress', data);
    });

    socket.on('gameOverSync', (data) => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('gameOverSync', data);
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
