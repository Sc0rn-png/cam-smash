import { useRef, useState, useEffect } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

interface Point {
  x: number;
  y: number;
}

interface SymbolDef {
  name: string;
  points: Point[]; // Points relatifs (0 à 1)
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

// Liste des symboles magiques à tracer
const SYMBOLS: SymbolDef[] = [
  {
    name: 'Trait Céleste',
    points: [
      { x: 0.3, y: 0.4 },
      { x: 0.7, y: 0.4 },
    ],
  },
  {
    name: 'Éclair Vulcain',
    points: [
      { x: 0.3, y: 0.3 },
      { x: 0.7, y: 0.5 },
      { x: 0.3, y: 0.5 },
      { x: 0.7, y: 0.7 },
    ],
  },
  {
    name: 'Rune V',
    points: [
      { x: 0.3, y: 0.3 },
      { x: 0.5, y: 0.6 },
      { x: 0.7, y: 0.3 },
    ],
  },
  {
    name: 'Pic Glacial',
    points: [
      { x: 0.3, y: 0.6 },
      { x: 0.5, y: 0.3 },
      { x: 0.7, y: 0.6 },
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

  // États du monstre
  const [monsterIndex, setMonsterIndex] = useState(0);
  const [currentHp, setCurrentHp] = useState(30);

  const gameStateRef = useRef(gameState);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const animationFrameId = useRef<number | null>(null);

  // Gestion du tracé
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

  // Chrono 30s
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

  const createSpellExplosion = (x: number, y: number, color: string) => {
    for (let i = 0; i < 25; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 8 + 3;
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

  const startCameraAndGame = async () => {
    setGameStateSync('loading');
    setErrorMsg('');

    try {
      if (!landmarkerRef.current) {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );

        // Activation GPU
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

    // Rendu flux caméra
    if (video.readyState >= 2) {
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      // Detection MediaPipe (30 FPS max pour économiser la batterie)
      if (now - lastAITimeRef.current > 30) {
        lastAITimeRef.current = now;
        const results = landmarker.detectForVideo(video, now);

        if (results.landmarks && results.landmarks[0]) {
          const indexTip = results.landmarks[0][8];
          if (indexTip) {
            fingerPosRef.current = {
              x: (1 - indexTip.x) * canvas.width,
              y: indexTip.y * canvas.height,
            };
          }
        } else {
          fingerPosRef.current = null;
        }
      }

      const finger = fingerPosRef.current;

      // Traitement du jeu
      if (gameStateRef.current === 'playing') {
        const symbol = currentSymbolRef.current;
        const targetPoint = symbol.points[activeCheckpointRef.current];

        if (targetPoint) {
          const targetX = targetPoint.x * canvas.width;
          const targetY = targetPoint.y * canvas.height;

          // Dessin du symbole à tracer
          ctx.beginPath();
          ctx.arc(targetX, targetY, 28, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(168, 85, 247, 0.3)';
          ctx.fill();
          ctx.strokeStyle = '#c084fc';
          ctx.lineWidth = 3;
          ctx.stroke();

          // Lignes entre checkpoints
          ctx.beginPath();
          symbol.points.forEach((pt, idx) => {
            const px = pt.x * canvas.width;
            const py = pt.y * canvas.height;
            if (idx === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.lineWidth = 6;
          ctx.stroke();

          // Validation de la position du doigt
          if (finger) {
            const dist = Math.hypot(finger.x - targetX, finger.y - targetY);

            // Trait magique sous le doigt
            userTrailRef.current.push({ x: finger.x, y: finger.y });
            if (userTrailRef.current.length > 12) userTrailRef.current.shift();

            if (dist < 45) {
              activeCheckpointRef.current += 1;

              // Sort réussi !
              if (activeCheckpointRef.current >= symbol.points.length) {
                createSpellExplosion(targetX, targetY, '#c084fc');

                // Dégâts au monstre
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
        }

        // Dessiner la traînée magique du doigt
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

        // Dessiner la baguette (pointe de l'index)
        if (finger) {
          ctx.beginPath();
          ctx.arc(finger.x, finger.y, 12, 0, Math.PI * 2);
          ctx.fillStyle = '#38bdf8';
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 3;
          ctx.stroke();
        }

        // Particules d'explosions
        particlesRef.current = particlesRef.current.filter((p) => {
          p.x += p.vx;
          p.y += p.vy;
          p.life -= 0.04;
          if (p.life <= 0) return false;

          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius * p.life, 0, Math.PI * 2);
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
      <div className="absolute top-0 left-0 right-0 p-4 pt-6 flex justify-between items-center z-10 bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-none">
        <div>
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

      {/* Monstre en bas au centre */}
      {gameState === 'playing' && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 w-72 flex flex-col items-center pointer-events-none">
          <div className="text-6xl mb-1 animate-bounce">{currentMonster.emoji}</div>
          <div className="w-full bg-slate-900/80 backdrop-blur-md border border-white/20 p-3 rounded-2xl shadow-2xl text-center space-y-1.5">
            <div className="flex justify-between items-center text-xs font-bold text-white">
              <span>{currentMonster.name}</span>
              <span>{Math.max(0, currentHp)} HP</span>
            </div>
            {/* Barre de vie */}
            <div className="w-full bg-slate-800 h-3 rounded-full overflow-hidden border border-white/10">
              <div
                className="h-full transition-all duration-300 rounded-full"
                style={{
                  width: `${(Math.max(0, currentHp) / currentMonster.hp) * 100}%`,
                  backgroundColor: currentMonster.color,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Écran d'accueil */}
      {gameState === 'idle' && (
        <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-20">
          <h1 className="text-4xl font-black text-purple-400 mb-2">WIZARD DUEL 🧙‍♂️⚡</h1>
          <p className="text-sm text-slate-300 max-w-xs mb-6">
            Trace les runes magiques avec ton index pour terrassement les monstres avant la fin du temps !
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
          <p className="text-sm font-semibold text-purple-300">Chargement des grimoires et du GPU...</p>
        </div>
      )}

      {/* Fin de partie */}
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