// --- Game Configuration & Setup ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = true; // Enable anti-aliasing for smoother visuals
ctx.imageSmoothingQuality = 'high'; // Use high quality smoothing for clean downscaling

// Multiplayer Socket setup
const DEFAULT_SERVER_URL = 'https://capy-otter-yacha.onrender.com';
let socket = null;
let myRole = 'Spectator';
let isReady = false;

// Server-provided random indices to keep online games synchronized
let serverRandomIndices = null;
let lastStateEmitTime = 0;

function initSocket() {
    if (socket) return;

    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    let serverUrl = 'http://localhost:3000';
    
    const statusLbl = document.getElementById('connection-status-lbl');
    const urlInput = document.getElementById('server-url-input');
    
    if (!isLocal) {
        serverUrl = (urlInput && urlInput.value.trim()) || localStorage.getItem('capy_server_url') || DEFAULT_SERVER_URL;
    }
    
    if (statusLbl) {
        statusLbl.style.color = '#ff9800';
        statusLbl.textContent = '서버 연결 시도 중... (첫 접속 시 30초 소요 가능)';
    }

    socket = typeof io !== 'undefined' ? io(serverUrl, { 
        timeout: 45000,
        transports: ['websocket']
    }) : null;
    if (!socket) {
        if (statusLbl) {
            statusLbl.style.color = '#f44336';
            statusLbl.textContent = '연결 실패: Socket.io를 불러올 수 없습니다.';
        }
        return;
    }

    socket.on('connect', () => {
        if (statusLbl) {
            statusLbl.style.color = '#4caf50';
            statusLbl.textContent = '연결 성공!';
        }
        if (!isLocal && urlInput) {
            localStorage.setItem('capy_server_url', serverUrl);
        }
    });

    socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
        if (statusLbl) {
            statusLbl.style.color = '#f44336';
            statusLbl.textContent = '연결 실패. 서버가 준비 중일 수 있으니 잠시 후 다시 시도해 주세요.';
        }
        socket.disconnect();
        socket = null;
    });

    socket.on('disconnect', () => {
        if (statusLbl) {
            statusLbl.style.color = '#aaa';
            statusLbl.textContent = '서버 연결이 끊어졌습니다.';
        }
        socket = null;
    });

    socket.on('roleAssignment', (role) => {
        myRole = role;
        console.log("Assigned role:", myRole);
        
        // Setup initial text
        if (myRole === 'Player1') {
            document.getElementById('battle-btn').textContent = "READY";
            document.getElementById('p2-panel-title').textContent = 'PLAYER 2 (OTTER)';
            document.getElementById('p2-preview-label').textContent = 'PLAYER 2';
        } else if (myRole === 'Player2') {
            document.getElementById('battle-btn').textContent = "READY";
            document.getElementById('p2-panel-title').textContent = 'PLAYER 2 (OTTER)';
            document.getElementById('p2-preview-label').textContent = 'PLAYER 2';
        }
        
        if (gameMode === 'online') {
            if (onlineStartBtn) {
                onlineStartBtn.textContent = 'ONLINE MULTIPLAYER';
                onlineStartBtn.disabled = false;
            }
            enterCharSelectScreen();
        }
    });

    socket.on('roomState', (data) => {
        if (data.map) {
            const btn = document.querySelector(`.map-btn[data-map="${data.map}"]`);
            if (btn) {
                document.querySelectorAll('.map-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedMap = data.map;
                const wrapper = document.getElementById('canvas-wrapper');
                const mapDesc = document.getElementById('map-desc');
                if (selectedMap === 'colosseum') {
                    if (wrapper) wrapper.style.backgroundImage = "url('image/map/colosseum_bg.png')";
                    if (mapDesc) mapDesc.textContent = "Battle in the grand Roman Colosseum. Knock your opponent to the screen borders!";
                } else if (selectedMap === 'dojo') {
                    if (wrapper) wrapper.style.backgroundImage = "url('image/map/dojo.jpeg')";
                    if (mapDesc) mapDesc.textContent = "Battle in the sparring arena. Knock your opponent to the screen borders!";
                } else if (selectedMap === 'random') {
                    if (wrapper) wrapper.style.backgroundImage = "linear-gradient(135deg, #151226 0%, #090812 100%)";
                    if (mapDesc) mapDesc.textContent = "A random battlefield (Meadow, Colosseum, or Dojo) will be chosen once the fight starts!";
                } else {
                    if (wrapper) wrapper.style.backgroundImage = "url('image/map/meadow_bg.png')";
                    if (mapDesc) mapDesc.textContent = "A peaceful meadow. Perfect for a friendly brawl.";
                }
            }
        }
        
        for (let id in data.players) {
            let pInfo = data.players[id];
            if (pInfo.role === 'Player1') {
                p1SelectedChar = pInfo.selectedChar;
                p1Selector.querySelectorAll('.char-btn').forEach(btn => btn.classList.remove('active'));
                const cbtn = p1Selector.querySelector(`.char-btn[data-char="${p1SelectedChar}"]`);
                if(cbtn) cbtn.classList.add('active');
                if (typeof drawPreview === 'function') drawPreview(1, p1SelectedChar);
                document.getElementById('p1-ready-label').textContent = pInfo.isReady ? "READY!" : "";
            } else if (pInfo.role === 'Player2') {
                p2SelectedChar = pInfo.selectedChar;
                p2Selector.querySelectorAll('.char-btn').forEach(btn => btn.classList.remove('active'));
                const cbtn = p2Selector.querySelector(`.char-btn[data-char="${p2SelectedChar}"]`);
                if(cbtn) cbtn.classList.add('active');
                if (typeof drawPreview === 'function') drawPreview(2, p2SelectedChar);
                document.getElementById('p2-ready-label').textContent = pInfo.isReady ? "READY!" : "";
            }
        }
    });

    socket.on('playerMoved', (data) => {
        if (!gameStarted || gameOver) return;
        const info = data.playerInfo;
        const targetPlayer = (info.role === 'Player1') ? player1 : player2;
        if (!targetPlayer) return;
        
        if (info.role !== myRole) {
            // Initialize position buffer if not exists
            if (!targetPlayer.positionBuffer) {
                targetPlayer.positionBuffer = [];
            }
            
            // Push incoming state with local timestamp to history buffer
            targetPlayer.positionBuffer.push({
                x: info.x,
                y: info.y,
                dir: info.dir,
                time: performance.now()
            });
            
            // Keep buffer size manageable (last 20 frames is plenty for ~333ms at 60Hz)
            if (targetPlayer.positionBuffer.length > 20) {
                targetPlayer.positionBuffer.shift();
            }
            
            targetPlayer.hp = info.hp;
        }
    });

    socket.on('opponentReturnedToLobby', () => {
        returnToLobby();
    });

    socket.on('playerDisconnected', (id) => {
        if (gameMode === 'online') {
            returnToLobby();
            document.getElementById('p1-ready-label').textContent = "";
            document.getElementById('p2-ready-label').textContent = "";
        }
    });

    socket.on('opponentCharSelected', (data) => {
        if (data.role === 'Player1') {
            p1Selector.querySelectorAll('.char-btn').forEach(btn => btn.classList.remove('active'));
            const btn = p1Selector.querySelector(`.char-btn[data-char="${data.charName}"]`);
            if(btn) btn.classList.add('active');
            p1SelectedChar = data.charName;
            drawPreview(1, p1SelectedChar);
        } else if (data.role === 'Player2') {
            p2Selector.querySelectorAll('.char-btn').forEach(btn => btn.classList.remove('active'));
            const btn = p2Selector.querySelector(`.char-btn[data-char="${data.charName}"]`);
            if(btn) btn.classList.add('active');
            p2SelectedChar = data.charName;
            drawPreview(2, p2SelectedChar);
        }
    });

    socket.on('playerReadyState', (data) => {
        if (data.role === 'Player1') {
            document.getElementById('p1-ready-label').textContent = data.isReady ? "READY!" : "";
        } else if (data.role === 'Player2') {
            document.getElementById('p2-ready-label').textContent = data.isReady ? "READY!" : "";
        }
    });

    socket.on('countdown', (count) => {
        const cd = document.getElementById('countdown-display');
        cd.style.display = 'block';
        cd.textContent = count;
        document.getElementById('battle-btn').style.display = 'none';
    });

    socket.on('countdownCancelled', () => {
        const cd = document.getElementById('countdown-display');
        cd.style.display = 'none';
        document.getElementById('battle-btn').style.display = 'block';
    });

    socket.on('startGame', (data) => {
        // Hide countdown and start the game!
        document.getElementById('countdown-display').style.display = 'none';
        if (data && data.randomIndices) {
            serverRandomIndices = data.randomIndices;
        }
        startGameLogic();
    });

    socket.on('mapSelected', (mapName) => {
        const btn = document.querySelector(`.map-btn[data-map="${mapName}"]`);
        if (btn) {
            document.querySelectorAll('.map-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedMap = mapName;
            
            // Sync background dynamically
            const wrapper = document.getElementById('canvas-wrapper');
            const mapDesc = document.getElementById('map-desc');
            if (selectedMap === 'colosseum') {
                if (wrapper) wrapper.style.backgroundImage = "url('image/map/colosseum_bg.png')";
                if (mapDesc) mapDesc.textContent = "Battle in the grand Roman Colosseum. Knock your opponent to the screen borders!";
            } else if (selectedMap === 'dojo') {
                if (wrapper) wrapper.style.backgroundImage = "url('image/map/dojo.jpeg')";
                if (mapDesc) mapDesc.textContent = "Battle in the sparring arena. Knock your opponent to the screen borders!";
            } else if (selectedMap === 'random') {
                if (wrapper) wrapper.style.backgroundImage = "linear-gradient(135deg, #151226 0%, #090812 100%)";
                if (mapDesc) mapDesc.textContent = "A random battlefield (Meadow, Colosseum, or Dojo) will be chosen once the fight starts!";
            } else {
                if (wrapper) wrapper.style.backgroundImage = "url('image/map/meadow_bg_v4.png')";
                if (mapDesc) mapDesc.textContent = "Battle in the lush green fields. Knock your opponent to the screen borders!";
            }
        }
    });

    socket.on('opponentKeyPress', (data) => {
        keys[data.key] = data.state;
    });

    socket.on('gameOverSync', (data) => {
        if (!gameStarted) return;
        if (!gameOver) {
            gameOver = true;
            winnerId = data.winnerId;
            showGameOverOverlay(winnerId);
        }
    });
}



// Game states
let gameStarted = false;
let gameOver = false;
let winnerId = null;

// Screen Shake Effect
let shakeTime = 0;
let shakeIntensity = 0;

// World Physics
const gravity = 0.12; // Earth-like gravity scale (pixels/frame^2)
const frictionGrounded = 0.82;
const frictionAir = 0.95;

// Arena Platforms Definition (Floor 1 Ground & Floor 2 Elevated Platform)
const platforms = [
    // Main ground floor
    { x: 0, y: 380, width: 1024, height: 196, isGround: true },
    // Central elevated platform (Floor 2)
    { x: 287, y: 230, width: 450, height: 15, isGround: false }
];

// --- Character Spritesheet & Animation Data (300x300 grids) ---
const p1SpriteSheet = new Image();
p1SpriteSheet.src = 'image/character/player1_sheet_v9.png';

const p2SpriteSheet = new Image();
p2SpriteSheet.src = 'image/character/player2_sheet_v8.png';

const p3SpriteSheet = new Image();
p3SpriteSheet.src = 'image/character/player3_sheet.png';

const p4SpriteSheet = new Image();
p4SpriteSheet.src = 'image/character/player4_sheet.png';

const bgImage = new Image();
bgImage.src = 'image/map/meadow_bg_v4.png';

const colosseumBgImage = new Image();
colosseumBgImage.src = 'image/map/colosseum_bg.png';

const dojoBgImage = new Image();
dojoBgImage.src = 'image/map/dojo.jpeg';

const colosseumPlatformImg = new Image();
colosseumPlatformImg.src = 'image/map/colosseum_platform.png';

const otterSlashImage = new Image();
otterSlashImage.src = 'image/skill/otter_wave.png';

const owlFeatherImage = new Image();
owlFeatherImage.src = 'image/skill/owl_feather.png';

const owlSpecialStateImage = new Image();
owlSpecialStateImage.src = 'image/skill/owl_special_state.png';

const capyDashStateImage = new Image();
capyDashStateImage.src = 'image/skill/capy_dash_state.png';

const grassLeftImg = new Image();
grassLeftImg.src = 'image/map/platformer/grass_left.png';

const grassMidImg = new Image();
grassMidImg.src = 'image/map/platformer/grass_mid.png';

const grassRightImg = new Image();
grassRightImg.src = 'image/map/platformer/grass_right.png';

const colosseumLeftImg = new Image();
colosseumLeftImg.src = 'image/map/platformer/colosseum_left.png';

const colosseumMidImg = new Image();
colosseumMidImg.src = 'image/map/platformer/colosseum_mid.png';

const colosseumRightImg = new Image();
colosseumRightImg.src = 'image/map/platformer/colosseum_right.png';

let p1Ready = false;
let p2Ready = false;
let p3Ready = false;
let p4Ready = false;
let bgReady = false;
let otterSlashReady = false;
let owlFeatherReady = false;
let owlSpecialStateReady = false;
let capyDashStateReady = false;
let colosseumBgReady = false;
let colosseumPlatformReady = false;
let dojoBgReady = false;
let grassLeftReady = false;
let grassMidReady = false;
let grassRightReady = false;
let colosseumLeftReady = false;
let colosseumMidReady = false;
let colosseumRightReady = false;

p1SpriteSheet.onload = () => { p1Ready = true; if (typeof drawAllPreviews === 'function') drawAllPreviews(); };
p2SpriteSheet.onload = () => { p2Ready = true; if (typeof drawAllPreviews === 'function') drawAllPreviews(); };
p3SpriteSheet.onload = () => { p3Ready = true; if (typeof drawAllPreviews === 'function') drawAllPreviews(); };
p4SpriteSheet.onload = () => { p4Ready = true; if (typeof drawAllPreviews === 'function') drawAllPreviews(); };
bgImage.onload = () => { bgReady = true; };
colosseumBgImage.onload = () => { colosseumBgReady = true; };
colosseumPlatformImg.onload = () => { colosseumPlatformReady = true; };
dojoBgImage.onload = () => { dojoBgReady = true; };
otterSlashImage.onload = () => { otterSlashReady = true; };
owlFeatherImage.onload = () => { owlFeatherReady = true; };
owlSpecialStateImage.onload = () => { owlSpecialStateReady = true; };
capyDashStateImage.onload = () => { capyDashStateReady = true; };
grassLeftImg.onload = () => { grassLeftReady = true; };
grassMidImg.onload = () => { grassMidReady = true; };
grassRightImg.onload = () => { grassRightReady = true; };
colosseumLeftImg.onload = () => { colosseumLeftReady = true; };
colosseumMidImg.onload = () => { colosseumMidReady = true; };
colosseumRightImg.onload = () => { colosseumRightReady = true; };

// Capybara Animations (P1 - RED)
// Maps directly to frame indices (each frame occupies 1/4 of the width) on player1_sheet_v7.png
const p1Animations = {
    idle: [0],
    move: [1],
    attack: [2],
    special: [2],
    hit: [3]
};

// Otter Animations (P2 - BLUE)
// Maps directly to frame indices (each frame occupies 1/4 of the width) on player2_sheet_v7.png
const p2Animations = {
    idle: [0],
    move: [1],
    attack: [2],
    special: [2],
    hit: [3]
};

// Owl Animations (P3 - MINT)
const p3Animations = {
    idle: [0],
    move: [1],
    attack: [2],
    special: [2],
    hit: [3]
};

// Quokka Animations (P4 - GOLD/YELLOW)
const p4Animations = {
    idle: [0],
    move: [1],
    attack: [2, 3], // Alternates left jab (2) and right straight (3) in logic
    special: [2],
    hit: [4]
};

// Particles Array
let particles = [];
// Projectiles Array
let projectiles = [];

// Input state map
const keys = {
    // 1P Control Keys
    a: false,
    d: false,
    w: false,
    s: false, // Down key to drop from platforms
    f: false,
    g: false,
    // 2P Control Keys
    ArrowLeft: false,
    ArrowRight: false,
    ArrowUp: false,
    ArrowDown: false, // Down key to drop from platforms
    '[': false,
    ']': false
};

// Hangul to English key mapping for 1P WASDFG controls (for Korean keyboard status on iPad/Desktops)
const HANGUL_TO_ENG = {
    'ㅈ': 'w', 'ㅉ': 'w',
    'ㅁ': 'a',
    'ㄴ': 's',
    'ㅇ': 'd',
    'ㄹ': 'f',
    'ㅎ': 'g'
};

// Helper to map physical keys to virtual keys in PvE and Online modes
function mapLocalKey(key) {
    if (gameMode === 'pve') {
        // Local player is always Player 1 in PvE
        if (key === 'ArrowLeft') return 'a';
        if (key === 'ArrowRight') return 'd';
        if (key === 'ArrowUp') return 'w';
        if (key === 'ArrowDown') return 's';
        if (key === 'a') return 'f';
        if (key === 's') return 'g';
        // Disable original WASD FG in PvE
        if (['w', 'a', 's', 'd', 'f', 'g'].includes(key)) return null;
    } else if (gameMode === 'online') {
        if (myRole === 'Player1') {
            if (key === 'ArrowLeft') return 'a';
            if (key === 'ArrowRight') return 'd';
            if (key === 'ArrowUp') return 'w';
            if (key === 'ArrowDown') return 's';
            if (key === 'a') return 'f';
            if (key === 's') return 'g';
            // Disable original WASD FG
            if (['w', 'a', 's', 'd', 'f', 'g'].includes(key)) return null;
        } else if (myRole === 'Player2') {
            if (key === 'a') return '[';
            if (key === 's') return ']';
            // Disable original P2 keys ([ and ]) and original WASD FG
            if (['[', ']', 'w', 'a', 's', 'd', 'f', 'g'].includes(key)) return null;
        }
    }
    return key;
}

// Key Listeners
window.addEventListener('keydown', (e) => {
    let key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (HANGUL_TO_ENG[key]) {
        key = HANGUL_TO_ENG[key];
    }
    
    // Save original key for scroll prevention
    const originalKey = key;
    
    // Remap local keys to role-specific keys if in PvE or Online mode
    key = mapLocalKey(key);
    if (!key) return; // Ignore if mapped to null (disabled original controls)
    
    // Check if the key belongs to my role
    const isP1Key = ['w', 'a', 's', 'd', 'f', 'g'].includes(key);
    const isP2Key = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '[', ']'].includes(key);
    
    if (gameMode !== 'online' || (myRole === 'Player1' && isP1Key) || (myRole === 'Player2' && isP2Key)) {
        if (key in keys && !keys[key]) {
            keys[key] = true;
            if (socket && gameMode === 'online') socket.emit('keyPress', { key: key, state: true });
        }
    }
    
    // Prevent default scrolling for arrows and space
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(originalKey)) {
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    let key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (HANGUL_TO_ENG[key]) {
        key = HANGUL_TO_ENG[key];
    }
    
    // Remap local keys to role-specific keys if in PvE or Online mode
    key = mapLocalKey(key);
    if (!key) return; // Ignore if mapped to null (disabled original controls)
    
    const isP1Key = ['w', 'a', 's', 'd', 'f', 'g'].includes(key);
    const isP2Key = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '[', ']'].includes(key);

    if (gameMode !== 'online' || (myRole === 'Player1' && isP1Key) || (myRole === 'Player2' && isP2Key)) {
        if (key in keys && keys[key]) {
            keys[key] = false;
            if (socket && gameMode === 'online') socket.emit('keyPress', { key: key, state: false });
        }
    }
});

// Prevent focus loss issues
window.addEventListener('blur', () => {
    for (let key in keys) {
        keys[key] = false;
    }
});

// --- Helper Functions ---
// --- Helper Functions & Web Audio API Synth Sound Generator ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

const capyDashAudio = new Audio('sound/sound effect/capy_dash.mp3');
capyDashAudio.preload = 'auto';

const capyDashHitAudio = new Audio('sound/sound effect/capy_dash_hit.mp3');
capyDashHitAudio.preload = 'auto';

const otterKickAudio = new Audio('sound/sound effect/otter_kick.mp3');
otterKickAudio.preload = 'auto';

const otterKickHitAudio = new Audio('sound/sound effect/otter_kick_hit.mp3');
otterKickHitAudio.preload = 'auto';

const bgmAudio = new Audio('sound/bgm/meadow_bgm.mp3');
bgmAudio.preload = 'auto';
bgmAudio.loop = true;
bgmAudio.volume = 0.17; // Reduced by 15% (0.20 -> 0.17)

const selectBgmAudio = new Audio('sound/bgm/select_bgm.mp3');
selectBgmAudio.preload = 'auto';
selectBgmAudio.loop = true;
selectBgmAudio.volume = 0.221;

let isBgmMuted = false;
let isTotalMuted = false;


function playSound(type) {
    if (isTotalMuted) return; // Mute all SFX if total mute is active
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    const now = audioCtx.currentTime;

    if (type === 'hit') {
        // Normal Hit (High-pitch Sharp Crunchy Slap)
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(350, now); // Higher base body frequency (was 220)
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.08);
        gain.gain.setValueAtTime(0.55, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

        // High frequency slap (highly penetrative sine strike)
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1600, now); // Super high pitch slap (was 800)
        osc2.frequency.exponentialRampToValueAtTime(300, now + 0.05);
        gain2.gain.setValueAtTime(0.4, now);
        gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.05);

        // Noise block for crunch (sharp click & high crunch filter)
        const bufferSize = audioCtx.sampleRate * 0.05; // Shorter duration for punchy slap
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) { data[i] = Math.random() * 2 - 1; }
        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.setValueAtTime(4.0, now); // Higher resonance for sharp slash/slap
        filter.frequency.setValueAtTime(3200, now); // Higher frequency noise band (was 1800)
        filter.frequency.exponentialRampToValueAtTime(800, now + 0.05);

        const noiseGain = audioCtx.createGain();
        noiseGain.gain.setValueAtTime(0.85, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(audioCtx.destination);

        osc.start(now); osc.stop(now + 0.08);
        osc2.start(now); osc2.stop(now + 0.05);
        noise.start(now); noise.stop(now + 0.05);

    } else if (type === 'heavyHit') {
        // Heavy Hit / Special Hit (Explosive Boom/Crash)
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(20, now + 0.35);
        gain.gain.setValueAtTime(0.7, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        const bufferSize = audioCtx.sampleRate * 0.25;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) { data[i] = Math.random() * 2 - 1; }
        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(600, now);
        filter.frequency.exponentialRampToValueAtTime(80, now + 0.22);
        const noiseGain = audioCtx.createGain();
        noiseGain.gain.setValueAtTime(0.6, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(audioCtx.destination);

        osc.start(now); osc.stop(now + 0.35);
        noise.start(now); noise.stop(now + 0.25);

    } else if (type === 'swing') {
        // Whoosh (Swing) - Deep, soft wind sound using lowpass filter
        const duration = 0.35; // 350ms duration for smoother decay
        const bufferSize = audioCtx.sampleRate * duration;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) { data[i] = Math.random() * 2 - 1; }
        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.setValueAtTime(0.5, now); // Softest resonance (no sharp metallic peaks)
        filter.frequency.setValueAtTime(450, now); // Low pitch start
        filter.frequency.exponentialRampToValueAtTime(60, now + duration);
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(1.4, now); // Full-bodied gain for low frequencies
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);
        noise.start(now); noise.stop(now + duration);

    } else if (type === 'p1SpecialStartup') {
        // P1 Special Dash Startup (Play capy_dash.mp3 using CORS-compatible HTML5 Audio)
        capyDashAudio.currentTime = 0;
        capyDashAudio.volume = 0.75;
        capyDashAudio.play().catch(err => {
            console.error("capy_dash.mp3 play failed:", err);
        });

    } else if (type === 'p1SpecialHit') {
        // P1 Special Hit (Play capy_dash_hit.mp3 using CORS-compatible HTML5 Audio)
        capyDashHitAudio.currentTime = 0;
        capyDashHitAudio.volume = 0.4;
        capyDashHitAudio.play().catch(err => {
            console.error("capy_dash_hit.mp3 play failed:", err);
        });

    } else if (type === 'p2SpecialStartup') {
        // P2 Special Startup (Play otter_kick.mp3)
        otterKickAudio.currentTime = 0;
        otterKickAudio.volume = 0.75;
        otterKickAudio.play().catch(err => {
            console.error("otter_kick.mp3 play failed:", err);
        });

    } else if (type === 'p2SpecialHit') {
        // P2 Special Hit (Play otter_kick_hit.mp3)
        otterKickHitAudio.currentTime = 0;
        otterKickHitAudio.volume = 0.75;
        otterKickHitAudio.play().catch(err => {
            console.error("otter_kick_hit.mp3 play failed:", err);
        });
    } else if (type === 'p3SpecialStartup') {
        // Owl Gale Force Startup (Powerful rushing wind sound using synthetically generated noise bandpass filter)
        const duration = 0.45;
        const bufferSize = audioCtx.sampleRate * duration;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) { data[i] = Math.random() * 2 - 1; }
        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;
        
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.setValueAtTime(3.5, now);
        filter.frequency.setValueAtTime(950, now);
        filter.frequency.exponentialRampToValueAtTime(120, now + duration);
        
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(1.6, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
        
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);
        
        noise.start(now);
        noise.stop(now + duration);
    } else if (type === 'quokkaSpecialStartup') {
        // High-pitched crackly electric shock sound using FM synthesis
        const duration = 0.5;
        const osc = audioCtx.createOscillator();
        const mod = audioCtx.createOscillator();
        const modGain = audioCtx.createGain();
        const mainGain = audioCtx.createGain();
        
        osc.type = 'sawtooth';
        mod.type = 'triangle';
        
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + duration);
        
        mod.frequency.setValueAtTime(90, now);
        modGain.gain.setValueAtTime(400, now);
        
        mainGain.gain.setValueAtTime(0.5, now);
        mainGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
        
        mod.connect(modGain);
        modGain.connect(osc.frequency);
        osc.connect(mainGain);
        mainGain.connect(audioCtx.destination);
        
        mod.start(now);
        osc.start(now);
        
        mod.stop(now + duration);
        osc.stop(now + duration);
        
        // Add crackling high-pass noise bursts
        const bufferSize = audioCtx.sampleRate * duration;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        // Make noise crackly by zeroing out chunks
        for (let i = 0; i < bufferSize; i++) { 
            data[i] = (Math.random() * 2 - 1) * (Math.sin(i * 0.05) > 0.3 ? 1 : 0); 
        }
        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;
        
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(2000, now);
        
        const noiseGain = audioCtx.createGain();
        noiseGain.gain.setValueAtTime(0.4, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
        
        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(audioCtx.destination);
        
        noise.start(now);
        noise.stop(now + duration);
    }
}

function randomRange(min, max) {
    return Math.random() * (max - min) + min;
}

// Particle System
class Particle {
    constructor(x, y, vx, vy, color, size, life, glow = true, isRing = false, ringGrowth = 0) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.color = color;
        this.size = size;
        this.life = life;
        this.maxLife = life;
        this.glow = glow;
        this.isRing = isRing;
        this.ringGrowth = ringGrowth;
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        if (!this.isRing) {
            this.vy += 0.08 * dt; // Small gravity for particles
            this.vx *= Math.pow(0.98, dt);
            this.vy *= Math.pow(0.98, dt);
        } else {
            this.size += this.ringGrowth * dt;
        }
        this.life -= dt;
    }

    draw(ctx) {
        const alpha = this.life / this.maxLife;
        ctx.save();
        if (this.glow) {
            ctx.shadowBlur = this.isRing ? 20 : 10;
            ctx.shadowColor = this.color;
        }
        ctx.globalAlpha = alpha;
        
        if (this.isRing) {
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

function spawnHitParticles(x, y, color, count = 12) {
    for (let i = 0; i < count; i++) {
        const angle = randomRange(0, Math.PI * 2);
        const speed = randomRange(2, 7);
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed - 1.5; // Slight upward bias
        const size = randomRange(2, 5);
        const life = randomRange(20, 45);
        particles.push(new Particle(x, y, vx, vy, color, size, life));
    }
}

function spawnDustParticles(x, y, count = 5) {
    for (let i = 0; i < count; i++) {
        const vx = randomRange(-1.5, 1.5);
        const vy = randomRange(-0.5, -1.5);
        const size = randomRange(2, 4);
        const life = randomRange(15, 30);
        particles.push(new Particle(x, y, vx, vy, '#495670', size, life, false));
    }
}

// Projectile Class (Special Skill)
// Projectile Class (Special Skill or Normal Attack)
class Projectile {
    constructor(x, y, vx, color, ownerId, ownerCharacterType, size = 10, isSpecial = true, vy = 0, groupId = null) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.color = color;
        this.ownerId = ownerId;
        this.ownerCharacterType = ownerCharacterType; // 'capybara', 'otter', or 'owl'
        this.size = size;
        this.hitboxRadius = size;
        if (this.ownerCharacterType === 'otter' && this.isSpecial) {
            // Otter's special projectile wave is drawn at size * 6.4 (25 * 6.4 = 160 width, ~150 height).
            // A hitbox radius of 75 matches the visual size (diameter 150px).
            this.hitboxRadius = 75;
        }
        this.active = true;
        this.trailTimer = 0;
        this.isSpecial = isSpecial;
        this.groupId = groupId; // Used for multi-hit group tracking (like Owl's 3-feather burst)

        // Custom stats based on whether this is a Special (Plasma Wave/Gale Force) or Normal attack (Feather)
        if (isSpecial) {
            this.damage = 15;
            this.kbx = 16.5;
            this.kby = -6.5;
            this.hitstun = 42;
        } else {
            // Normal projectile (Owl's feather)
            this.damage = 6;
            this.kbx = 6.0;
            this.kby = -2.0;
            this.hitstun = 24;
        }
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.trailTimer += dt;
        if (this.trailTimer >= 2 && this.ownerCharacterType !== 'otter') {
            this.trailTimer -= 2;
            particles.push(new Particle(
                this.x - Math.sign(this.vx) * 10,
                this.y + randomRange(-4, 4),
                -this.vx * 0.1,
                randomRange(-0.5, 0.5),
                this.ownerCharacterType === 'owl' ? '#3cdcd0' : this.color,
                randomRange(3, 6),
                15,
                true
            ));
        } else if (this.ownerCharacterType === 'otter' && this.trailTimer >= 2) {
            this.trailTimer -= 2; // 타이머 리셋만 (파티클 생성 안 함)
        }

        // Deactivate if offscreen
        if (this.x < -100 || this.x > canvas.width + 100) {
            this.active = false;
        }
    }

    draw(ctx) {
        if (this.ownerCharacterType === 'otter' && otterSlashReady && otterSlashImage.width > 0) {
            ctx.save();
            ctx.translate(this.x, this.y);
            
            // 진행 방향에 따라 이미지 좌우 반전
            const dir = Math.sign(this.vx);
            ctx.scale(dir, 1);
            
            // 파도 이미지는 비율 유지하며 렌더링
            const imgW = otterSlashImage.width;
            const imgH = otterSlashImage.height;
            const drawSize = this.size * 6.4;
            const drawW = drawSize;
            const drawH = drawSize * (imgH / imgW);
            ctx.drawImage(otterSlashImage, -drawW / 2, -drawH / 2, drawW, drawH);
            ctx.restore();
        } else if (this.ownerCharacterType === 'owl') {
            if (!this.isSpecial) {
                // Owl Normal attack feather projectile
                if (owlFeatherReady && owlFeatherImage.width > 0) {
                    ctx.save();
                    ctx.translate(this.x, this.y);
                    
                    const dir = Math.sign(this.vx);
                    ctx.scale(dir, 1);
                    
                    // The feather image points from bottom-left to top-right (around 45 deg).
                    // Rotate so it aligns horizontally. When scale is positive, rotate slightly downwards
                    // to make the tip point forward. Let's adjust rotation angle to match visually.
                    const angleOffset = Math.atan2(this.vy, Math.abs(this.vx));
                    ctx.rotate(Math.PI / 4 + angleOffset); 
                    
                    const w = this.size * 2.5;
                    const h = this.size * 2.5;
                    ctx.drawImage(owlFeatherImage, -w / 2, -h / 2, w, h);
                    ctx.restore();
                } else {
                    // Fallback feather vector drawing (Mint colored diamond/leaf shape)
                    ctx.save();
                    ctx.shadowBlur = 10;
                    ctx.shadowColor = this.color;
                    ctx.fillStyle = this.color;
                    ctx.beginPath();
                    ctx.moveTo(this.x - this.size, this.y);
                    ctx.lineTo(this.x, this.y - this.size * 0.4);
                    ctx.lineTo(this.x + this.size, this.y);
                    ctx.lineTo(this.x, this.y + this.size * 0.4);
                    ctx.closePath();
                    ctx.fill();
                    ctx.restore();
                }
            } else {
                // Owl Special skill GALE FORCE (Wind vortex drawing)
                ctx.save();
                ctx.shadowBlur = 15;
                ctx.shadowColor = this.color;
                ctx.strokeStyle = this.color;
                ctx.lineWidth = 3;
                
                ctx.beginPath();
                const segments = 24;
                for (let i = 0; i < segments; i++) {
                    const t = i / segments;
                    const angle = t * Math.PI * 6; // Spiral loops
                    const radius = this.size * (0.3 + 0.7 * t);
                    const dir = Math.sign(this.vx);
                    const px = dir * t * this.size * 1.5 + Math.cos(angle) * radius;
                    const py = Math.sin(angle) * radius * 0.7;
                    if (i === 0) ctx.moveTo(this.x + px, this.y + py);
                    else ctx.lineTo(this.x + px, this.y + py);
                }
                ctx.stroke();
                
                // Wind inner core
                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size * 0.35, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        } else {
            ctx.save();
            ctx.shadowBlur = 20;
            ctx.shadowColor = this.color;
            ctx.fillStyle = this.color;
            
            // Main energy core
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();

            // Inner bright core
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size * 0.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }
}

// --- Player Class ---
class Player {
    constructor(x, y, id, characterType) {
        this.startX = x;
        this.startY = y;
        this.x = x;
        this.y = y;
        this.id = id;
        this.characterType = characterType; // 'capybara', 'otter', or 'owl'
        
        this.inputs = {
            moveLeft: false,
            moveRight: false,
            jump: false,
            attack: false,
            special: false,
            down: false
        };
        
        // Define physical size based on character proportions (Shrunk to 70% for a wider-feeling map)
        if (characterType === 'capybara') {
            this.width = 66;   // Capybara: size reduced by 15% (1.275x scaled up from 52x48)
            this.height = 61;  // Capybara: size reduced by 15%
            this.color = '#ff0055'; // Capybara Neon Red/Pink
            this.spriteSheet = p1SpriteSheet;
            this.attackMaxCooldown = 144;
            this.specialMaxCooldown = 900;
            this.maxAttackActive = 48;
            this.maxSpecialActive = 40;
            this.scaleComp = 300 / 218;
            this.spriteOffsetX = 0; // Centered
            this.spriteOffsetY = 0;
            this.headOffsetY = 18;  // Compensate for transparent padding at the top of Capy's sprite cell
            this.gravityScale = 1.0;
            this.jumpPower = -6.6; // Restored to original -6.6
        } else if (characterType === 'otter') {
            this.width = 31;   // Otter: slim and sleek
            this.height = 53;  // Otter: tall and agile
            this.color = '#0044ff'; // Otter Deep Neon Blue (Distinct from Owl's Cyan)
            this.spriteSheet = p2SpriteSheet;
            this.attackMaxCooldown = 72;
            this.specialMaxCooldown = 600;
            this.maxAttackActive = 24;
            this.maxSpecialActive = 72;
            this.scaleComp = 300 / 250;
            this.spriteOffsetX = -45; // Reverse offset to shift body to center relative to facing direction
            this.spriteOffsetY = 0;
            this.headOffsetY = 0;   // Otter is already visually aligned with no vertical offset needed
            this.gravityScale = 1.0;
            this.jumpPower = -6.6; // Restored to original -6.6
        } else if (characterType === 'owl') {
            // Owl (부엉이)
            this.width = 46;
            this.height = 58;
            this.color = '#3cdcd0'; // Cyan/Turquoise Blue-Green
            this.spriteSheet = p3SpriteSheet;
            this.attackMaxCooldown = 101; // Attack speed increased by 10% from current (111 / 1.1 ≈ 101)
            this.specialMaxCooldown = 750;
            this.maxAttackActive = 34;    // Attack animation frames decreased by 10% from current (37 / 1.1 ≈ 34)
            this.maxSpecialActive = 45;
            this.scaleComp = 300 / 250;
            this.spriteOffsetX = 0;
            this.spriteOffsetY = 0; // Pre-aligned to bottom in new spritesheet
            this.headOffsetY = 25;
            this.gravityScale = 0.25;   // Set to 0.25 for clean floaty gliding
            this.jumpPower = -4.0417;   // Increased by 25% in peak jump height (multiply original by sqrt(1.25) = -4.0417)
        } else {
            // Quokka (쿼카) - Lightning/Gold
            this.width = 50;
            this.height = 55;
            this.color = '#fbc02d'; // Gold/Yellow
            this.spriteSheet = p4SpriteSheet;
            this.attackMaxCooldown = 54;   // 48 * 1.125 = 54
            this.specialMaxCooldown = 1008; // 7 seconds cooldown
            this.maxAttackActive = 48;     // 48 active frames (18 frames left jab, 30 frames right straight)
            this.maxSpecialActive = 720;    // 5 seconds duration lightning state buff
            this.scaleComp = 300 / 195;    // Fit the 195px character height nicely in 300px cell
            this.spriteOffsetX = -30;      // Shift body backward slightly to compensate for tail and center the character
            this.spriteOffsetY = 0;
            this.headOffsetY = 25;
            this.gravityScale = 1.0;
            this.jumpPower = -6.6;
            this.quokkaAttackToggle = false;
            this.quokkaSecondHitTriggered = false;
        }
        
        this.currentAttackMaxFrames = this.maxAttackActive;
        this.vx = 0;
        this.vy = 0;
        
        // Owl normal attack multi-hit grouping parameters
        this.owlAttackGroupId = 0;
        this.lastHitOwlGroupId = -1;
        
        // Sprite Animation tracking
        this.animFrameIndex = 0;
        this.animTimer = 0;

        // Attributes
        this.maxHp = characterType === 'capybara' ? 120 : (characterType === 'owl' ? 60 : 100);
        this.hp = this.maxHp;
        this.isGrounded = false;
        this.faceDir = id === 1 ? 1 : -1; // 1P faces right, 2P faces left
        
        // Timers & Cooldowns
        this.hitstunFrames = 0;
        this.blinkFrame = 0;
        
        this.attackCooldown = 0;
        this.specialCooldown = 0;
        
        // Attack Active Frames (visual indicator)
        this.attackActiveFrames = 0;
        this.specialActiveFrames = 0;

        // Dash Attack states (for P1 Capybara special dash move)
        this.dashHistory = [];
        this.lightningHistory = [];
        this.hasHitDuringDash = false;
        this.hasHitDuringSpecial = false;
    }

    reset() {
        this.x = this.startX;
        this.y = this.startY;
        this.vx = 0;
        this.vy = 0;
        this.hp = this.maxHp;
        this.isGrounded = false;
        this.faceDir = this.id === 1 ? 1 : -1;
        this.hitstunFrames = 0;
        this.attackCooldown = 0;
        this.specialCooldown = 0;
        this.attackActiveFrames = 0;
        this.specialActiveFrames = 0;
        this.animFrameIndex = 0;
        this.animTimer = 0;
        this.dashHistory = [];
        this.lightningHistory = [];
        this.hasHitDuringDash = false;
        this.hasHitDuringSpecial = false;
        this.currentAttackMaxFrames = 32;
    }

    getAnimationFrameIndex() {
        const anims = this.characterType === 'capybara' ? p1Animations : 
                      (this.characterType === 'otter' ? p2Animations : 
                      (this.characterType === 'owl' ? p3Animations : p4Animations));
        let activeList = anims.idle;
        let index = 0;

        const isMovingLocally = this.inputs.moveLeft || this.inputs.moveRight;
        const isMovingNetwork = this.positionBuffer !== undefined && Math.abs(this.vx) > 0.5;

        if (this.hitstunFrames > 0) {
            activeList = anims.hit;
            index = 0;
        } else if (this.specialActiveFrames > 0 && this.characterType !== 'quokka') {
            activeList = anims.special;
            const progress = this.maxSpecialActive - this.specialActiveFrames;
            index = Math.min(activeList.length - 1, Math.floor(progress / (this.maxSpecialActive / activeList.length)));
        } else if (this.attackActiveFrames > 0) {
            if (this.characterType === 'quokka') {
                const threshold = Math.round(this.currentAttackMaxFrames * 0.625);
                return this.attackActiveFrames > threshold ? 2 : 3;
            }
            activeList = anims.attack;
            const progress = this.maxAttackActive - this.attackActiveFrames;
            index = Math.min(activeList.length - 1, Math.floor(progress / (this.maxAttackActive / activeList.length)));
        } else if (isMovingLocally || isMovingNetwork || (this.characterType === 'owl' && !this.isGrounded && !this.inputs.down)) {
            activeList = anims.move;
            index = this.animFrameIndex % activeList.length;
        } else {
            activeList = anims.idle;
            index = this.animFrameIndex % activeList.length;
        }

        return activeList[index] !== undefined ? activeList[index] : activeList[0];
    }

    updateInputs(opponent) {
        if (this.id === 1) {
            this.inputs.moveLeft = keys.a;
            this.inputs.moveRight = keys.d;
            this.inputs.jump = keys.w;
            this.inputs.attack = keys.f;
            this.inputs.special = keys.g;
            this.inputs.down = keys.s;
        } else {
            if (gameMode === 'pve') {
                this.updateAIInputs(opponent);
            } else {
                this.inputs.moveLeft = keys.ArrowLeft;
                this.inputs.moveRight = keys.ArrowRight;
                this.inputs.jump = keys.ArrowUp;
                this.inputs.attack = keys['['];
                this.inputs.special = keys[']'];
                this.inputs.down = keys.ArrowDown;
            }
        }
    }



    update(dt, opponent) {
        this.updateInputs(opponent);

        // Update Animation Timer
        const anims = this.characterType === 'capybara' ? p1Animations : 
                      (this.characterType === 'otter' ? p2Animations : 
                      (this.characterType === 'owl' ? p3Animations : p4Animations));
        let activeList = anims.idle;
        
        const isMovingLocally = this.inputs.moveLeft || this.inputs.moveRight;
        const isMovingNetwork = this.positionBuffer !== undefined && Math.abs(this.vx) > 0.5;

        if (this.hitstunFrames > 0) {
            activeList = anims.hit;
        } else if (this.specialActiveFrames > 0 && this.characterType !== 'quokka') {
            activeList = anims.special;
        } else if (this.attackActiveFrames > 0) {
            activeList = anims.attack;
        } else if (isMovingLocally || isMovingNetwork || (this.characterType === 'owl' && !this.isGrounded && !this.inputs.down)) {
            activeList = anims.move;
            this.animTimer += dt;
            const frameTime = 6;
            if (this.animTimer >= frameTime) {
                this.animTimer -= frameTime;
                this.animFrameIndex = (this.animFrameIndex + 1) % activeList.length;
            }
        } else {
            activeList = anims.idle;
            this.animTimer += dt;
            const frameTime = 10;
            if (this.animTimer >= frameTime) {
                this.animTimer -= frameTime;
                this.animFrameIndex = (this.animFrameIndex + 1) % activeList.length;
            }
        }

        // Decrease cooldown timers
        if (this.attackCooldown > 0) this.attackCooldown = Math.max(0, this.attackCooldown - dt);
        if (this.specialCooldown > 0) {
            if (this.characterType === 'quokka' && this.specialActiveFrames > 0) {
                // Hold specialCooldown at max while Quokka is in active lightning state
                this.specialCooldown = this.specialMaxCooldown;
            } else {
                this.specialCooldown = Math.max(0, this.specialCooldown - dt);
            }
        }
        
        // Handle Hitstun
        if (this.hitstunFrames > 0) {
            this.hitstunFrames = Math.max(0, this.hitstunFrames - dt);
            this.blinkFrame += dt;
            
            // Limit controls during hitstun
            this.vx *= Math.pow(frictionAir, dt);
            this.vy += gravity * (this.gravityScale || 1.0) * dt;
            this.applyPhysics(dt);
            return;
        }

        // Decrement active action visuals
        if (this.attackActiveFrames > 0) {
            const prevActive = this.attackActiveFrames;
            this.attackActiveFrames = Math.max(0, this.attackActiveFrames - dt);
            
            // Quokka 2-hit combo: 2nd hit (right straight) triggers after jab
            const threshold = Math.round(this.currentAttackMaxFrames * 0.625);
            if (this.characterType === 'quokka' && 
                prevActive > threshold && 
                this.attackActiveFrames <= threshold && 
                !this.quokkaSecondHitTriggered) {
                
                this.quokkaSecondHitTriggered = true;
                playSound('swing');
                const dmg = this.specialActiveFrames > 0 ? 3 : 2;
                this.checkMeleeHit(dmg, this.faceDir * 2.0, -1.2, 15, 60, 60); // 2nd hit (Right straight)
            }
        }

        // P1 Capybara Special Dash Attack Logic
        if (this.characterType === 'capybara' && this.specialActiveFrames > 0) {
            this.specialActiveFrames = Math.max(0, this.specialActiveFrames - dt);
            
            // Force high horizontal speed, lock vertical speed (laser-like dash)
            this.vx = this.faceDir * 8;
            this.vy = 0; 
            
            // Record dash history for afterimages
            this.dashHistory.push({
                x: this.x,
                y: this.y,
                faceDir: this.faceDir,
                animFrameIndex: this.getAnimationFrameIndex()
            });
            if (this.dashHistory.length > 5) this.dashHistory.shift();
            
            // Spawn fire trailing particles
            const px = this.faceDir === 1 ? this.x : this.x + this.width;
            const py = this.y + randomRange(5, this.height - 5);
            const numParticles = Math.max(1, Math.round(2 * dt));
            for (let k = 0; k < numParticles; k++) {
                particles.push(new Particle(
                    px, py, 
                    -this.faceDir * randomRange(2, 6), 
                    randomRange(-1.5, 1.5), 
                    '#ff003c', 
                    randomRange(3, 6), 
                    18, 
                    true
                ));
            }
            
            // Hit collision detection during dash (single-hit)
            if (!this.hasHitDuringDash) {
                const opponent = this.id === 1 ? player2 : player1;
                
                const dashHitboxWidth = this.width + 40;
                const dashHitboxX = this.faceDir === 1 ? this.x : this.x - 40;
                const dashHitboxY = this.y - 15;
                const dashHitboxHeight = this.height + 30;

                if (
                    opponent &&
                    dashHitboxX < opponent.x + opponent.width &&
                    dashHitboxX + dashHitboxWidth > opponent.x &&
                    dashHitboxY < opponent.y + opponent.height &&
                    dashHitboxY + dashHitboxHeight > opponent.y
                ) {
                    // Check if opponent is Owl using windstorm (Owl's gust blocks Capybara's dash)
                    if (opponent.characterType === 'owl' && opponent.specialActiveFrames > 0) {
                        this.specialActiveFrames = 0; // Cancel Capybara's dash
                        this.vx = -this.faceDir * 10; // Bounce back
                        this.takeDamage(5, this.vx, -5, 42); // Take Owl windstorm damage
                        playSound('p2SpecialHit'); // Owl's special hit sound
                        spawnHitParticles(this.x + this.width / 2, this.y + this.height / 2, opponent.color, 20);
                        return; // Stop processing dash hit
                    }

                    this.hasHitDuringDash = true;
                    // Heavy hit: 25 damage, huge knockback, 55 hitstun
                    opponent.takeDamage(25, this.faceDir * 19, -5.5, 55);
                    playSound('p1SpecialHit');
                    
                    // Exploding impact particles
                    const impactX = this.faceDir === 1 ? opponent.x : opponent.x + opponent.width;
                    const impactY = opponent.y + opponent.height / 2;
                    spawnHitParticles(impactX, impactY, this.color, 24);
                    
                    // Huge screen shake
                    triggerCameraShake(22, 10);
                }
            }
            
            // Apply physics movement directly and bypass input control
            this.applyPhysics(dt);
            return; 
        } else if (this.characterType === 'capybara' && this.specialActiveFrames === 0) {
            this.dashHistory = [];
        }

        // For Otter, Owl & Quokka, standard special active frames decrement
        if (this.characterType !== 'capybara' && this.specialActiveFrames > 0) {
            this.specialActiveFrames = Math.max(0, this.specialActiveFrames - dt);
            
            // Add Owl AoE windstorm collision logic (hits once per activation)
            if (this.characterType === 'owl' && !this.hasHitDuringSpecial) {
                const opponent = this.id === 1 ? player2 : player1;
                
                const selfCenterX = this.x + this.width / 2;
                const selfCenterY = this.y + this.height / 2;
                const oppCenterX = opponent.x + opponent.width / 2;
                const oppCenterY = opponent.y + opponent.height / 2;
                
                const dx = oppCenterX - selfCenterX;
                const dy = oppCenterY - selfCenterY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                const hitRadius = 200; // Expanded to 200px range around the Owl to match the new windstorm visual and particle spread
                if (dist < hitRadius) {
                    this.hasHitDuringSpecial = true;
                    
                    let kbx = this.faceDir * 33; // Doubled horizontal knockback (originally 16.5)
                    let kby = -10.0;            // Doubled vertical knockback (originally -5.0)
                    if (dist > 0.1) {
                        kbx = (dx / dist) * 33;
                        kby = (dy / dist) * 12.0 - 10.0; // Doubled overall knockback vector (originally 6.0 and -5.0)
                    }
                    
                    opponent.takeDamage(5, kbx, kby, 42);
                    playSound('p2SpecialHit');
                    spawnHitParticles(oppCenterX, oppCenterY, this.color, 20);
                    triggerCameraShake(18, 6);
                }
            }

            // Quokka lightning state: record history for afterimages and spawn sparks
            if (this.characterType === 'quokka') {
                if (!this.lightningHistory) this.lightningHistory = [];
                this.lightningHistory.push({
                    x: this.x,
                    y: this.y,
                    faceDir: this.faceDir,
                    animFrameIndex: this.getAnimationFrameIndex()
                });
                if (this.lightningHistory.length > 5) this.lightningHistory.shift();

                // Spawn neon electric particles
                if (Math.random() < 0.45 * dt) {
                    const px = this.x + randomRange(0, this.width);
                    const py = this.y + randomRange(0, this.height);
                    const color = Math.random() < 0.4 ? '#fbc02d' : '#fff59d'; // gold or electric yellow spark
                    particles.push(new Particle(
                        px, py,
                        randomRange(-1.5, 1.5),
                        randomRange(-1.5, 1.5),
                        color,
                        randomRange(2.0, 4.5),
                        randomRange(12, 24),
                        true
                    ));
                }
            }
        } else if (this.characterType === 'quokka') {
            this.lightningHistory = [];
        }

        // Get Input Actions
        let moveLeft = this.inputs.moveLeft;
        let moveRight = this.inputs.moveRight;
        let jump = this.inputs.jump;
        let attack = this.inputs.attack;
        let special = this.inputs.special;

        // Horizontal Movement (Optimized with rounded literal constants to 2 decimal places)
        let accel = 0.38; // Base default 0.375 rounded
        if (this.characterType === 'capybara') {
            accel = 0.26; // 0.375 * 0.7 = 0.2625
        } else if (this.characterType === 'otter') {
            accel = 0.47; // 0.375 * 1.25 = 0.46875
        } else if (this.characterType === 'owl') {
            accel = 0.86; // 0.375 * 2.30 = 0.8625
        } else if (this.characterType === 'quokka') {
            accel = this.specialActiveFrames > 0 ? 0.77 : 0.51; // 1.5x speed increase in lightning state
        }
        
        // Owl cannot accelerate horizontally when grounded, but can still turn around
        if (this.characterType === 'owl' && this.isGrounded) {
            accel = 0;
        }
        
        let maxSpeed = 3.25; // Base default 3.25
        if (this.characterType === 'capybara') {
            maxSpeed = 2.28; // 3.25 * 0.7 = 2.275
        } else if (this.characterType === 'otter') {
            maxSpeed = 4.06; // 3.25 * 1.25 = 4.0625
        } else if (this.characterType === 'owl') {
            maxSpeed = 7.48; // 3.25 * 2.30 = 7.475
        } else if (this.characterType === 'quokka') {
            maxSpeed = this.specialActiveFrames > 0 ? 6.59 : 4.39; // 1.5x speed increase in lightning state
        }

        if (moveLeft) {
            this.vx -= accel * dt;
            this.faceDir = -1;
        } else if (moveRight) {
            this.vx += accel * dt;
            this.faceDir = 1;
        }

        // Limit speed
        if (Math.abs(this.vx) > maxSpeed) {
            this.vx = Math.sign(this.vx) * maxSpeed;
        }

        // Jumping
        if (jump && this.isGrounded) {
            this.vy = this.jumpPower || -6.6; 
            this.isGrounded = false;
            // Spawn dust on jump
            spawnDustParticles(this.x + this.width / 2, this.y + this.height, 6);
        }

        // Apply Friction
        this.vx *= Math.pow(frictionGrounded, dt);
        if (this.characterType === 'owl' && this.isGrounded) {
            this.vx = 0; // Lock horizontal speed on ground
        }

        // Apply Gravity (increase gravity to Otter's 1.0 if Owl is pressing down arrow / S)
        let currentGravityScale = this.gravityScale || 1.0;
        if (this.characterType === 'owl' && this.inputs.down) {
            currentGravityScale = 1.5; // Fast fall gravity scale
        }
        this.vy += gravity * currentGravityScale * dt;

        // If Owl is falling normally (not pressing down key) and has passed the peak of jump (vy >= 0)
        // enforce constant falling speed (terminal/constant velocity) for a realistic gliding feel
        if (this.characterType === 'owl' && !this.isGrounded && this.vy >= 0) {
            if (!this.inputs.down) {
                this.vy = 1.1; // Steady constant gliding speed
            }
        }


        // Perform Attacks
        if (attack && this.attackCooldown === 0) {
            this.performNormalAttack();
        }
        if (special && this.specialCooldown === 0) {
            this.performSpecialAttack();
        }

        this.applyPhysics(dt);
    }

    applyPhysics(dt) {
        // Save previous coordinates for platform collision check
        const prevY = this.y;

        // Apply velocities
        this.x += this.vx * dt;
        this.y += this.vy * dt;

        // Border clamping: prevent players from going off the left/right screen borders
        if (this.x < 0) {
            this.x = 0;
            this.vx = 0; // Stop horizontal momentum
        } else if (this.x + this.width > canvas.width) {
            this.x = canvas.width - this.width;
            this.vx = 0; // Stop horizontal momentum
        }

        // Top border clamping: prevent players from going too far above the screen
        if (this.y < -40) {
            this.y = -40;
            this.vy = 0; // Stop upward momentum
        }

        // Collision with platforms
        this.isGrounded = false;
        for (let i = 0; i < platforms.length; i++) {
            const plat = platforms[i];
            
            // Bypass collision for elevated platforms if player is pressing down
            if (!plat.isGround && this.inputs.down) {
                continue;
            }
            
            const feetY = this.y + this.height;
            const prevFeetY = prevY + this.height;

            if (
                this.x + this.width >= plat.x &&
                this.x <= plat.x + plat.width &&
                prevFeetY <= plat.y + 2 &&
                feetY >= plat.y &&
                this.vy >= 0
            ) {
                // Landing on this platform
                this.y = plat.y - this.height;
                this.vy = 0;
                this.isGrounded = true;
                
                if (prevFeetY < plat.y && this.vy > 1) {
                    spawnDustParticles(this.x + this.width / 2, this.y + this.height, 4);
                }
                break; // Stop checking other platforms once grounded
            }
        }

        // Out of Bounds check
        if (this.y > canvas.height + 50) {
            this.hp = 0; // Instant defeat
        }
    }

    checkMeleeHit(damage, kbx, kby, hitstun, hitboxWidth, hitboxHeight) {
        const hitboxY = this.y + (this.height - hitboxHeight) / 2;
        let hitboxX = this.faceDir === 1 ? this.x + this.width : this.x - hitboxWidth;

        const opponent = this.id === 1 ? player2 : player1;
        if (
            hitboxX < opponent.x + opponent.width &&
            hitboxX + hitboxWidth > opponent.x &&
            hitboxY < opponent.y + opponent.height &&
            hitboxY + hitboxHeight > opponent.y
        ) {
            opponent.takeDamage(damage, kbx, kby, hitstun);
            playSound('hit');
            
            const contactX = this.faceDir === 1 ? opponent.x : opponent.x + opponent.width;
            const contactY = hitboxY + hitboxHeight / 2;
            spawnHitParticles(contactX, contactY, this.color, 10);
            triggerCameraShake(10, 4);
        }

        // Swipe Particles
        const swipeX = this.faceDir === 1 ? this.x + this.width + 10 : this.x - 20;
        const swipeY = this.y + this.height / 2;
        for (let i = 0; i < 4; i++) {
            particles.push(new Particle(
                swipeX + randomRange(-5, 5),
                swipeY + randomRange(-15, 15),
                this.faceDir * randomRange(1, 3),
                randomRange(-1, 1),
                this.color,
                randomRange(2, 4),
                10,
                false
            ));
        }
    }

    performNormalAttack() {
        let cooldown = this.attackMaxCooldown;
        let activeFrames = this.maxAttackActive;

        if (this.characterType === 'quokka') {
            this.quokkaSecondHitTriggered = false; // Reset second hit flag for this new attack combo!
            if (this.specialActiveFrames > 0) {
                cooldown = 36; // 1.5x attack speed: 54 / 1.5 = 36
                activeFrames = 32; // 1.5x attack speed: 48 / 1.5 = 32
            }
        }

        this.attackCooldown = cooldown;
        this.attackActiveFrames = activeFrames; // visual effect duration linked dynamically
        this.currentAttackMaxFrames = activeFrames;
        playSound('swing');

        if (this.characterType === 'owl') {
            this.owlAttackGroupId++;
            const groupId = this.owlAttackGroupId;

            // Owl normal attack: throws 3 feather projectiles in a spread (center, 15 deg up, 15 deg down)
            const projectileX = this.faceDir === 1 ? this.x + this.width + 10 : this.x - 10;
            const projectileY = this.y + this.height / 2 - 4;
            
            const speed = 6.5;
            const vxCenter = this.faceDir * speed;
            const vyCenter = 0;

            const vxSpread = this.faceDir * speed * 0.966; // cos(15 deg) = 0.966
            const vyUp = -speed * 0.259;                 // sin(15 deg) = 0.259 (Y is negative upwards)
            const vyDown = speed * 0.259;

            // Center (straight)
            projectiles.push(new Projectile(projectileX, projectileY, vxCenter, this.color, this.id, this.characterType, 12, false, vyCenter, groupId));
            // 15 deg Up
            projectiles.push(new Projectile(projectileX, projectileY, vxSpread, this.color, this.id, this.characterType, 12, false, vyUp, groupId));
            // 15 deg Down
            projectiles.push(new Projectile(projectileX, projectileY, vxSpread, this.color, this.id, this.characterType, 12, false, vyDown, groupId));

            // Feather drift visual particles
            for (let i = 0; i < 4; i++) {
                particles.push(new Particle(
                    projectileX + randomRange(-4, 4),
                    projectileY + randomRange(-8, 8),
                    this.faceDir * randomRange(1, 3),
                    randomRange(-1, 1),
                    this.color,
                    randomRange(2, 4),
                    12,
                    false
                ));
            }
        } else {
            // Melee Attacks
            if (this.characterType === 'capybara') {
                this.checkMeleeHit(7, this.faceDir * 7, -3.5, 35, 69, 69);
            } else if (this.characterType === 'otter') {
                this.checkMeleeHit(3, this.faceDir * 7, -3.5, 35, 104, 104);
            } else if (this.characterType === 'quokka') {
                const dmg = 2;
                this.checkMeleeHit(dmg, this.faceDir * 2.0, -1.2, 15, 60, 60); // 1st hit (Left jab)
            }
        }
    }

    performSpecialAttack() {
        this.specialCooldown = this.specialMaxCooldown;
        this.specialActiveFrames = this.maxSpecialActive; // visual effect duration linked dynamically
        
        let startupSound = 'p2SpecialStartup';
        if (this.characterType === 'capybara') {
            startupSound = 'p1SpecialStartup';
        } else if (this.characterType === 'owl') {
            startupSound = 'p3SpecialStartup';
        } else if (this.characterType === 'quokka') {
            startupSound = 'quokkaSpecialStartup';
        }
        playSound(startupSound);

        if (this.characterType === 'capybara') {
            // P1 Capybara special: Dash Attack Initialization
            this.hasHitDuringDash = false;
            this.dashHistory = [];
            
            // Spawn initial burst of dust & dash energy particles at the start point
            const px = this.faceDir === 1 ? this.x : this.x + this.width;
            const py = this.y + this.height / 2;
            for (let i = 0; i < 15; i++) {
                particles.push(new Particle(
                    px,
                    py + randomRange(-15, 15),
                    -this.faceDir * randomRange(4, 10), // Speed particles shooting backwards
                    randomRange(-3, 3),
                    this.color,
                    randomRange(3, 7),
                    25,
                    true
                ));
            }
            triggerCameraShake(10, 4);
        } else if (this.characterType === 'owl') {
            // Owl special: Gale Force circular AoE windstorm (Centered on Owl)
            this.hasHitDuringSpecial = false;

            // Minor recoil back
            this.vx = -this.faceDir * 1.0;

            // Spawn circular wind particles centered around the Owl
            const selfCenterX = this.x + this.width / 2;
            const selfCenterY = this.y + this.height / 2;
            // Spawn larger circular wind particles to visually match the expanded AoE range
            for (let i = 0; i < 35; i++) {
                const angle = randomRange(0, Math.PI * 2);
                const speed = randomRange(4, 12);
                particles.push(new Particle(
                    selfCenterX,
                    selfCenterY,
                    Math.cos(angle) * speed,
                    Math.sin(angle) * speed,
                    this.color,
                    randomRange(3.5, 7.5),
                    32,
                    true
                ));
            }
            triggerCameraShake(15, 5);
        } else if (this.characterType === 'otter') {
            // P2 Otter special: Shoot crescent slash wave
            const projectileX = this.faceDir === 1 ? this.x + this.width + 15 : this.x - 15;
            const projectileY = this.y + this.height / 4; // Raised to upper quarter of character
            const speed = this.faceDir * 7.15; // Increased by 30% (originally 5.5, 5.5 * 1.3 = 7.15)

            // Spawn high-speed plasma bullet (scaled up 2.5x to size 25)
            projectiles.push(new Projectile(projectileX, projectileY, speed, this.color, this.id, this.characterType, 25, true));

            // Recoil kickback on the shooter
            this.vx = -this.faceDir * 2.25; // Recoil halved too

            // Particle muzzle burst
            for (let i = 0; i < 8; i++) {
                particles.push(new Particle(
                    projectileX,
                    projectileY,
                    this.faceDir * randomRange(2, 6) + randomRange(-1, 1),
                    randomRange(-2, 2),
                    this.color,
                    randomRange(3, 5),
                    15,
                    true
                ));
            }
            triggerCameraShake(8, 2);
        } else {
            // Quokka special: Lightning State Activation burst (no direct damage)
            triggerCameraShake(12, 4);
            
            // Spark visual burst effect
            const selfCenterX = this.x + this.width / 2;
            const selfCenterY = this.y + this.height / 2;
            for (let i = 0; i < 30; i++) {
                const angle = randomRange(0, Math.PI * 2);
                const speed = randomRange(4, 10);
                particles.push(new Particle(
                    selfCenterX,
                    selfCenterY,
                    Math.cos(angle) * speed,
                    Math.sin(angle) * speed,
                    '#fff59d', // electric yellow
                    randomRange(2.5, 6.0),
                    35,
                    true
                ));
            }
        }
    }

    takeDamage(damage, kbx, kby, hitstun) {
        if (this.hp <= 0) return;

        // Apply Quokka lightning state knockback resistance (halve the knockback velocity)
        if (this.characterType === 'quokka' && this.specialActiveFrames > 0) {
            kbx *= 0.4; // 60% knockback resistance
            kby *= 0.4;
        }

        this.hp = Math.max(0, this.hp - damage);
        
        if (hitstun > 0) {
            this.hitstunFrames = hitstun;
            this.blinkFrame = 0;

            // Apply knockback
            this.vx = kbx;
            this.vy = kby;
            this.isGrounded = false;
        }
    }

    draw(ctx) {

        ctx.save();
        ctx.shadowBlur = 12;
        ctx.shadowColor = this.color;

        // Draw Player Sprite if spritesheet is loaded, otherwise fallback to neon vector
        if (this.spriteSheet && this.spriteSheet.complete && this.spriteSheet.width > 0) {
            // Draw P1 Capybara Dash Afterimages
            if (this.characterType === 'capybara' && this.dashHistory && this.dashHistory.length > 0) {
                const frameWidth = this.spriteSheet.width / 4;
                const frameHeight = this.spriteSheet.height;
                const aspect = frameWidth / frameHeight;
                const scaleComp = this.scaleComp;
                const drawHeight = this.height * 1.35 * scaleComp;
                const drawWidth = drawHeight * aspect;
                const localOffsetY = (this.spriteOffsetY || 0) * (drawHeight / 300);

                this.dashHistory.forEach((hist, index) => {
                    const alpha = (index + 1) / (this.dashHistory.length + 1) * 0.38;
                    ctx.save();
                    ctx.globalAlpha = alpha;
                    ctx.globalCompositeOperation = 'screen';
                    
                    // Neon red trail outline glow effect
                    ctx.shadowBlur = 18;
                    ctx.shadowColor = '#ff003c';

                    const sx = hist.animFrameIndex * frameWidth;
                    
                    ctx.translate(hist.x + this.width / 2, hist.y + this.height);
                    ctx.scale(hist.faceDir, 1);
                    
                    const localOffsetX = (this.spriteOffsetX || 0) * (drawWidth / 300);
                    ctx.drawImage(
                        this.spriteSheet,
                        sx, 0, frameWidth, frameHeight,
                        -drawWidth / 2 + localOffsetX, -drawHeight + 4 + localOffsetY,
                        drawWidth, drawHeight
                    );
                    ctx.restore();
                });
            }

            // Draw Quokka Lightning Afterimages
            if (this.characterType === 'quokka' && this.lightningHistory && this.lightningHistory.length > 0) {
                const totalFrames = 5;
                const frameWidth = this.spriteSheet.width / totalFrames;
                const frameHeight = this.spriteSheet.height;
                const aspect = frameWidth / frameHeight;
                const scaleComp = this.scaleComp;
                const drawHeight = this.height * 1.35 * scaleComp;
                const drawWidth = drawHeight * aspect;
                const localOffsetY = (this.spriteOffsetY || 0) * (drawHeight / 300);

                this.lightningHistory.forEach((hist, index) => {
                    const alpha = (index + 1) / (this.lightningHistory.length + 1) * 0.28;
                    ctx.save();
                    ctx.globalAlpha = alpha;
                    ctx.globalCompositeOperation = 'screen';
                    
                    // Yellow/gold lightning glow
                    ctx.shadowBlur = 18;
                    ctx.shadowColor = '#fbc02d'; // Gold glow

                    const sx = hist.animFrameIndex * frameWidth;
                    
                    ctx.translate(hist.x + this.width / 2, hist.y + this.height);
                    ctx.scale(hist.faceDir, 1);
                    
                    let currentOffsetX = -30;
                    if (hist.animFrameIndex === 2) {
                        currentOffsetX = 0;
                    } else if (hist.animFrameIndex === 3) {
                        currentOffsetX = 15;
                    }
                    const localOffsetX = currentOffsetX * (drawWidth / 300);

                    ctx.drawImage(
                        this.spriteSheet,
                        sx, 0, frameWidth, frameHeight,
                        -drawWidth / 2 + localOffsetX, -drawHeight + 4 + localOffsetY,
                        drawWidth, drawHeight
                    );
                    ctx.restore();
                });
            }

            const frameIndex = this.getAnimationFrameIndex();
            
            // Calculate size dynamically based on the actual image resolution (split by 4 or 5 frames horizontally)
            const totalFrames = this.characterType === 'quokka' ? 5 : 4;
            const frameWidth = this.spriteSheet.width / totalFrames;
            const frameHeight = this.spriteSheet.height;
            
            const sx = frameIndex * frameWidth;
            const sy = 0;
            const sw = frameWidth;
            const sh = frameHeight;
            
            const aspect = frameWidth / frameHeight;
            // Scale compensation for transparent padding in 300x300 cells
            const scaleComp = this.scaleComp;
            let drawHeight = this.height * 1.35 * scaleComp; // Sized slightly larger than physics hitbox for great visual impact
            let drawWidth = drawHeight * aspect;
            
            // Increase size by 10% when Owl is moving (animation frame index 1)
            if (this.characterType === 'owl' && frameIndex === 1) {
                drawHeight *= 1.10;
                drawWidth *= 1.10;
            }
            
            ctx.save();
            // Translate to BOTTOM-CENTER of the player collision box to lock feet on the ground
            ctx.translate(this.x + this.width / 2, this.y + this.height);

            // 1. Draw Flat Aura Ring under feet to preserve the neon concept without bleeding into the sprite
            ctx.save();
            ctx.shadowBlur = 24; 
            ctx.shadowColor = this.color;
            ctx.fillStyle = this.color;
            ctx.globalAlpha = 0.45; 
            ctx.beginPath();
            ctx.ellipse(0, 0, this.width * 0.9, 5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // 2. Draw Sprite with NO shadow bleed to protect original pixel colors (eyes, white eyes, etc.)
            ctx.save();
            ctx.shadowBlur = 0; // Disable shadow glow on the sprite itself!
            ctx.scale(this.faceDir, 1);

            let currentOffsetX = this.spriteOffsetX || 0;
            if (this.characterType === 'quokka') {
                if (frameIndex === 2) {
                    currentOffsetX = 0;   // Shift forward to 0 (originally -30) during Left Jab
                } else if (frameIndex === 3) {
                    currentOffsetX = 15;  // Shift forward to 15 (originally -30) during Right Straight
                }
            }
            const localOffsetX = currentOffsetX * (drawWidth / 300);
            const localOffsetY = (this.spriteOffsetY || 0) * (drawHeight / 300);

            if (this.characterType === 'capybara' && this.specialActiveFrames > 0 && capyDashStateReady && capyDashStateImage.width > 0) {
                // Draw dash state image for Capybara special (capy_dash_state.png is 300x300)
                // Image is bottom-aligned in its 300x300 canvas, matching the sprite coordinate system
                const dashScale = drawHeight / 300;
                const dashDrawW = 300 * dashScale;
                const dashDrawH = 300 * dashScale;
                ctx.globalAlpha = 1.0;
                ctx.drawImage(
                    capyDashStateImage,
                    -dashDrawW / 2,
                    -dashDrawH,
                    dashDrawW,
                    dashDrawH
                );
            } else {
                // Render frame centered at bottom
                ctx.drawImage(
                    this.spriteSheet, 
                    sx, sy, sw, sh, 
                    -drawWidth / 2 + localOffsetX, -drawHeight + 4 + localOffsetY,
                    drawWidth, drawHeight
                );
            }

            if (this.characterType === 'owl' && this.specialActiveFrames > 0 && owlSpecialStateReady && owlSpecialStateImage.width > 0) {
                // Draw special state windstorm wrapping the Owl
                const drawHeightSpecial = (drawHeight / 0.4541) * 0.90;
                const drawWidthSpecial = drawHeightSpecial;
                ctx.save();
                ctx.globalAlpha = 1.0;
                ctx.drawImage(
                    owlSpecialStateImage,
                    -drawWidthSpecial / 2,
                    -drawHeightSpecial * 0.5674 - 20,
                    drawWidthSpecial,
                    drawHeightSpecial
                );
                ctx.restore();
            }
            ctx.restore(); // Restore faceDir scale
            
            if (this.characterType === 'quokka' && this.specialActiveFrames > 0) {
                drawLightningEffect(ctx, -this.width / 2, -this.height, this.width, this.height);
            }
            
            ctx.restore(); // Restore bottom-center translation
        } else {
            // FALLBACK VECTOR NEON RENDERING (If sprite sheets fail to load)
            ctx.fillStyle = this.color;
            
            // Draw round corner rectangle for premium aesthetic
            drawRoundedRect(ctx, this.x, this.y, this.width, this.height, 10);
            ctx.fill();

            // Highlighting borders (glass/cyber look)
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.5;
            drawRoundedRect(ctx, this.x, this.y, this.width, this.height, 10);
            ctx.stroke();
            ctx.globalAlpha = 1.0;

            // Cyber Eyes (indicating direction)
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 8;
            const eyeHeight = 8;
            const eyeWidth = 12;
            const eyeY = this.y + 16;
            
            if (this.faceDir === 1) {
                // Looking Right
                ctx.fillRect(this.x + this.width - 18, eyeY, eyeWidth, eyeHeight);
            } else {
                // Looking Left
                ctx.fillRect(this.x + 6, eyeY, eyeWidth, eyeHeight);
            }
            
            if (this.characterType === 'quokka' && this.specialActiveFrames > 0) {
                drawLightningEffect(ctx, this.x, this.y, this.width, this.height);
            }
        }

        // Draw P1 / P2 and Arrow above the player's head
        ctx.save();
        
        // Define dynamic unique colors: P1 is Orange, P2 is Sky Blue
        const indicatorColor = this.id === 1 ? '#ff7700' : '#00ccff';
        
        ctx.shadowBlur = 8;
        ctx.shadowColor = indicatorColor;
        ctx.fillStyle = indicatorColor;
        
        // Calculate Y position above the player's sprite head
        // If sprite sheet is loaded, head height is drawHeight. Otherwise fallback to this.height.
        let headY = this.y - 4;
        if (this.spriteSheet && this.spriteSheet.complete && this.spriteSheet.width > 0) {
            const drawHeight = this.height * 1.35 * this.scaleComp;
            const localOffsetY = (this.spriteOffsetY || 0) * (drawHeight / 300);
            headY = (this.y + this.height) - drawHeight - 4 + (this.headOffsetY || 0) + localOffsetY;
        }

        // Draw Player Label (P1 or P2)
        ctx.font = "10px 'Press Start 2P'";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        
        const label = `P${this.id}`;
        const labelX = this.x + this.width / 2;
        
        // Render label text with a thin black outline for maximum contrast
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText(label, labelX, headY - 14);
        ctx.fillText(label, labelX, headY - 14);
        
        // Draw tiny neon triangle (arrow) pointing down at player
        ctx.beginPath();
        ctx.moveTo(labelX - 5, headY - 6);
        ctx.lineTo(labelX + 5, headY - 6);
        ctx.lineTo(labelX, headY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        ctx.restore();

        ctx.restore();
    }
}

// Draw lightning effect around player
function drawLightningEffect(ctx, x, y, width, height) {
    ctx.save();
    ctx.strokeStyle = '#fff59d'; // bright electric yellow

    // Use a seeded random that updates only once every 12 frames (lasts 12 frames)
    const seed = Math.floor(globalFrameCount / 12);
    let seedVal = seed;
    function seededRandom() {
        const val = Math.sin(seedVal++) * 10000;
        return val - Math.floor(val);
    }
    function seededRandomRange(min, max) {
        return seededRandom() * (max - min) + min;
    }

    // Adjusted line width (2.25~4.5px)
    ctx.lineWidth = (1.5 + seededRandom() * 1.5) * 1.5;
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#fbc02d'; // gold glow

    const sparks = 3;
    const cx = x + width / 2;
    const cy = y + height / 2;
    const rx = width / 2 + 14;  // ellipse x-radius (slightly outside hitbox)
    const ry = height / 2 + 10; // ellipse y-radius

    for (let i = 0; i < sparks; i++) {
        // Each spark starts from a distinct angular sector (360deg / sparks = 120deg apart)
        // Add a small seeded jitter within the sector so they don't look robotic
        const sectorAngle = (Math.PI * 2 / sparks) * i;
        const jitter = seededRandomRange(-0.35, 0.35); // ±20deg jitter
        const angle = sectorAngle + jitter;

        // Starting point on the perimeter ellipse
        let curX = cx + Math.cos(angle) * rx;
        let curY = cy + Math.sin(angle) * ry;

        // Push head-side bolts (upper half) further up so they don't cover the face
        if (Math.sin(angle) < 0) {
            curY -= 18;
        }
        ctx.beginPath();
        ctx.moveTo(curX, curY);

        // Zig-zag segments, clamped to stay near the player body
        const segments = 3 + Math.floor(seededRandom() * 2);
        for (let j = 0; j < segments; j++) {
            curX += seededRandomRange(-20, 20);
            curY += seededRandomRange(-15, 15);

            // Clamp to player hitbox bounds + small margin
            curX = Math.max(x - 20, Math.min(x + width + 20, curX));
            curY = Math.max(y - 15, Math.min(y + height + 15, curY));

            ctx.lineTo(curX, curY);
        }
        ctx.stroke();
    }

    // Add a 6th branch starting from the center of the body (cx, cy) extending outwards
    {
        let curX = cx;
        let curY = cy;
        ctx.beginPath();
        ctx.moveTo(curX, curY);

        // Choose a seeded random direction to branch out
        const angle = seededRandom() * Math.PI * 2;
        const segments = 3 + Math.floor(seededRandom() * 2);
        for (let j = 0; j < segments; j++) {
            const stepLen = 12 + seededRandom() * 8; // 12 to 20px step
            const stepAngle = angle + seededRandomRange(-0.5, 0.5);
            curX += Math.cos(stepAngle) * stepLen;
            curY += Math.sin(stepAngle) * stepLen;

            // Clamp to player hitbox bounds + small margin
            curX = Math.max(x - 20, Math.min(x + width + 20, curX));
            curY = Math.max(y - 15, Math.min(y + height + 15, curY));

            ctx.lineTo(curX, curY);
        }
        ctx.stroke();
    }
    ctx.restore();
}

// Utility function to draw rounded rectangles
function drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

// Selection states for characters (default values)
let p1SelectedChar = 'capybara';
let p2SelectedChar = 'otter';
let gameMode = 'pvp'; // 'pvp' or 'pve'
let aiDifficulty = 'normal'; // 'easy', 'normal', 'hard'

// Instantiate players
// Place Player 1 on the left side of platform, Player 2 on the right
let player1 = new Player(250, 250, 1, 'capybara');
let player2 = new Player(720, 250, 2, 'otter');

// --- Camera Shake Setup ---
function triggerCameraShake(time, intensity) {
    shakeTime = time;
    shakeIntensity = intensity;
}

function updateCameraShake(dt) {
    if (shakeTime > 0) {
        shakeTime = Math.max(0, shakeTime - dt);
    }
}

// --- Drawing Environment / Grass Meadow background ---
function drawEnvironment(ctx) {
    if (selectedMap === 'colosseum') {
        if (colosseumBgReady && colosseumBgImage.width > 0) {
            ctx.drawImage(colosseumBgImage, 0, 0, canvas.width, canvas.height);
        } else {
            ctx.fillStyle = '#ffe0b2';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
    } else if (selectedMap === 'dojo') {
        if (dojoBgReady && dojoBgImage.width > 0) {
            // Draw Dojo image keeping its aspect ratio (object-fit: cover)
            const imgRatio = dojoBgImage.width / dojoBgImage.height;
            const canvasRatio = canvas.width / canvas.height;
            let sx, sy, sw, sh;
            if (imgRatio > canvasRatio) {
                // Image is wider than canvas ratio: crop left and right
                sh = dojoBgImage.height;
                sw = sh * canvasRatio;
                sx = (dojoBgImage.width - sw) / 2;
                sy = 0;
            } else {
                // Image is taller than canvas ratio: crop top and bottom
                sw = dojoBgImage.width;
                sh = sw / canvasRatio;
                sx = 0;
                
                // Center vertically by default
                const centeredSy = (dojoBgImage.height - sh) / 2;
                // Shift the background image content UP by 35px on the canvas (lowered by 15px from previous 50px).
                // This corresponds to shifting the crop source window DOWN by 35 * (sh / canvas.height) in source pixels.
                const sourceShiftY = 35 * (sh / canvas.height);
                sy = Math.max(0, Math.min(dojoBgImage.height - sh, centeredSy + sourceShiftY));
            }
            ctx.drawImage(dojoBgImage, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        } else {
            ctx.fillStyle = '#d7ccc8';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
    } else {
        if (bgReady && bgImage.width > 0) {
            // Prevent horizontal stretching by cropping the 1024x1024 image to 1024x576 (16:9).
            // The dirt road is at Y=670 in the source image. We crop from Y=290 to place the road at Y=380.
            const sw = bgImage.width;
            const sh = bgImage.width * (canvas.height / canvas.width); // 576
            const sx = 0;
            const sy = 290; 
            ctx.drawImage(bgImage, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        } else {
        // Fallback: 1. Draw Sky Gradient
        const skyGrad = ctx.createLinearGradient(0, 0, 0, 390);
        skyGrad.addColorStop(0, '#74b9ff'); // Sky Blue
        skyGrad.addColorStop(0.6, '#a1e3f9'); // Soft Light Blue
        skyGrad.addColorStop(1, '#ffeaa7'); // Soft Horizon Yellow
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, canvas.width, 390);

        // 2. Draw Sun
        ctx.save();
        ctx.shadowBlur = 40;
        ctx.shadowColor = '#fff9d6';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(850, 80, 50, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 3. Draw Distant Hills (Layer 1 - Far)
        ctx.fillStyle = '#81c784'; // Soft light green
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(0, 390);
        ctx.quadraticCurveTo(200, 310, 500, 390);
        ctx.quadraticCurveTo(800, 300, 1024, 390);
        ctx.lineTo(1024, 390);
        ctx.lineTo(0, 390);
        ctx.fill();
        ctx.globalAlpha = 1.0;

        // 4. Draw Mid Hills (Layer 2 - Mid)
        ctx.fillStyle = '#66bb6a'; // Medium green
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(0, 390);
        ctx.quadraticCurveTo(300, 340, 600, 390);
        ctx.quadraticCurveTo(850, 320, 1024, 390);
        ctx.lineTo(1024, 390);
        ctx.lineTo(0, 390);
        ctx.fill();
        ctx.globalAlpha = 1.0;

        // 5. Draw Near Hills (Layer 3 - Near)
        ctx.fillStyle = '#4caf50'; // Darker warm green
        ctx.beginPath();
        ctx.moveTo(0, 390);
        ctx.quadraticCurveTo(150, 360, 400, 390);
        ctx.quadraticCurveTo(700, 350, 1024, 390);
        ctx.lineTo(1024, 390);
        ctx.lineTo(0, 390);
        ctx.fill();

        // 6. Draw Main Ground (Meadow floor)
        const groundGrad = ctx.createLinearGradient(0, 390, 0, canvas.height);
        groundGrad.addColorStop(0, '#388e3c'); // Rich top grass green
        groundGrad.addColorStop(0.2, '#2e7d32'); // Middle grass green
        groundGrad.addColorStop(1, '#1b5e20'); // Deep forest green at bottom
        ctx.fillStyle = groundGrad;
        ctx.fillRect(0, 390, canvas.width, canvas.height - 390);

        // 7. Draw Grass Blades / Flowers details on the horizon and ground
        ctx.strokeStyle = '#4caf50';
        ctx.lineWidth = 2;
        for (let lx = 10; lx < canvas.width; lx += 30) {
            // Draw small grass tufts along the ground surface (Y = 390)
            ctx.beginPath();
            ctx.moveTo(lx, 390);
            ctx.lineTo(lx - 3, 382);
            ctx.moveTo(lx, 390);
            ctx.lineTo(lx, 380);
            ctx.moveTo(lx, 390);
            ctx.lineTo(lx + 3, 383);
            ctx.stroke();
        }

        // Draw some yellow and white dots as flowers on the ground
        for (let i = 0; i < 40; i++) {
            const fx = (i * 27) % canvas.width;
            const fy = 395 + ((i * 13) % (canvas.height - 400));
            ctx.fillStyle = i % 2 === 0 ? '#fffb00' : '#ffffff'; // yellow or white
            ctx.beginPath();
            ctx.arc(fx, fy, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}
}

// --- Drawing Floating Platforms (Floor 2) ---
function drawPlatforms(ctx) {
    platforms.forEach(plat => {
        if (plat.isGround) return; // Main ground is drawn as part of background
        
        ctx.save();
        if (selectedMap === 'colosseum') {
            if (colosseumLeftReady && colosseumMidReady && colosseumRightReady) {
                const tSize = 45; // Render size for each tile in Colosseum
                const offset = 8; // Offset to match the top surface of the stone tile with physical plat.y
                // 1. Draw Left End
                ctx.drawImage(colosseumLeftImg, plat.x, plat.y - offset, tSize, tSize);
                
                // 2. Draw Right End
                ctx.drawImage(colosseumRightImg, plat.x + plat.width - tSize, plat.y - offset, tSize, tSize);
                
                // 3. Draw Middle tiles
                const midStartX = plat.x + tSize;
                const midEndX = plat.x + plat.width - tSize;
                let currentX = midStartX;
                while (currentX < midEndX) {
                    const drawW = Math.min(tSize, midEndX - currentX);
                    const srcW = colosseumMidImg.width * (drawW / tSize);
                    ctx.drawImage(colosseumMidImg, 0, 0, srcW, colosseumMidImg.height, currentX, plat.y - offset, drawW, tSize);
                    currentX += drawW;
                }
            } else {
                // Fallback: Ancient Roman stone sandstone platform style
                ctx.fillStyle = '#a1887f'; // Warm sandy stone grey-brown
                drawRoundedRect(ctx, plat.x, plat.y, plat.width, 45, 4);
                ctx.fill();
                
                // Dark terracotta/earth border
                ctx.strokeStyle = '#4e342e';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        } else {
            // Meadow style (grass tiles)
            if (grassLeftReady && grassMidReady && grassRightReady) {
                const tSize = 40; // Render size for each tile
                // 1. Draw Left End
                ctx.drawImage(grassLeftImg, plat.x, plat.y, tSize, tSize);
                
                // 2. Draw Right End
                ctx.drawImage(grassRightImg, plat.x + plat.width - tSize, plat.y, tSize, tSize);
                
                // 3. Draw Middle tiles
                const midStartX = plat.x + tSize;
                const midEndX = plat.x + plat.width - tSize;
                let currentX = midStartX;
                while (currentX < midEndX) {
                    const drawW = Math.min(tSize, midEndX - currentX);
                    const srcW = grassMidImg.width * (drawW / tSize);
                    ctx.drawImage(grassMidImg, 0, 0, srcW, grassMidImg.height, currentX, plat.y, drawW, tSize);
                    currentX += drawW;
                }
            } else {
                // Fallback: Meadow style (default green)
                ctx.fillStyle = '#4caf50'; // Flat grass green
                drawRoundedRect(ctx, plat.x, plat.y, plat.width, 40, 4);
                ctx.fill();
                
                // Dark green border
                ctx.strokeStyle = '#2e7d32';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }
        ctx.restore();
    });
}

// --- Collision logic for Projectiles ---
function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const proj = projectiles[i];
        proj.update(dt);

        if (!proj.active) {
            projectiles.splice(i, 1);
            continue;
        }

        // Collision check with players
        const target = proj.ownerId === 1 ? player2 : player1;

        // Check if Owl's windstorm blocks/destroys Otter's special wave projectile
        if (proj.ownerCharacterType === 'otter' && proj.isSpecial && target.characterType === 'owl' && target.specialActiveFrames > 0) {
            const owlCenterX = target.x + target.width / 2;
            const owlCenterY = target.y + target.height / 2;
            const dx = proj.x - owlCenterX;
            const dy = proj.y - owlCenterY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const windstormRadius = 200;
            
            if (dist < windstormRadius + proj.hitboxRadius) {
                proj.active = false;
                // Spawn mint-colored spark particles to indicate blocking
                spawnHitParticles(proj.x, proj.y, '#3cdcd0', 15);
                playSound('hit');
                projectiles.splice(i, 1);
                continue;
            }
        }
        
        // Simple circle to AABB bounding box collision
        // Find closest point on target bounding box to circle center
        const closestX = Math.max(target.x, Math.min(proj.x, target.x + target.width));
        const closestY = Math.max(target.y, Math.min(proj.y, target.y + target.height));
        
        const distanceX = proj.x - closestX;
        const distanceY = proj.y - closestY;
        const distanceSq = (distanceX * distanceX) + (distanceY * distanceY);

        if (distanceSq < proj.hitboxRadius * proj.hitboxRadius) {
            // Collision detected!
            proj.active = false;
            
            // Check for Owl multi-hit prevention within the same attack burst
            let dealDamage = true;
            if (proj.ownerCharacterType === 'owl' && !proj.isSpecial && proj.groupId !== null) {
                if (target.lastHitOwlGroupId === proj.groupId) {
                    dealDamage = false;
                } else {
                    target.lastHitOwlGroupId = proj.groupId;
                }
            }

            if (dealDamage) {
                let kbx = Math.sign(proj.vx) * proj.kbx;
                let kby = proj.kby;
                let hitstun = proj.hitstun;

                // Capybara's special dash has super armor against Owl's normal attack (feather projectiles)
                if (target.characterType === 'capybara' && target.specialActiveFrames > 0 && proj.ownerCharacterType === 'owl' && !proj.isSpecial) {
                    kbx = 0;
                    kby = 0;
                    hitstun = 0;
                }

                target.takeDamage(proj.damage, kbx, kby, hitstun);
                
                // Otter's wave kick blocks and cancels Capybara's dash
                if (target.characterType === 'capybara' && target.specialActiveFrames > 0 && proj.ownerCharacterType === 'otter' && proj.isSpecial) {
                    target.specialActiveFrames = 0; // Cancel dash
                }

                // Play sound based on projectile type
                playSound(proj.isSpecial ? 'p2SpecialHit' : 'hit');
                
                // Spawn hit sparks (fewer sparks for normal feather)
                spawnHitParticles(proj.x, proj.y, proj.color, proj.isSpecial ? 24 : 10);
                
                // Screen Shake (weaker shake for normal feather)
                triggerCameraShake(proj.isSpecial ? 20 : 8, proj.isSpecial ? 10 : 3);
            } else {
                // Secondary hits just disappear with minor spark effects, no damage/knockback/impact sound
                spawnHitParticles(proj.x, proj.y, proj.color, 3);
            }
            
            // Remove projectile
            projectiles.splice(i, 1);
        }
    }
}

// --- HUD State Update ---
const p1HpBar = document.getElementById('p1-hp-bar');
const p1HpGhost = document.getElementById('p1-hp-ghost');
const p1HpText = document.getElementById('p1-hp-text');
const p1CooldownOverlay = document.getElementById('p1-cooldown-overlay');
const p1CooldownBar = document.getElementById('p1-cooldown-bar');

const p2HpBar = document.getElementById('p2-hp-bar');
const p2HpGhost = document.getElementById('p2-hp-ghost');
const p2HpText = document.getElementById('p2-hp-text');
const p2CooldownOverlay = document.getElementById('p2-cooldown-overlay');
const p2CooldownBar = document.getElementById('p2-cooldown-bar');

function updateHUD() {
    // 1P HP Bar
    const p1HpPercent = (player1.hp / player1.maxHp) * 100;
    p1HpBar.style.width = `${p1HpPercent}%`;
    p1HpText.textContent = `${player1.hp} / ${player1.maxHp}`;
    setTimeout(() => {
        p1HpGhost.style.width = `${p1HpPercent}%`;
    }, 200);

    // 2P HP Bar
    const p2HpPercent = (player2.hp / player2.maxHp) * 100;
    p2HpBar.style.width = `${p2HpPercent}%`;
    p2HpText.textContent = `${player2.hp} / ${player2.maxHp}`;
    setTimeout(() => {
        p2HpGhost.style.width = `${p2HpPercent}%`;
    }, 200);

    // 1P Special Cooldown (G)
    let p1SpecialPercent;
    if (player1.characterType === 'quokka') {
        if (player1.specialActiveFrames > 0) {
            p1SpecialPercent = 100 - (player1.specialActiveFrames / player1.maxSpecialActive) * 100;
        } else {
            p1SpecialPercent = (player1.specialCooldown / player1.specialMaxCooldown) * 100;
        }
    } else {
        p1SpecialPercent = (player1.specialCooldown / player1.specialMaxCooldown) * 100;
    }
    p1CooldownOverlay.style.height = `${p1SpecialPercent}%`;
    p1CooldownBar.style.width = `${100 - p1SpecialPercent}%`;

    // 2P Special Cooldown (])
    let p2SpecialPercent;
    if (player2.characterType === 'quokka') {
        if (player2.specialActiveFrames > 0) {
            p2SpecialPercent = 100 - (player2.specialActiveFrames / player2.maxSpecialActive) * 100;
        } else {
            p2SpecialPercent = (player2.specialCooldown / player2.specialMaxCooldown) * 100;
        }
    } else {
        p2SpecialPercent = (player2.specialCooldown / player2.specialMaxCooldown) * 100;
    }
    p2CooldownOverlay.style.height = `${p2SpecialPercent}%`;
    p2CooldownBar.style.width = `${100 - p2SpecialPercent}%`;
}

// --- Main Game Loop ---
let lastTime = 0;
let globalFrameCount = 0;

function gameLoop(timestamp) {
    if (!gameStarted) return;
    globalFrameCount++;

    if (!timestamp) {
        requestAnimationFrame(gameLoop);
        return;
    }
    if (!lastTime) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 6.944; // 144 FPS standard (1 frame ~ 6.94ms)
    dt = Math.min(dt, 4.0); // Prevent massive jumps
    lastTime = timestamp;

    // Clear Canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Camera Shake translation
    ctx.save();
    if (shakeTime > 0) {
        const dx = (Math.random() - 0.5) * shakeIntensity;
        const dy = (Math.random() - 0.5) * shakeIntensity;
        ctx.translate(dx, dy);
    }

    // 1. Draw static grid environment & platforms
    drawEnvironment(ctx);
    drawPlatforms(ctx);

    // 2. Update and draw projectiles
    updateProjectiles(dt);
    projectiles.forEach(p => p.draw(ctx));

    // 3. Update & Draw Players
    if (!gameOver) {
        player1.update(dt, player2);
        player2.update(dt, player1);
        
        // Apply Entity Interpolation (Jitter Buffer) for network opponent to ensure perfectly smooth movement
        if (socket && myRole) {
            let opponentP = myRole === 'Player1' ? player2 : player1;
            if (opponentP && opponentP.positionBuffer && opponentP.positionBuffer.length > 0) {
                const prevX = opponentP.x;
                const prevY = opponentP.y;
                
                // 45ms jitter buffer (approx 2.5 frames at 60Hz tick rate)
                const renderTime = performance.now() - 45;
                
                let pastState = null;
                let futureState = null;
                
                // Find bounding states
                for (let i = opponentP.positionBuffer.length - 1; i >= 0; i--) {
                    if (opponentP.positionBuffer[i].time <= renderTime) {
                        pastState = opponentP.positionBuffer[i];
                        if (i + 1 < opponentP.positionBuffer.length) {
                            futureState = opponentP.positionBuffer[i + 1];
                        }
                        break;
                    }
                }
                
                if (pastState && futureState) {
                    // Interpolate between past and future
                    const t = (renderTime - pastState.time) / (futureState.time - pastState.time);
                    opponentP.x = pastState.x + (futureState.x - pastState.x) * t;
                    opponentP.y = pastState.y + (futureState.y - pastState.y) * t;
                    
                    if (!opponentP.isAttacking && !opponentP.isDashing) {
                        opponentP.dir = pastState.dir;
                    }
                } else if (pastState) {
                    // Render time is newer than anything we have (starvation)
                    opponentP.x = pastState.x;
                    opponentP.y = pastState.y;
                    if (!opponentP.isAttacking && !opponentP.isDashing) {
                        opponentP.dir = pastState.dir;
                    }
                } else {
                    // Render time is older than the oldest state (happens at very start)
                    const oldestState = opponentP.positionBuffer[0];
                    opponentP.x = oldestState.x;
                    opponentP.y = oldestState.y;
                    if (!opponentP.isAttacking && !opponentP.isDashing) {
                        opponentP.dir = oldestState.dir;
                    }
                }
                
                // Back-calculate velocity to keep physics engine/animation logic synchronized
                if (dt > 0) {
                    opponentP.vx = (opponentP.x - prevX) / dt;
                    opponentP.vy = (opponentP.y - prevY) / dt;
                }
            }
        }
        
        // Simple Player-Player push collision (prevent overlapping completely)
        checkPlayerOverlapCollision();
    }
    
    player1.draw(ctx);
    player2.draw(ctx);

    // 4. Update and draw particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.update(dt);
        p.draw(ctx);
        if (p.life <= 0) {
            particles.splice(i, 1);
        }
    }

    ctx.restore();

    // 5. Update Screen HUD (HP values, cooldown bars)
    updateHUD();

    // 6. Check Game Over / Death conditions
    checkGameOver();

    // 7. Update camera shake timer
    updateCameraShake(dt);

    // 8. Sync state with server periodically (60Hz)
    const now = performance.now();
    if (now - lastStateEmitTime >= 16.6 && socket && myRole) {
        lastStateEmitTime = now;
        let myP = myRole === 'Player1' ? player1 : player2;
        if (myP) {
            socket.emit('playerStateUpdate', {
                role: myRole,
                x: myP.x,
                y: myP.y,
                hp: myP.hp,
                dir: myP.dir
            });
        }
    }

    requestAnimationFrame(gameLoop);
}

// Pushes players apart if they are colliding (prevents passing through each other easily)
function checkPlayerOverlapCollision() {
    // Intersect check
    if (
        player1.x < player2.x + player2.width &&
        player1.x + player1.width > player2.x &&
        player1.y < player2.y + player2.height &&
        player1.y + player1.height > player2.y
    ) {
        // Calculate overlap along x-axis
        const overlapX1 = (player1.x + player1.width) - player2.x;
        const overlapX2 = (player2.x + player2.width) - player1.x;
        
        // Push in the direction of smaller overlap
        if (overlapX1 < overlapX2) {
            // Push player 1 left, player 2 right
            player1.x -= overlapX1 / 2;
            player2.x += overlapX1 / 2;
            
            // Exchange minor momentum
            const tempVx = player1.vx;
            player1.vx = Math.min(player1.vx, -0.5);
            player2.vx = Math.max(player2.vx, 0.5);
        } else {
            // Push player 1 right, player 2 left
            player1.x += overlapX2 / 2;
            player2.x -= overlapX2 / 2;
            
            // Exchange minor momentum
            player1.vx = Math.max(player1.vx, 0.5);
            player2.vx = Math.min(player2.vx, -0.5);
        }
    }
}

function checkGameOver() {
    if (gameOver) return;

    const p1Dead = player1.hp <= 0;
    const p2Dead = player2.hp <= 0;

    if (p1Dead || p2Dead) {
        gameOver = true;
        
        if (p1Dead && p2Dead) {
            // Mutual death (rare, e.g. projectile trade)
            winnerId = 0; // Draw
            showGameOverOverlay(0);
        } else if (p1Dead) {
            winnerId = 2; // P2 Wins
            showGameOverOverlay(2);
        } else if (p2Dead) {
            winnerId = 1; // P1 Wins
            showGameOverOverlay(1);
        }
        
        // Broadcast game over to ensure both clients end the match with the same result
        if (gameMode === 'online' && socket && myRole) {
            socket.emit('gameOverSync', { winnerId: winnerId });
        }
    }
}

// --- Overlay Control & Character Selection ---
const startOverlay = document.getElementById('start-overlay');
const gameoverOverlay = document.getElementById('gameover-overlay');
const restartBtn = document.getElementById('restart-btn');
const selectCharBtn = document.getElementById('select-char-btn');
const backToMenuBtn = document.getElementById('back-to-menu-btn');
const bgmMuteBtn = document.getElementById('bgm-mute-btn');
const totalMuteBtn = document.getElementById('total-mute-btn');

const titleScreen = document.getElementById('title-screen');
const charSelectScreen = document.getElementById('char-select-screen');
const charSelectBackBtn = document.getElementById('char-select-back-btn');
const pvpStartBtn = document.getElementById('pvp-start-btn');
const pveStartBtn = document.getElementById('pve-start-btn');
const onlineStartBtn = document.getElementById('online-start-btn');

function updateSpecialDescText(playerNum, charType) {
    const specDesc = document.getElementById(`p${playerNum}-special-desc`);
    if (!specDesc) return;
    
    let text = ": ???";
    if (charType === 'capybara') text = ": 돌진";
    else if (charType === 'otter') text = ": 파도발차기";
    else if (charType === 'owl') text = ": 돌풍";
    else if (charType === 'quokka') text = ": 전광석화";
    
    specDesc.textContent = text;
}

function updateControlsGuideUI() {
    const p1KeyList = document.getElementById('p1-key-list');
    const p2KeyList = document.getElementById('p2-key-list');
    
    if (!p1KeyList || !p2KeyList) return;
    
    if (gameMode === 'pvp') {
        p1KeyList.style.display = 'block';
        p2KeyList.style.display = 'block';
        p1KeyList.innerHTML = `
            <li><span class="key">W</span><span class="key">A</span><span class="key">S</span><span class="key">D</span><span class="key-desc">: 이동</span></li>
            <li><span class="key">F</span><span class="key-desc">: 일반 공격</span></li>
            <li><span class="key">G</span><span class="key-desc" id="p1-special-desc">: 돌진</span></li>
        `;
        p2KeyList.innerHTML = `
            <li><span class="key">▲</span><span class="key">▼</span><span class="key">◀</span><span class="key">▶</span><span class="key-desc">: 이동</span></li>
            <li><span class="key">[</span><span class="key-desc">: 일반 공격</span></li>
            <li><span class="key">]</span><span class="key-desc" id="p2-special-desc">: 파도발차기</span></li>
        `;
    } else if (gameMode === 'pve') {
        p1KeyList.style.display = 'block';
        p2KeyList.style.display = 'none'; // Hide Computer controls guide
        p1KeyList.innerHTML = `
            <li><span class="key">▲</span><span class="key">▼</span><span class="key">◀</span><span class="key">▶</span><span class="key-desc">: 이동</span></li>
            <li><span class="key">A</span><span class="key-desc">: 일반 공격</span></li>
            <li><span class="key">S</span><span class="key-desc" id="p1-special-desc">: 돌진</span></li>
        `;
    } else if (gameMode === 'online') {
        if (myRole === 'Player1') {
            p1KeyList.style.display = 'block';
            p2KeyList.style.display = 'none'; // Hide opponent's controls guide
            p1KeyList.innerHTML = `
                <li><span class="key">▲</span><span class="key">▼</span><span class="key">◀</span><span class="key">▶</span><span class="key-desc">: 이동</span></li>
                <li><span class="key">A</span><span class="key-desc">: 일반 공격</span></li>
                <li><span class="key">S</span><span class="key-desc" id="p1-special-desc">: 돌진</span></li>
            `;
        } else if (myRole === 'Player2') {
            p1KeyList.style.display = 'none'; // Hide opponent's controls guide
            p2KeyList.style.display = 'block';
            p2KeyList.innerHTML = `
                <li><span class="key">▲</span><span class="key">▼</span><span class="key">◀</span><span class="key">▶</span><span class="key-desc">: 이동</span></li>
                <li><span class="key">A</span><span class="key-desc">: 일반 공격</span></li>
                <li><span class="key">S</span><span class="key-desc" id="p2-special-desc">: 파도발차기</span></li>
            `;
        } else {
            p1KeyList.style.display = 'none';
            p2KeyList.style.display = 'none';
        }
    }
    
    updateSpecialDescText(1, p1SelectedChar);
    updateSpecialDescText(2, p2SelectedChar);
}

function enterCharSelectScreen() {
    titleScreen.classList.remove('active');
    charSelectScreen.classList.add('active');
    updateControlsGuideUI(); // Dynamically update control UI based on mode/role
    drawAllPreviews(); // Draw previews when selection screen opens
    
    // Make mute buttons visible on character select screen
    bgmMuteBtn.classList.add('active');
    totalMuteBtn.classList.add('active');
    
    // Start playing select screen BGM
    selectBgmAudio.currentTime = 0;
    selectBgmAudio.play().catch(err => console.error('Select BGM play failed:', err));
}

if (charSelectBackBtn) {
    charSelectBackBtn.addEventListener('click', () => {
        charSelectBackBtn.blur();
        charSelectScreen.classList.remove('active');
        titleScreen.classList.add('active');
        
        // Hide mute buttons on the title screen
        bgmMuteBtn.classList.remove('active');
        totalMuteBtn.classList.remove('active');
        
        // Stop playing select screen BGM
        selectBgmAudio.pause();
        selectBgmAudio.currentTime = 0;
    });
}

if (pvpStartBtn) {
    pvpStartBtn.addEventListener('click', () => {
        pvpStartBtn.blur();
        gameMode = 'pvp';
        document.getElementById('difficulty-select-container').style.display = 'none';
        document.getElementById('p2-panel-title').textContent = 'PLAYER 2 (OTTER)';
        document.getElementById('p2-preview-label').textContent = 'PLAYER 2';
        document.getElementById('battle-btn').textContent = "FIGHT!";
        enterCharSelectScreen();
    });
}

if (pveStartBtn) {
    pveStartBtn.addEventListener('click', () => {
        pveStartBtn.blur();
        gameMode = 'pve';
        document.getElementById('difficulty-select-container').style.display = 'block';
        document.getElementById('p2-panel-title').textContent = 'COMPUTER (AI)';
        document.getElementById('p2-preview-label').textContent = 'COMPUTER';
        document.getElementById('battle-btn').textContent = "FIGHT!";
        enterCharSelectScreen();
    });
}

if (onlineStartBtn) {
    onlineStartBtn.addEventListener('click', () => {
        if (onlineStartBtn.disabled) return;
        onlineStartBtn.blur();
        gameMode = 'online';
        document.getElementById('difficulty-select-container').style.display = 'none';
        
        onlineStartBtn.textContent = 'CONNECTING...';
        onlineStartBtn.disabled = true;
        
        initSocket();
    });
}

// Initialize Server URL configuration on page load
const serverUrlInput = document.getElementById('server-url-input');
if (serverUrlInput) {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocal) {
        serverUrlInput.value = 'http://localhost:3000';
        serverUrlInput.disabled = true;
        serverUrlInput.style.opacity = '0.6';
        serverUrlInput.title = '로컬 환경에서는 주소를 설정할 수 없습니다.';
    } else {
        const savedUrl = localStorage.getItem('capy_server_url') || DEFAULT_SERVER_URL;
        serverUrlInput.value = savedUrl;
        
        serverUrlInput.addEventListener('input', () => {
            localStorage.setItem('capy_server_url', serverUrlInput.value.trim());
        });
    }
}

const p1Selector = document.getElementById('p1-char-selector');
const p2Selector = document.getElementById('p2-char-selector');

// Character Selection Handlers
p1Selector.addEventListener('click', (e) => {
    if (gameMode === 'online' && myRole !== 'Player1' && myRole !== 'Spectator') return; // Only P1 can change P1
    if (e.target.classList.contains('char-btn')) {
        p1Selector.querySelectorAll('.char-btn').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        p1SelectedChar = e.target.getAttribute('data-char');
        if (socket && gameMode === 'online') socket.emit('charSelected', p1SelectedChar);
        
        // Update Panel UI and Key Labels
        const title = document.getElementById('p1-panel-title');
        const specDesc = document.getElementById('p1-special-desc');
        if (p1SelectedChar === 'capybara') {
            title.textContent = "PLAYER 1 (CAPYBARA)";
            title.className = "panel-title red-theme";
            specDesc.textContent = ": 돌진";
        } else if (p1SelectedChar === 'otter') {
            title.textContent = "PLAYER 1 (OTTER)";
            title.className = "panel-title blue-theme";
            specDesc.textContent = ": 파도발차기";
        } else if (p1SelectedChar === 'owl') {
            title.textContent = "PLAYER 1 (OWL)";
            title.className = "panel-title mint-theme";
            specDesc.textContent = ": 돌풍";
        } else if (p1SelectedChar === 'quokka') {
            title.textContent = "PLAYER 1 (QUOKKA)";
            title.className = "panel-title quokka-theme";
            specDesc.textContent = ": 전광석화";
        } else if (p1SelectedChar === 'random') {
            title.textContent = "PLAYER 1 (RANDOM)";
            title.className = "panel-title";
            specDesc.textContent = ": ???";
        }
        drawPreview(1, p1SelectedChar); // Update P1 preview image
    }
});

p2Selector.addEventListener('click', (e) => {
    if (gameMode === 'online' && myRole !== 'Player2' && myRole !== 'Spectator') return; // Only P2 can change P2
    if (e.target.classList.contains('char-btn')) {
        p2Selector.querySelectorAll('.char-btn').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        p2SelectedChar = e.target.getAttribute('data-char');
        if (socket && gameMode === 'online') socket.emit('charSelected', p2SelectedChar);
        
        // Update Panel UI and Key Labels
        const title = document.getElementById('p2-panel-title');
        const specDesc = document.getElementById('p2-special-desc');
        if (p2SelectedChar === 'capybara') {
            title.textContent = "PLAYER 2 (CAPYBARA)";
            title.className = "panel-title red-theme";
            specDesc.textContent = ": 돌진";
        } else if (p2SelectedChar === 'otter') {
            title.textContent = "PLAYER 2 (OTTER)";
            title.className = "panel-title blue-theme";
            specDesc.textContent = ": 파도발차기";
        } else if (p2SelectedChar === 'owl') {
            title.textContent = "PLAYER 2 (OWL)";
            title.className = "panel-title mint-theme";
            specDesc.textContent = ": 돌풍";
        } else if (p2SelectedChar === 'quokka') {
            title.textContent = "PLAYER 2 (QUOKKA)";
            title.className = "panel-title quokka-theme";
            specDesc.textContent = ": 전광석화";
        } else if (p2SelectedChar === 'random') {
            title.textContent = "PLAYER 2 (RANDOM)";
            title.className = "panel-title";
            specDesc.textContent = ": ???";
        }
        drawPreview(2, p2SelectedChar); // Update P2 preview image
    }
});

// Character Previews Drawing Logic
function drawAllPreviews() {
    drawPreview(1, p1SelectedChar);
    drawPreview(2, p2SelectedChar);
}

function updatePreviewTheme(pNum, charType) {
    const label = document.getElementById(pNum === 1 ? 'p1-preview-label' : 'p2-preview-label');
    const box = document.getElementById(pNum === 1 ? 'p1-preview-box' : 'p2-preview-box');
    if (!label || !box) return;

    label.classList.remove('p1-text', 'p2-text', 'p3-text', 'quokka-text', 'white-text', 'capybara-text', 'otter-text', 'owl-text');
    box.classList.remove('capybara-theme', 'otter-theme', 'owl-theme', 'quokka-theme', 'random-theme');

    if (charType === 'capybara') {
        label.classList.add('capybara-text');
        box.classList.add('capybara-theme');
    } else if (charType === 'otter') {
        label.classList.add('otter-text');
        box.classList.add('otter-theme');
    } else if (charType === 'owl') {
        label.classList.add('owl-text');
        box.classList.add('owl-theme');
    } else if (charType === 'quokka') {
        label.classList.add('quokka-text');
        box.classList.add('quokka-theme');
    } else if (charType === 'random') {
        label.classList.add('white-text');
        box.classList.add('random-theme');
    }
}

function drawPreview(pNum, charType) {
    updatePreviewTheme(pNum, charType);
    
    const canvasId = pNum === 1 ? 'p1-preview-canvas' : 'p2-preview-canvas';
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (charType === 'random') {
        // Draw a giant neon "?" in the center of the preview
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 72px "Press Start 2P", monospace';
        
        const color = '#ffffff'; // White for both P1 and P2 random selection
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 15;
        
        ctx.fillText('?', canvas.width / 2, canvas.height / 2);
        ctx.restore();
        return;
    }
    
    let img = null;
    let ready = false;
    if (charType === 'capybara') {
        img = p1SpriteSheet;
        ready = p1Ready || p1SpriteSheet.complete;
    } else if (charType === 'otter') {
        img = p2SpriteSheet;
        ready = p2Ready || p2SpriteSheet.complete;
    } else if (charType === 'owl') {
        img = p3SpriteSheet;
        ready = p3Ready || p3SpriteSheet.complete;
    } else if (charType === 'quokka') {
        img = p4SpriteSheet;
        ready = p4Ready || p4SpriteSheet.complete;
    }
    
    if (img && ready && img.width > 0) {
        const totalFrames = charType === 'quokka' ? 5 : 4;
        const frameWidth = img.width / totalFrames;
        const frameHeight = img.height;
        const sx = (charType === 'quokka' ? 3 : 2) * frameWidth; // Quokka: 4th frame (index 3 - right-hand attack), Others: 3rd frame (index 2)
        const sy = 0;
        
        ctx.save();
        if (pNum === 2) {
            // Flip Player 2 horizontally so they face Player 1
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
        }
        
        // Draw the character
        ctx.drawImage(img, sx, sy, frameWidth, frameHeight, 0, 0, canvas.width, canvas.height);
        ctx.restore();
    }
}

// AI Difficulty Selection Control
const diffButtons = document.querySelectorAll('.diff-btn');
diffButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        diffButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        aiDifficulty = btn.dataset.diff;
    });
});

// Map Selection Control
let selectedMap = 'meadow'; // Default map
const mapButtons = document.querySelectorAll('.map-btn');
mapButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        if (gameMode === 'online' && myRole !== 'Player1' && myRole !== 'Spectator') return; // Only P1 can change map
        mapButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedMap = btn.dataset.map;
        
        if (socket && gameMode === 'online') socket.emit('mapSelected', selectedMap);
        
        // Update wrapper background and footer text dynamically based on selection
        const wrapper = document.getElementById('canvas-wrapper');
        const mapDesc = document.getElementById('map-desc');
        
        // Update physical ground y coordinate instantly on map selection
        if (selectedMap === 'colosseum') {
            platforms[0].y = 500;
            platforms[0].height = 76;
            platforms[1] = { x: 138, y: 330, width: 270, height: 15, isGround: false }; // Left 2nd Floor Y=330 (Width increased to 270px)
            platforms[2] = { x: 616, y: 330, width: 270, height: 15, isGround: false }; // Right 2nd Floor Y=330 (Width increased to 270px)
            platforms[3] = { x: 132, y: 160, width: 760, height: 15, isGround: false }; // 3rd Floor Y=160 (Doubled width 760)
            if (wrapper) wrapper.style.backgroundImage = "url('image/map/colosseum_bg.png')";
            if (mapDesc) mapDesc.textContent = "Battle in the grand Roman Colosseum. Knock your opponent to the screen borders!";
        } else if (selectedMap === 'dojo') {
            platforms[0].y = 400;
            platforms[0].height = 176;
            if (platforms.length > 1) {
                platforms.splice(1); // Remove all elevated platforms
            }
            if (wrapper) wrapper.style.backgroundImage = "url('image/map/dojo.jpeg')";
            if (mapDesc) mapDesc.textContent = "Battle in the sparring arena. Knock your opponent to the screen borders!";
        } else if (selectedMap === 'random') {
            platforms[0].y = 380;
            platforms[0].height = 196;
            platforms[1] = { x: 287, y: 230, width: 450, height: 15, isGround: false }; // Restore Meadow 2nd Floor
            if (platforms.length > 2) {
                platforms.splice(2); // Remove 3rd Floor
            }
            if (wrapper) wrapper.style.backgroundImage = "linear-gradient(135deg, #151226 0%, #090812 100%)";
            if (mapDesc) mapDesc.textContent = "A random battlefield (Meadow, Colosseum, or Dojo) will be chosen once the fight starts!";
        } else {
            platforms[0].y = 380;
            platforms[0].height = 196;
            platforms[1] = { x: 287, y: 230, width: 450, height: 15, isGround: false }; // Restore Meadow 2nd Floor
            if (platforms.length > 2) {
                platforms.splice(2); // Remove 3rd Floor
            }
            if (wrapper) wrapper.style.backgroundImage = "url('image/map/meadow_bg_v4.png')";
            if (mapDesc) mapDesc.textContent = "Battle in the lush green fields. Knock your opponent to the screen borders!";
        }
    });
});

// battleBtn (FIGHT/READY) to start match and show HUD
const battleBtn = document.getElementById('battle-btn');
const hud = document.getElementById('hud');

battleBtn.addEventListener('click', () => {
    battleBtn.blur();
    if (socket && gameMode === 'online') {
        isReady = !isReady;
        battleBtn.textContent = isReady ? "WAITING..." : "READY";
        socket.emit('playerReady', isReady);
    } else {
        startGameLogic();
    }
});

function startGameLogic() {
    startOverlay.classList.remove('active');
    hud.classList.add('active'); // Reveal HUD
    backToMenuBtn.classList.add('active');
    bgmMuteBtn.classList.add('active');
    totalMuteBtn.classList.add('active');
    
    // Resolve random map choice right now and override selectedMap
    if (selectedMap === 'random') {
        const maps = ['meadow', 'colosseum', 'dojo'];
        if (gameMode === 'online' && serverRandomIndices) {
            selectedMap = maps[serverRandomIndices.map];
        } else {
            selectedMap = maps[Math.floor(Math.random() * maps.length)];
        }
    }
    
    // Ensure ground and platform coordinates are correctly synced on match start
    if (selectedMap === 'colosseum') {
        platforms[0].y = 500;
        platforms[0].height = 76;
        platforms[1] = { x: 138, y: 330, width: 270, height: 15, isGround: false };  // Left 2nd Floor Y=330
        platforms[2] = { x: 616, y: 330, width: 270, height: 15, isGround: false }; // Right 2nd Floor Y=330
        platforms[3] = { x: 132, y: 160, width: 760, height: 15, isGround: false }; // 3rd Floor Y=160
    } else if (selectedMap === 'dojo') {
        platforms[0].y = 400;
        platforms[0].height = 176;
        if (platforms.length > 1) {
            platforms.splice(1); // Remove all elevated platforms
        }
    } else {
        platforms[0].y = 380;
        platforms[0].height = 196;
        platforms[1] = { x: 287, y: 230, width: 450, height: 15, isGround: false }; // Restore Meadow 2nd Floor
        if (platforms.length > 2) {
            platforms.splice(2);
        }
    }
    
    // Update wrapper background image based on chosen selectedMap
    const wrapper = document.getElementById('canvas-wrapper');
    if (wrapper) {
        if (selectedMap === 'colosseum') {
            wrapper.style.backgroundImage = "url('image/map/colosseum_bg.png')";
        } else if (selectedMap === 'dojo') {
            wrapper.style.backgroundImage = "url('image/map/dojo.jpeg')";
        } else {
            wrapper.style.backgroundImage = "url('image/map/meadow_bg_v4.png')";
        }
    }
    
    if (!gameStarted) {
        // Resolve random characters right now and override selected variables
        if (p1SelectedChar === 'random') {
            const chars = ['capybara', 'otter', 'owl', 'quokka'];
            if (gameMode === 'online' && serverRandomIndices) {
                p1SelectedChar = chars[serverRandomIndices.p1];
            } else {
                p1SelectedChar = chars[Math.floor(Math.random() * chars.length)];
            }
        }
        if (p2SelectedChar === 'random') {
            const chars = ['capybara', 'otter', 'owl', 'quokka'];
            if (gameMode === 'online' && serverRandomIndices) {
                p2SelectedChar = chars[serverRandomIndices.p2];
            } else {
                p2SelectedChar = chars[Math.floor(Math.random() * chars.length)];
            }
        }

        // Re-initialize players with chosen character types
        player1 = new Player(250, 250, 1, p1SelectedChar);
        player2 = new Player(720, 250, 2, p2SelectedChar);
        player1.targetX = player1.x;
        player1.targetY = player1.y;
        player2.targetX = player2.x;
        player2.targetY = player2.y;
        
        // Update CSS variables for players' colors/glow
        const container = document.getElementById('game-container');
        container.style.setProperty('--p1-color', player1.color);
        container.style.setProperty('--p1-glow', `0 0 15px ${player1.color}99`);
        container.style.setProperty('--p2-color', player2.color);
        container.style.setProperty('--p2-glow', `0 0 15px ${player2.color}99`);

        const getKoreanName = (char) => {
            if (char === 'capybara') return '카피바라';
            if (char === 'otter') return '수달';
            if (char === 'owl') return '부엉이';
            if (char === 'quokka') return '쿼카';
            return '';
        };

        const getSkillName = (char) => {
            if (char === 'capybara') return '돌진';
            if (char === 'otter') return '파도발차기';
            if (char === 'owl') return '돌풍';
            if (char === 'quokka') return '전광석화';
            return '';
        };

        // Update HUD Names and Special skill names dynamically
        document.querySelector('#p1-hud .player-name').textContent = getKoreanName(p1SelectedChar);
        document.querySelector('#p1-hud .skill-name').textContent = getSkillName(p1SelectedChar);
        
        document.querySelector('#p2-hud .player-name').textContent = getKoreanName(p2SelectedChar);
        document.querySelector('#p2-hud .skill-name').textContent = getSkillName(p2SelectedChar);

        gameStarted = true;
        gameOver = false;
        lastTime = 0; // Initialize dt timer
        
        // Stop selection screen BGM
        selectBgmAudio.pause();
        selectBgmAudio.currentTime = 0;
        
        // Setup BGM source dynamically based on selected map
        let targetBgm = 'sound/bgm/meadow_bgm.mp3';
        if (selectedMap === 'colosseum') {
            targetBgm = 'sound/bgm/colosseum_bgm.mp3';
        } else if (selectedMap === 'dojo') {
            targetBgm = 'sound/bgm/dojo_bgm.mp3';
        }
        
        if (!bgmAudio.src.endsWith(targetBgm)) {
            bgmAudio.src = targetBgm;
            bgmAudio.load(); // Explicitly trigger load when changing source
        }
        
        // Adjust volume based on map selection (Meadow BGM volume increased by 20% from 0.17)
        if (selectedMap === 'colosseum' || selectedMap === 'dojo') {
            bgmAudio.volume = 0.17;
        } else {
            bgmAudio.volume = 0.204; // 0.17 * 1.2 = 0.204
        }
        bgmAudio.currentTime = 0;
        bgmAudio.play().catch(err => console.error('BGM play failed:', err));
        
        updateHUD(); // Sync HP and skill states immediately
        requestAnimationFrame(gameLoop);
    }
}

restartBtn.addEventListener('click', () => {
    restartBtn.blur();
    gameoverOverlay.classList.remove('active');
    backToMenuBtn.classList.add('active');
    bgmMuteBtn.classList.add('active');
    totalMuteBtn.classList.add('active');
    
    // Reset players, projectiles, particles
    player1.reset();
    player2.reset();
    projectiles = [];
    particles = [];
    gameOver = false;
    winnerId = null;
    lastTime = 0; // Initialize dt timer
    
    const victoryImg = document.getElementById('victory-img');
    if (victoryImg) {
        victoryImg.src = '';
        victoryImg.style.display = 'none';
    }
    
    // Clear HUD values immediately
    updateHUD();
});

function restoreSelectionVariables() {
    p1SelectedChar = p1Selector.querySelector('.char-btn.active').getAttribute('data-char');
    p2SelectedChar = p2Selector.querySelector('.char-btn.active').getAttribute('data-char');
    selectedMap = document.querySelector('.map-btn.active').getAttribute('data-map');
    
    // Draw all previews
    drawAllPreviews();
    
    // Play selection screen BGM again if it was paused
    selectBgmAudio.currentTime = 0;
    selectBgmAudio.play().catch(err => console.error('Select BGM play failed:', err));
    
    // Update map preview description and background
    const wrapper = document.getElementById('canvas-wrapper');
    const mapDesc = document.getElementById('map-desc');
    
    if (selectedMap === 'colosseum') {
        platforms[0].y = 500;
        platforms[0].height = 76;
        platforms[1] = { x: 138, y: 330, width: 270, height: 15, isGround: false };
        platforms[2] = { x: 616, y: 330, width: 270, height: 15, isGround: false };
        platforms[3] = { x: 132, y: 160, width: 760, height: 15, isGround: false };
        if (wrapper) wrapper.style.backgroundImage = "url('image/map/colosseum_bg.png')";
        if (mapDesc) mapDesc.textContent = "Battle in the grand Roman Colosseum. Knock your opponent to the screen borders!";
    } else if (selectedMap === 'dojo') {
        platforms[0].y = 400;
        platforms[0].height = 176;
        if (platforms.length > 1) {
            platforms.splice(1); // Remove all elevated platforms
        }
        if (wrapper) wrapper.style.backgroundImage = "url('image/map/dojo.jpeg')";
        if (mapDesc) mapDesc.textContent = "Battle in the sparring arena. Knock your opponent to the screen borders!";
    } else if (selectedMap === 'random') {
        platforms[0].y = 380;
        platforms[0].height = 196;
        platforms[1] = { x: 287, y: 230, width: 450, height: 15, isGround: false };
        if (platforms.length > 2) {
            platforms.splice(2);
        }
        if (wrapper) wrapper.style.backgroundImage = "linear-gradient(135deg, #151226 0%, #090812 100%)";
        if (mapDesc) mapDesc.textContent = "A random battlefield (Meadow, Colosseum, or Dojo) will be chosen once the fight starts!";
    } else {
        platforms[0].y = 380;
        platforms[0].height = 196;
        platforms[1] = { x: 287, y: 230, width: 450, height: 15, isGround: false };
        if (platforms.length > 2) {
            platforms.splice(2);
        }
        if (wrapper) wrapper.style.backgroundImage = "url('image/map/meadow_bg_v4.png')";
        if (mapDesc) mapDesc.textContent = "Battle in the lush green fields. Knock your opponent to the screen borders!";
    }
}

selectCharBtn.addEventListener('click', () => {
    selectCharBtn.blur();
    gameoverOverlay.classList.remove('active');
    hud.classList.remove('active'); // Hide HUD during character select
    backToMenuBtn.classList.remove('active');
    
    // Make mute buttons visible on character select screen
    bgmMuteBtn.classList.add('active');
    totalMuteBtn.classList.add('active');
    
    // Stop audio
    bgmAudio.pause();
    bgmAudio.currentTime = 0;

    // Reset game parameters and return to start overlay (directly to selector screen)
    gameStarted = false;
    gameOver = false;
    winnerId = null;
    projectiles = [];
    particles = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear the canvas
    
    restoreSelectionVariables(); // Restore original selection choices
    
    // Reset Ready state for multiplayer
    isReady = false;
    document.getElementById('battle-btn').style.display = 'block';
    if (gameMode === 'online') {
        document.getElementById('battle-btn').textContent = "READY";
        if (socket) socket.emit('playerReady', false);
    } else {
        document.getElementById('battle-btn').textContent = "FIGHT!";
    }
    
    document.getElementById('char-select-screen').classList.add('active');
    startOverlay.classList.add('active');
});

// Back to Selection Screen Button Listener (In-Game)
function returnToLobby() {
    // Hide HUD & back button, keep mute buttons active
    hud.classList.remove('active');
    backToMenuBtn.classList.remove('active');
    
    // Stop audio
    bgmAudio.pause();
    bgmAudio.currentTime = 0;

    // Reset game parameters
    gameStarted = false;
    gameOver = false;
    winnerId = null;
    projectiles = [];
    particles = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear the canvas
    
    restoreSelectionVariables(); // Restore original selection choices
    
    // Reset Ready state for multiplayer
    isReady = false;
    document.getElementById('battle-btn').style.display = 'block';
    if (gameMode === 'online') {
        document.getElementById('battle-btn').textContent = "READY";
        if (socket) socket.emit('playerReady', false);
    } else {
        document.getElementById('battle-btn').textContent = "FIGHT!";
    }
    
    // Show start screen overlay
    document.getElementById('char-select-screen').classList.add('active');
    startOverlay.classList.add('active');
    gameoverOverlay.classList.remove('active');
}

backToMenuBtn.addEventListener('click', () => {
    backToMenuBtn.blur();
    if (gameMode === 'online' && socket) {
        socket.emit('returnToLobby');
    }
    returnToLobby();
});

// Mute BGM Button Listener (In-Game)
bgmMuteBtn.addEventListener('click', () => {
    bgmMuteBtn.blur();
    isBgmMuted = !isBgmMuted;
    bgmAudio.muted = isBgmMuted || isTotalMuted;
    selectBgmAudio.muted = isBgmMuted || isTotalMuted;
    updateBgmMuteIcon();
});

function updateBgmMuteIcon() {
    if (isBgmMuted) {
        bgmMuteBtn.innerHTML = `
            <svg id="bgm-mute-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 13V5l12-2v6"></path>
                <circle cx="6" cy="18" r="3"></circle>
                <circle cx="18" cy="16" r="3"></circle>
                <line x1="3" y1="21" x2="21" y2="3"></line>
            </svg>
        `;
    } else {
        bgmMuteBtn.innerHTML = `
            <svg id="bgm-mute-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 18V5l12-2v13"></path>
                <circle cx="6" cy="18" r="3"></circle>
                <circle cx="18" cy="16" r="3"></circle>
            </svg>
        `;
    }
}

// Mute Total Sounds Button Listener (In-Game)
totalMuteBtn.addEventListener('click', () => {
    totalMuteBtn.blur();
    isTotalMuted = !isTotalMuted;
    bgmAudio.muted = isBgmMuted || isTotalMuted;
    selectBgmAudio.muted = isBgmMuted || isTotalMuted;
    updateTotalMuteIcon();
});

function updateTotalMuteIcon() {
    if (isTotalMuted) {
        totalMuteBtn.innerHTML = `
            <svg id="total-mute-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <line x1="23" y1="9" x2="17" y2="15"></line>
                <line x1="17" y1="9" x2="23" y2="15"></line>
            </svg>
        `;
    } else {
        totalMuteBtn.innerHTML = `
            <svg id="total-mute-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            </svg>
        `;
    }
}

function showGameOverOverlay(wId) {
    const winnerDisplay = document.getElementById('winner-text');
    const victoryImg = document.getElementById('victory-img');
    
    const getKoreanName = (char) => {
        if (char === 'capybara') return '카피바라';
        if (char === 'otter') return '수달';
        if (char === 'owl') return '부엉이';
        if (char === 'quokka') return '쿼카';
        return '';
    };

    const getTextColorClass = (char) => {
        if (char === 'capybara') return 'capybara-text';
        if (char === 'otter') return 'otter-text';
        if (char === 'owl') return 'owl-text';
        if (char === 'quokka') return 'quokka-text';
        return '';
    };

    if (wId === 1) {
        const charName = getKoreanName(player1.characterType);
        winnerDisplay.textContent = `PLAYER 1 (${charName}) WIN!`;
        winnerDisplay.className = getTextColorClass(player1.characterType);
        if (victoryImg) {
            let victorySrc = 'image/victory/capy_victory.png';
            let showImg = true;
            if (player1.characterType === 'otter') {
                victorySrc = 'image/victory/otter_victory.png';
            } else if (player1.characterType === 'owl') {
                victorySrc = 'image/victory/owl_victory.png';
            } else if (player1.characterType === 'quokka') {
                victorySrc = 'image/victory/quokka_victory.png';
            }
            if (showImg) {
                victoryImg.src = victorySrc;
                victoryImg.style.borderColor = player1.color;
                victoryImg.style.boxShadow = `0 0 20px ${player1.color}cc`;
                victoryImg.style.display = 'block';
            } else {
                victoryImg.style.display = 'none';
            }
        }
    } else if (wId === 2) {
        const charName = getKoreanName(player2.characterType);
        const p2Title = gameMode === 'pve' ? 'COMPUTER' : 'PLAYER 2';
        winnerDisplay.textContent = `${p2Title} (${charName}) WIN!`;
        winnerDisplay.className = getTextColorClass(player2.characterType);
        if (victoryImg) {
            let victorySrc = 'image/victory/capy_victory.png';
            let showImg = true;
            if (player2.characterType === 'otter') {
                victorySrc = 'image/victory/otter_victory.png';
            } else if (player2.characterType === 'owl') {
                victorySrc = 'image/victory/owl_victory.png';
            } else if (player2.characterType === 'quokka') {
                victorySrc = 'image/victory/quokka_victory.png';
            }
            if (showImg) {
                victoryImg.src = victorySrc;
                victoryImg.style.borderColor = player2.color;
                victoryImg.style.boxShadow = `0 0 20px ${player2.color}cc`;
                victoryImg.style.display = 'block';
            } else {
                victoryImg.style.display = 'none';
            }
        }
    } else {
        winnerDisplay.textContent = "DRAW GAME!";
        winnerDisplay.className = "";
        if (victoryImg) {
            victoryImg.style.display = 'none';
        }
    }
    
    if (gameMode === 'online') {
        document.getElementById('restart-btn').style.display = 'none';
    } else {
        document.getElementById('restart-btn').style.display = 'block';
    }
    
    backToMenuBtn.classList.remove('active');
    bgmMuteBtn.classList.remove('active');
    totalMuteBtn.classList.remove('active');
    gameoverOverlay.classList.add('active');
}

// Initial draw to populate HUD
updateHUD();
