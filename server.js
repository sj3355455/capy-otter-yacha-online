const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { geckos } = require('@geckos.io/server');
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

// Geckos UDP Server with STUN configuration for NAT traversal
const ioUdp = geckos({
    cors: { origin: '*', allowAuthorization: true },
    portRange: { min: 9208, max: 9208 },
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ]
});

const HTTP_PORT = process.env.PORT || 3000;
const UDP_PORT = process.env.UDP_PORT || 9208; // 배포 시 process.env.UDP_PORT = 443 설정 가능

app.get('/favicon.ico', (req, res) => res.status(204).end());
app.use(express.static(__dirname));

let rooms = {}; // key: roomId, value: { id, name, password, players: {}, countdownTimer, currentMap }
let playerConnections = 0;

// 하이브리드 통신을 위한 매핑 맵
let geckosChannelsBySocketId = {}; // key: socketId, value: geckos channel
let socketIdByGeckosId = {};       // key: geckosId, value: socketId
let roomIdBySocketId = {};         // key: socketId, value: roomId

function generateRoomId() {
    return Math.random().toString(36).substring(2, 9);
}

function broadcastRoomList() {
    const roomList = Object.values(rooms).map(room => ({
        id: room.id,
        name: room.name,
        hasPassword: !!room.password,
        playerCount: Object.keys(room.players).length
    }));
    io.emit('roomListUpdate', roomList);
}

// 특정 방의 다른 유저들에게 데이터를 보냅니다. (무조건 UDP로만 전송)
function broadcastToRoom(roomId, event, payload, senderSocketId) {
    const room = rooms[roomId];
    if (!room) return;
    
    Object.keys(room.players).forEach(targetSocketId => {
        if (targetSocketId === senderSocketId) return; // 본인 제외
        
        const targetGeckos = geckosChannelsBySocketId[targetSocketId];
        if (targetGeckos) {
            targetGeckos.emit(event, payload);
        }
    });
}

function handlePlayerStateUpdate(socketId, state) {
    const roomId = roomIdBySocketId[socketId];
    if (!roomId) return;
    const room = rooms[roomId];
    if (room && room.players[socketId]) {
        room.players[socketId] = { ...room.players[socketId], ...state };
        broadcastToRoom(roomId, 'playerMoved', { id: socketId, playerInfo: room.players[socketId] }, socketId);
    }
}

function handleKeyPress(socketId, data) {
    const roomId = roomIdBySocketId[socketId];
    if (!roomId) return;
    broadcastToRoom(roomId, 'opponentKeyPress', data, socketId);
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
                    p1.isReady = false;
                    p2.isReady = false;
                    
                    const randomIndices = {
                        map: Math.floor(Math.random() * 3), 
                        p1: Math.floor(Math.random() * 4),
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

// UDP (Geckos.io) 서버 이벤트 처리
ioUdp.onConnection(channel => {
    channel.onDisconnect(() => {
        const sid = socketIdByGeckosId[channel.id];
        if (sid) {
            delete geckosChannelsBySocketId[sid];
            delete socketIdByGeckosId[channel.id];
        }
    });

    channel.on('auth', data => {
        const { socketId } = data;
        if (socketId) {
            geckosChannelsBySocketId[socketId] = channel;
            socketIdByGeckosId[channel.id] = socketId;
            // 클라이언트 측에 UDP 연결 완료 신호 (핑백)
            channel.emit('authSuccess', { message: 'UDP Connected' });
        }
    });
    
    // 빈번한 데이터(이동, 키입력)는 UDP 채널로 수신 시 여기로 들어옴
    channel.on('playerStateUpdate', (state) => {
        const sid = socketIdByGeckosId[channel.id];
        if (sid) handlePlayerStateUpdate(sid, state);
    });

    channel.on('keyPress', (data) => {
        const sid = socketIdByGeckosId[channel.id];
        if (sid) handleKeyPress(sid, data);
    });
});

// TCP (Socket.io) 서버 이벤트 처리
io.on('connection', (socket) => {
    console.log('A user connected via TCP:', socket.id);
    playerConnections++;

    socket.emit('roomListUpdate', Object.values(rooms).map(room => ({
        id: room.id,
        name: room.name,
        hasPassword: !!room.password,
        playerCount: Object.keys(room.players).length
    })));

    socket.on('createRoom', (data) => {
        if (roomIdBySocketId[socket.id]) return;
        
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

        rooms[roomId].players[socket.id] = {
            role: 'Player1',
            x: 250,
            y: 250,
            selectedChar: 'capybara',
            isReady: false
        };

        roomIdBySocketId[socket.id] = roomId;
        socket.join(roomId);
        
        socket.emit('roomJoined', { roomId, role: 'Player1', map: rooms[roomId].currentMap });
        broadcastRoomList();
    });

    socket.on('joinRoom', (data) => {
        if (roomIdBySocketId[socket.id]) return;

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

        roomIdBySocketId[socket.id] = roomId;
        socket.join(roomId);

        socket.emit('roomJoined', { roomId, role: role, map: room.currentMap });
        socket.emit('roomState', { players: room.players, map: room.currentMap });
        socket.to(roomId).emit('newPlayer', { id: socket.id, playerInfo: room.players[socket.id] });
        
        broadcastRoomList();
    });

    socket.on('leaveRoom', () => {
        const roomId = roomIdBySocketId[socket.id];
        if (!roomId) return;
        const room = rooms[roomId];

        if (room) {
            delete room.players[socket.id];
            socket.leave(roomId);
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
        delete roomIdBySocketId[socket.id];
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        playerConnections--;
        const roomId = roomIdBySocketId[socket.id];
        if (roomId) {
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
            delete roomIdBySocketId[socket.id];
        }
    });

    socket.on('charSelected', (charName) => {
        const roomId = roomIdBySocketId[socket.id];
        if (!roomId) return;
        const room = rooms[roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].selectedChar = charName;
            socket.to(roomId).emit('opponentCharSelected', { id: socket.id, role: room.players[socket.id].role, charName });
        }
    });

    socket.on('mapSelected', (mapName) => {
        const roomId = roomIdBySocketId[socket.id];
        if (!roomId) return;
        const room = rooms[roomId];
        if (room) {
            room.currentMap = mapName;
            socket.to(roomId).emit('mapSelected', mapName);
        }
    });

    socket.on('playerReady', (isReady) => {
        const roomId = roomIdBySocketId[socket.id];
        if (!roomId) return;
        const room = rooms[roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].isReady = isReady;
            io.to(roomId).emit('playerReadyState', { id: socket.id, role: room.players[socket.id].role, isReady });
            checkReadyAndStart(roomId);
        }
    });

    socket.on('returnToLobby', () => {
        const roomId = roomIdBySocketId[socket.id];
        if (!roomId) return;
        const room = rooms[roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].isReady = false;
            io.to(roomId).emit('playerReadyState', { id: socket.id, role: room.players[socket.id].role, isReady: false });
        }
        socket.to(roomId).emit('opponentReturnedToLobby');
    });



    socket.on('gameOverSync', (data) => {
        const roomId = roomIdBySocketId[socket.id];
        if (!roomId) return;
        socket.to(roomId).emit('gameOverSync', data); // 게임오버 같은 중요한 이벤트는 TCP로만 처리
    });
});

server.listen(HTTP_PORT, () => {
    console.log(`[TCP] HTTP & Socket.io Server is running on http://localhost:${HTTP_PORT}`);
});

ioUdp.addServer(server);
console.log(`[UDP] Geckos.io WebRTC Server attached to HTTP server. Using UDP port 9208 for data channels.`);
