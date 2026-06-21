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

let players = {};
let playerConnections = 0;
let countdownTimer = null;
let currentMap = 'meadow';

function checkReadyAndStart() {
    const p1 = Object.values(players).find(p => p.role === 'Player1');
    const p2 = Object.values(players).find(p => p.role === 'Player2');
    
    if (p1 && p2 && p1.isReady && p2.isReady) {
        if (!countdownTimer) {
            let count = 3;
            io.emit('countdown', count);
            countdownTimer = setInterval(() => {
                count--;
                if (count > 0) {
                    io.emit('countdown', count);
                } else {
                    clearInterval(countdownTimer);
                    countdownTimer = null;
                    // Reset ready states for next time
                    p1.isReady = false;
                    p2.isReady = false;
                    
                    const randomIndices = {
                        map: Math.floor(Math.random() * 3), // meadow, colosseum, dojo
                        p1: Math.floor(Math.random() * 4), // capy, otter, owl, quokka
                        p2: Math.floor(Math.random() * 4)
                    };
                    io.emit('startGame', { players, randomIndices });
                }
            }, 1000);
        }
    } else {
        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
            io.emit('countdownCancelled');
        }
    }
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    playerConnections++;
    
    let role = 'Spectator';
    if (Object.values(players).filter(p => p.role === 'Player1').length === 0) {
        role = 'Player1';
    } else if (Object.values(players).filter(p => p.role === 'Player2').length === 0) {
        role = 'Player2';
    }

    players[socket.id] = {
        role: role,
        x: role === 'Player1' ? 250 : 720,
        y: 250,
        selectedChar: role === 'Player1' ? 'capybara' : 'otter',
        isReady: false
    };

    socket.emit('roleAssignment', role);
    socket.emit('roomState', { players: players, map: currentMap });
    socket.broadcast.emit('newPlayer', { id: socket.id, playerInfo: players[socket.id] });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        delete players[socket.id];
        playerConnections--;
        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
            io.emit('countdownCancelled');
        }
        io.emit('playerDisconnected', socket.id);
    });

    socket.on('charSelected', (charName) => {
        if (players[socket.id]) {
            players[socket.id].selectedChar = charName;
            socket.broadcast.emit('opponentCharSelected', { id: socket.id, role: players[socket.id].role, charName });
        }
    });

    socket.on('mapSelected', (mapName) => {
        currentMap = mapName;
        socket.broadcast.emit('mapSelected', mapName);
    });

    socket.on('playerReady', (isReady) => {
        if (players[socket.id]) {
            players[socket.id].isReady = isReady;
            io.emit('playerReadyState', { id: socket.id, role: players[socket.id].role, isReady });
            checkReadyAndStart();
        }
    });

    socket.on('returnToLobby', () => {
        if (players[socket.id]) {
            players[socket.id].isReady = false;
            io.emit('playerReadyState', { id: socket.id, role: players[socket.id].role, isReady: false });
        }
        socket.broadcast.emit('opponentReturnedToLobby');
    });

    socket.on('playerStateUpdate', (state) => {
        if (players[socket.id]) {
            players[socket.id] = { ...players[socket.id], ...state };
            socket.broadcast.emit('playerMoved', { id: socket.id, playerInfo: players[socket.id] });
        }
    });

    socket.on('keyPress', (data) => {
        socket.broadcast.emit('opponentKeyPress', data);
    });

    socket.on('gameOverSync', (data) => {
        socket.broadcast.emit('gameOverSync', data);
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
