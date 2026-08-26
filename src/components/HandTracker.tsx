import { useRef, useState, useEffect } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

interface Point {
  x: number;
  y: number;
}

interface SymbolDef {
  name: string;
  points: Point[]; // Points relatifs à la Zone de Jeu (0.0 à 1.0)
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  life: number;
}

// Zone d'action restreinte (en pourcentage de l'écran)
const PLAY_ZONE = {
  xMin: 0.1,  // Marge gauche 10%
  xMax: 0.9,  // Marge droite 90% (largeur 80%)
  yMin: 0.22, // Marge haut 22% (sous le HUD)
  yMax: 0.70, // Marge bas 70% (au-dessus du monstre)
};

const SYMBOLS: SymbolDef[] = [
  {
    name: 'Trait Céleste',
    points: [
      { x: 0.2, y: 0.5 },
      { x: 0.8, y: 0.5 },
    ],
  },
  {
    name: 'Éclair Vulcain',
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.5 },
      { x: 0.2, y: 0.5 },
      { x: 0.8, y: 0.8 },
    ],
  },
  {
    name: 'Rune V',
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.5, y: 0.8 },
      { x: 0.8, y: 0.2 },
    ],
  },
  {
    name: 'Pic Glacial',
    points: [
      { x: 0.2, y: 0.8 },
      { x: 0.5, y: 0.2 },
      { x: 0.8, y: 0.8 },
    ],
  },
];

const MONSTERS = [
  { name: 'Gobelin d’Ombre', hp: 30, color: '#22c55e', emoji: '👹' },
  { name: 'Golem de Pierre', hp: 50, color: '#f59e0b', emoji: '🗿' },
  { name: 'Démon Pourpre', hp: 70, color: '#ef4444', emoji: '👾' },
  { name: 'Dragon d’Éther', hp: 100, color: '#a855f7', emoji: '🐉' },
];

export default function HandTracker() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [gameState, setGameState] = useState<'idle' | 'loading' | 'playing' | 'gameover'>('idle');
  const [monstersKilled, setMonstersKilled] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  const [errorMsg, setErrorMsg] = useState('');

  const [monsterIndex, setMonsterIndex] = useState(0);
  const [currentHp, setCurrentHp] = useState(30);

  const gameStateRef = useRef(gameState);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const animationFrameId = useRef<number | null>(null);

  const currentSymbolRef = useRef<SymbolDef>(SYMBOLS[0]);
  const activeCheckpointRef = useRef<number>(0);
  const userTrailRef = useRef<Point[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const lastAITimeRef = useRef<number>(0);
  const fingerPosRef = useRef<Point | null>(null);

  const setGameStateSync = (state: 'idle' | 'loading' | 'playing' | 'gameover') => {
    gameStateRef.current = state;
    setGameState(state);
  };

  useEffect(() => {
    const saved = localStorage.getItem('wizard_high_score');
    if (saved) setHighScore(parseInt(saved, 10));

    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (gameState === 'playing' && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            setGameStateSync('gameover');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [gameState, timeLeft]);

  const spawnNextMonster = (killedCount: number) => {
    const mIdx = killedCount % MONSTERS.length;
    setMonsterIndex(mIdx);
    setCurrentHp(MONSTERS[mIdx].hp);
    pickRandomSymbol();
  };

  const pickRandomSymbol = () => {
    const nextSymbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    currentSymbolRef.current = nextSymbol;
    activeCheckpointRef.current = 0;
    userTrailRef.current = [];
  };

  // Convertit les coordonnées 0-1 de la zone vers l'écran en pixels
  const zoneToScreen = (pt: Point, width: number, height: number): Point => {
    const zoneW = (PLAY_ZONE.xMax - PLAY_ZONE.xMin) * width;
    const zoneH = (PLAY_ZONE.yMax - PLAY_ZONE.yMin) * height;
    const startX = PLAY_ZONE.xMin * width;
    const startY = PLAY_ZONE.yMin * height;

    return {
      x: startX + pt.x * zoneW,
      y: startY + pt.y * zoneH,
    };
  };

  const createSpellExplosion = (x: number, y: number, color: string) => {
    for (let i = 0; i < 30; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 9 + 3;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: Math.random() * 6 + 3,
        color,
        life: 1.0,
      });
    }
  };

  const spawnSparks = (x: number, y: number) => {
    for (let i = 0; i < 3; i++) {
      particlesRef.current.push({
        x: x + (Math.random() - 0.5) * 12,
        y: y + (Math.random() - 0.5) * 12,
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5,
        radius: Math.random() * 3 + 1,
        color: Math.random() > 0.4 ? '#fde047' : '#38bdf8',
        life: 0.7,
      });
    }
  };

  const startCameraAndGame = async () => {
    setGameStateSync('loading');
    setErrorMsg('');

    try {
      if (!landmarkerRef.current) {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );

        landmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 1,
        });
      }

      if (!videoRef.current || !canvasRef.current) return;
      const video = videoRef.current;

      if (!video.srcObject) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        video.srcObject = stream;
        await video.play();
      }

      startGame();
    } catch (err: unknown) {
      console.error(err);
      setGameStateSync('error');
      setErrorMsg(err instanceof Error ? err.message : "Erreur d'accès caméra.");
    }
  };

  const startGame = () => {
    setMonstersKilled(0);
    setTimeLeft(30);
    particlesRef.current = [];
    spawnNextMonster(0);
    setGameStateSync('playing');

    if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    animationFrameId.current = requestAnimationFrame(renderLoop);
  };

  const renderLoop = (now: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;

    if (!video || !canvas || !landmarker) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (video.readyState >= 2) {
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      // Détection GPU
      if (now - lastAITimeRef.current > 30) {
        lastAITimeRef.current = now;
        const results = landmarker.detectForVideo(video, now);

        if (results.landmarks && results.landmarks[0]) {
          const indexTip = results.landmarks[0][8];
          if (indexTip) {
            const rawX = (1 - indexTip.x) * canvas.width;
            const rawY = indexTip.y * canvas.height;

            // Filtrage : le doigt doit être à l'intérieur de la zone de jeu
            const zoneLeft = PLAY_ZONE.xMin * canvas.width;
            const zoneRight = PLAY_ZONE.xMax * canvas.width;
            const zoneTop = PLAY_ZONE.yMin * canvas.height;
            const zoneBottom = PLAY_ZONE.yMax * canvas.height;

            if (rawX >= zoneLeft && rawX <= zoneRight && rawY >= zoneTop && rawY <= zoneBottom) {
              fingerPosRef.current = { x: rawX, y: rawY };
            } else {
              fingerPosRef.current = null; // Hors zone
            }
          }
        } else {
          fingerPosRef.current = null;
        }
      }

      const finger = fingerPosRef.current;

      if (gameStateRef.current === 'playing') {
        const symbol = currentSymbolRef.current;
        const zLeft = PLAY_ZONE.xMin * canvas.width;
        const zTop = PLAY_ZONE.yMin * canvas.height;
        const zW = (PLAY_ZONE.xMax - PLAY_ZONE.xMin) * canvas.width;
        const zH = (PLAY_ZONE.yMax - PLAY_ZONE.yMin) * canvas.height;

        // 1. Dessin de la Cadre Magique (Play Zone)
        ctx.strokeStyle = 'rgba(192, 132, 252, 0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(zLeft, zTop, zW, zH);
        ctx.setLineDash([]); // Reset dash

        // 2. Lignes reliant les points du symbole
        ctx.beginPath();
        symbol.points.forEach((pt, idx) => {
          const pos = zoneToScreen(pt, canvas.width, canvas.height);
          if (idx === 0) ctx.moveTo(pos.x, pos.y);
          else ctx.lineTo(pos.x, pos.y);
        });
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 6;
        ctx.stroke();

        // 3. Dessin des cercles numérotés
        symbol.points.forEach((pt, idx) => {
          const pos = zoneToScreen(pt, canvas.width, canvas.height);
          const isCurrent = idx === activeCheckpointRef.current;
          const isPassed = idx < activeCheckpointRef.current;

          ctx.beginPath();
          ctx.arc(pos.x, pos.y, isCurrent ? 28 : 20, 0, Math.PI * 2);
          ctx.fillStyle = isPassed
            ? 'rgba(34, 197, 94, 0.6)'
            : isCurrent
            ? 'rgba(168, 85, 247, 0.7)'
            : 'rgba(15, 23, 42, 0.8)';
          ctx.fill();

          ctx.strokeStyle = isPassed ? '#22c55e' : isCurrent ? '#c084fc' : '#ffffff';
          ctx.lineWidth = isCurrent ? 4 : 2;
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.font = `bold ${isCurrent ? 20 : 15}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(idx + 1), pos.x, pos.y);
        });

        // 4. Validation du tracé
        const targetPt = symbol.points[activeCheckpointRef.current];
        if (targetPt && finger) {
          const targetPos = zoneToScreen(targetPt, canvas.width, canvas.height);
          const dist = Math.hypot(finger.x - targetPos.x, finger.y - targetPos.y);

          userTrailRef.current.push({ x: finger.x, y: finger.y });
          if (userTrailRef.current.length > 14) userTrailRef.current.shift();

          spawnSparks(finger.x, finger.y);

          if (dist < 45) {
            activeCheckpointRef.current += 1;

            if (activeCheckpointRef.current >= symbol.points.length) {
              createSpellExplosion(targetPos.x, targetPos.y, '#c084fc');

              setCurrentHp((prevHp) => {
                const newHp = prevHp - 25;
                if (newHp <= 0) {
                  setMonstersKilled((k) => {
                    const nextKilled = k + 1;
                    if (nextKilled > highScore) {
                      setHighScore(nextKilled);
                      localStorage.setItem('wizard_high_score', nextKilled.toString());
                    }
                    spawnNextMonster(nextKilled);
                    return nextKilled;
                  });
                } else {
                  pickRandomSymbol();
                }
                return newHp;
              });
            }
          }
        }

        // 5. Traînée lumineuse
        if (userTrailRef.current.length > 1) {
          ctx.beginPath();
          ctx.moveTo(userTrailRef.current[0].x, userTrailRef.current[0].y);
          for (let i = 1; i < userTrailRef.current.length; i++) {
            ctx.lineTo(userTrailRef.current[i].x, userTrailRef.current[i].y);
          }
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 8;
          ctx.lineCap = 'round';
          ctx.stroke();
        }

        // 6. Curseur baguette
        if (finger) {
          ctx.beginPath();
          ctx.arc(finger.x, finger.y, 12, 0, Math.PI * 2);
          ctx.fillStyle = '#fde047';
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 3;
          ctx.stroke();
        }

        // 7. Particules
        particlesRef.current = particlesRef.current.filter((p) => {
          p.x += p.vx;
          p.y += p.vy;
          p.life -= 0.05;
          if (p.life <= 0) return false;

          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.5, p.radius * p.life), 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = p.life;
          ctx.fill();
          ctx.globalAlpha = 1.0;
          return true;
        });
      }
    }

    animationFrameId.current = requestAnimationFrame(renderLoop);
  };

  const currentMonster = MONSTERS[monsterIndex];

  return (
    <div className="fixed inset-0 w-screen h-screen bg-black overflow-hidden select-none">
      <video ref={videoRef} className="hidden" playsInline autoPlay muted />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover" />

      {/* HUD Supérieur */}
      <div className="absolute top-0 left-0 right-0 p-4 pt-6 flex flex-col items-center z-10 bg-gradient-to-b from-black/90 via-black/50 to-transparent pointer-events-none space-y-3">
        <div className="flex justify-between items-center w-full max-w-md">
          <div className="text-left">
            <p className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">Vaincus</p>
            <p className="text-3xl font-black text-purple-400">{monstersKilled}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">Temps</p>
            <p
              className={`text-3xl font-black ${
                timeLeft <= 5 ? 'text-red-500 animate-bounce' : 'text-amber-400'
              }`}
            >
              {timeLeft}s
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">Record</p>
            <p className="text-3xl font-black text-emerald-400">{highScore}</p>
          </div>
        </div>

        {/* Barre de vie du monstre */}
        {gameState === 'playing' && (
          <div className="w-full max-w-xs space-y-1 text-center">
            <div className="flex justify-between items-center text-xs font-bold text-white px-1">
              <span>{currentMonster.name}</span>
              <span>
                {Math.max(0, currentHp)} / {currentMonster.hp} HP
              </span>
            </div>
            <div className="w-full bg-slate-900/80 h-3.5 rounded-full overflow-hidden border border-white/20 p-0.5 backdrop-blur-md shadow-lg">
              <div
                className="h-full transition-all duration-300 rounded-full"
                style={{
                  width: `${(Math.max(0, currentHp) / currentMonster.hp) * 100}%`,
                  backgroundColor: currentMonster.color,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Monstre en bas */}
      {gameState === 'playing' && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none text-center">
          <div className="text-9xl drop-shadow-2xl animate-pulse">{currentMonster.emoji}</div>
        </div>
      )}

      {/* Écran d'accueil */}
      {gameState === 'idle' && (
        <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-20">
          <h1 className="text-4xl font-black text-purple-400 mb-2">WIZARD DUEL 🧙‍♂️⚡</h1>
          <p className="text-sm text-slate-300 max-w-xs mb-6">
            Trace les runes dans le cadre magique avec ton index pour terrasser les monstres !
          </p>
          <button
            onClick={startCameraAndGame}
            className="px-8 py-4 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-2xl shadow-xl shadow-purple-500/30 transition-transform active:scale-95 text-lg"
          >
            Invoquer la magie 🪄
          </button>
        </div>
      )}

      {/* Écran de chargement */}
      {gameState === 'loading' && (
        <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center z-20 space-y-4">
          <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-semibold text-purple-300">Initialisation du cadre magique GPU...</p>
        </div>
      )}

      {/* Écran Game Over */}
      {gameState === 'gameover' && (
        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-20 space-y-4">
          <h2 className="text-3xl font-black text-red-500">TEMPS ÉCOULÉ ! ⏱️</h2>
          <div className="space-y-1">
            <p className="text-slate-400 text-sm">Monstres vaincus</p>
            <p className="text-6xl font-black text-white">{monstersKilled}</p>
          </div>
          <button
            onClick={startGame}
            className="px-8 py-3.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl shadow-lg transition-transform active:scale-95 text-base mt-2"
          >
            Recommencer 🔄
          </button>
        </div>
      )}

      {/* Message d'erreur */}
      {gameState === 'error' && (
        <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center z-20 space-y-4">
          <p className="text-sm text-red-400 font-semibold">{errorMsg}</p>
          <button
            onClick={startCameraAndGame}
            className="px-4 py-2 bg-slate-800 text-white text-xs rounded-lg border border-slate-700"
          >
            Réessayer
          </button>
        </div>
      )}
    </div>
  );
}