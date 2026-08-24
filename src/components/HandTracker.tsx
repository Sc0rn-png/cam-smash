import { useRef, useState, useEffect } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

interface Target {
  id: number;
  x: number;
  y: number;
  radius: number;
  color: string;
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

export default function HandTracker() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [gameState, setGameState] = useState<'idle' | 'loading' | 'playing' | 'gameover'>('idle');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  const [errorMsg, setErrorMsg] = useState('');

  const gameStateRef = useRef(gameState);
  const scoreRef = useRef(0);
  const targetsRef = useRef<Target[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const animationFrameId = useRef<number | null>(null);

  const lastFingerPositionsRef = useRef<{ x: number; y: number }[]>([]);
  const lastAITimeRef = useRef<number>(0);

  const setGameStateSync = (state: 'idle' | 'loading' | 'playing' | 'gameover') => {
    gameStateRef.current = state;
    setGameState(state);
  };

  const targetColors = ['#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

  useEffect(() => {
    const savedHighScore = localStorage.getItem('index_smash_highscore');
    if (savedHighScore) setHighScore(parseInt(savedHighScore, 10));

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
            if (scoreRef.current > highScore) {
              setHighScore(scoreRef.current);
              localStorage.setItem('index_smash_highscore', scoreRef.current.toString());
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [gameState, timeLeft, highScore]);

  // Zone sécurisée au centre (20% marge X, 25% marge Y)
  const spawnTarget = (width: number, height: number) => {
    const paddingX = width * 0.20;
    const paddingY = height * 0.25;

    const newTarget: Target = {
      id: Math.random(),
      x: paddingX + Math.random() * (width - paddingX * 2),
      y: paddingY + Math.random() * (height - paddingY * 2),
      radius: Math.floor(Math.random() * 10) + 28,
      color: targetColors[Math.floor(Math.random() * targetColors.length)],
    };
    targetsRef.current.push(newTarget);
  };

  const createExplosion = (x: number, y: number, color: string) => {
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 6 + 2;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: Math.random() * 4 + 2,
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

        landmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
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
    scoreRef.current = 0;
    setScore(0);
    setTimeLeft(30);
    targetsRef.current = [];
    particlesRef.current = [];

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      for (let i = 0; i < 4; i++) {
        spawnTarget(canvas.width, canvas.height);
      }
    }

    setGameStateSync('playing');

    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
    }
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

      // IA exécutée toutes les 35ms max pour ne pas ramer sur mobile
      if (now - lastAITimeRef.current > 35) {
        lastAITimeRef.current = now;
        const results = landmarker.detectForVideo(video, now);
        const currentPositions: { x: number; y: number }[] = [];

        if (results.landmarks) {
          for (const landmarks of results.landmarks) {
            const indexTip = landmarks[8];
            if (indexTip) {
              const x = (1 - indexTip.x) * canvas.width;
              const y = indexTip.y * canvas.height;
              currentPositions.push({ x, y });
            }
          }
        }
        lastFingerPositionsRef.current = currentPositions;
      }

      const fingerPositions = lastFingerPositionsRef.current;
      for (const finger of fingerPositions) {
        ctx.beginPath();
        ctx.arc(finger.x, finger.y, 22, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(99, 102, 241, 0.5)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(finger.x, finger.y, 10, 0, Math.PI * 2);
        ctx.fillStyle = '#22c55e';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      if (gameStateRef.current === 'playing') {
        while (targetsRef.current.length < 4) {
          spawnTarget(canvas.width, canvas.height);
        }

        targetsRef.current = targetsRef.current.filter((target) => {
          let hit = false;

          for (const finger of fingerPositions) {
            const dist = Math.hypot(finger.x - target.x, finger.y - target.y);
            if (dist < target.radius + 20) {
              hit = true;
              break;
            }
          }

          if (hit) {
            createExplosion(target.x, target.y, target.color);
            scoreRef.current += 10;
            setScore(scoreRef.current);
            return false;
          }

          ctx.beginPath();
          ctx.arc(target.x, target.y, target.radius, 0, Math.PI * 2);
          ctx.fillStyle = target.color;
          ctx.shadowColor = target.color;
          ctx.shadowBlur = 10;
          ctx.fill();
          ctx.shadowBlur = 0;

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 3;
          ctx.stroke();

          return true;
        });

        particlesRef.current = particlesRef.current.filter((p) => {
          p.x += p.vx;
          p.y += p.vy;
          p.life -= 0.06;

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

  return (
    <div className="fixed inset-0 w-screen h-screen bg-black overflow-hidden select-none">
      <video ref={videoRef} className="hidden" playsInline autoPlay muted />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover" />

      {/* HUD Haut */}
      <div className="absolute top-0 left-0 right-0 p-4 pt-6 flex justify-between items-center z-10 bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-none">
        <div className="text-left">
          <p className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">Score</p>
          <p className="text-3xl font-black text-indigo-400 drop-shadow-md">{score}</p>
        </div>

        <div className="text-center">
          <p className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">Temps</p>
          <p
            className={`text-3xl font-black drop-shadow-md ${
              timeLeft <= 5 ? 'text-red-500 animate-bounce' : 'text-amber-400'
            }`}
          >
            {timeLeft}s
          </p>
        </div>

        <div className="text-right">
          <p className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">Record</p>
          <p className="text-3xl font-black text-emerald-400 drop-shadow-md">{highScore}</p>
        </div>
      </div>

      {/* Logo discret bas */}
      {gameState === 'playing' && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <span className="px-3 py-1 text-[11px] font-black uppercase tracking-widest text-white/80 bg-black/40 backdrop-blur-md rounded-full border border-white/10 shadow-lg">
            INDEX SMASH 👆💥
          </span>
        </div>
      )}

      {/* Écran d'accueil */}
      {gameState === 'idle' && (
        <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-20">
          <h1 className="text-4xl font-black text-white mb-2">INDEX SMASH 👆💥</h1>
          <p className="text-sm text-slate-300 max-w-xs mb-6">
            Pointe tes index vers l'écran pour éclater les cibles et battre le chrono.
          </p>
          <button
            onClick={startCameraAndGame}
            className="px-8 py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-2xl shadow-xl shadow-indigo-500/30 transition-transform active:scale-95 text-lg"
          >
            Jouer maintenant 🚀
          </button>
        </div>
      )}

      {/* Écran de chargement */}
      {gameState === 'loading' && (
        <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center z-20 space-y-4">
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-semibold text-indigo-300">Préparation de la caméra et de l'IA...</p>
        </div>
      )}

      {/* Écran Game Over */}
      {gameState === 'gameover' && (
        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-20 space-y-4">
          <h2 className="text-3xl font-black text-red-500">TEMPS ÉCOULÉ ! ⏱️</h2>
          <div className="space-y-1">
            <p className="text-slate-400 text-sm font-medium">Score final</p>
            <p className="text-6xl font-black text-white">{score}</p>
          </div>
          {score >= highScore && score > 0 && (
            <p className="text-xs font-bold text-emerald-400 bg-emerald-500/20 px-4 py-1.5 rounded-full border border-emerald-500/30">
              🎉 NOUVEAU RECORD !
            </p>
          )}
          <button
            onClick={startGame}
            className="px-8 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg transition-transform active:scale-95 text-base mt-2"
          >
            Rejouer 🔄
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