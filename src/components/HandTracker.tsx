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
  alpha: number;
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

  // Refs pour éviter les soucis de closure dans requestAnimationFrame
  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  const scoreRef = useRef(0);
  const targetsRef = useRef<Target[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const landmarkerRef = useRef<HandLandmarker | null>(null);

  // Couleurs vives pour les cibles
  const targetColors = ['#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'];

  // Charger le High Score au démarrage
  useEffect(() => {
    const savedHighScore = localStorage.getItem('index_smash_highscore');
    if (savedHighScore) setHighScore(parseInt(savedHighScore, 10));
  }, []);

  // Timer de partie (30 secondes)
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (gameState === 'playing' && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            setGameState('gameover');
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

  // Générer des cibles à l'écran
  const spawnTarget = (width: number, height: number) => {
    const padding = 60;
    const newTarget: Target = {
      id: Math.random(),
      x: padding + Math.random() * (width - padding * 2),
      y: padding + Math.random() * (height - padding * 2),
      radius: Math.floor(Math.random() * 15) + 25, // 25px à 40px
      color: targetColors[Math.floor(Math.random() * targetColors.length)],
    };
    targetsRef.current.push(newTarget);
  };

  // Créer une explosion de particules au smash
  const createExplosion = (x: number, y: number, color: string) => {
    for (let i = 0; i < 15; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 6 + 2;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: Math.random() * 4 + 2,
        color,
        alpha: 1,
        life: 1,
      });
    }
  };

  const startCameraAndGame = async () => {
    setGameState('loading');
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

      // Lancer la partie
      resetGame();
    } catch (err: unknown) {
      console.error(err);
      setGameState('error');
      setErrorMsg(err instanceof Error ? err.message : "Erreur lors de l'accès caméra.");
    }
  };

  const resetGame = () => {
    scoreRef.current = 0;
    setScore(0);
    setTimeLeft(30);
    targetsRef.current = [];
    particlesRef.current = [];
    setGameState('playing');

    if (canvasRef.current) {
      // Générer 3 cibles initiales
      for (let i = 0; i < 3; i++) {
        spawnTarget(canvasRef.current.width || 640, canvasRef.current.height || 480);
      }
    }

    requestAnimationFrame(renderLoop);
  };

  const renderLoop = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;

    if (!video || !canvas || !landmarker) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (video.readyState >= 2) {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;

      // 1. Dessiner la vidéo inversée (effet miroir)
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      // 2. Détection MediaPipe
      const results = landmarker.detectForVideo(video, performance.now());
      const fingerPositions: { x: number; y: number }[] = [];

      if (results.landmarks) {
        for (const landmarks of results.landmarks) {
          const indexTip = landmarks[8]; // Bout de l'index
          if (indexTip) {
            // Effet miroir sur les coordonnées X
            const x = (1 - indexTip.x) * canvas.width;
            const y = indexTip.y * canvas.height;
            fingerPositions.push({ x, y });

            // Dessiner un curseur sur l'index
            ctx.beginPath();
            ctx.arc(x, y, 18, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(99, 102, 241, 0.4)';
            ctx.fill();

            ctx.beginPath();
            ctx.arc(x, y, 8, 0, Math.PI * 2);
            ctx.fillStyle = '#22c55e';
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
      }

      // 3. Logique du jeu en mode "playing"
      if (gameStateRef.current === 'playing') {
        // Maintenir toujours au moins 3 cibles
        while (targetsRef.current.length < 3) {
          spawnTarget(canvas.width, canvas.height);
        }

        // Mettre à jour et dessiner les cibles + Détecter les collisions
        targetsRef.current = targetsRef.current.filter((target) => {
          let hit = false;

          for (const finger of fingerPositions) {
            const dist = Math.hypot(finger.x - target.x, finger.y - target.y);
            // Collision si l'index touche la cible (rayon cible + marge)
            if (dist < target.radius + 15) {
              hit = true;
              break;
            }
          }

          if (hit) {
            createExplosion(target.x, target.y, target.color);
            scoreRef.current += 10;
            setScore(scoreRef.current);
            return false; // Supprimer la cible
          }

          // Dessiner la cible
          ctx.beginPath();
          ctx.arc(target.x, target.y, target.radius, 0, Math.PI * 2);
          ctx.fillStyle = target.color;
          ctx.shadowColor = target.color;
          ctx.shadowBlur = 15;
          ctx.fill();
          ctx.shadowBlur = 0;

          // Petit contour blanc
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 3;
          ctx.stroke();

          return true;
        });

        // Mettre à jour et dessiner les particules d'explosion
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

    if (gameStateRef.current === 'playing' || gameStateRef.current === 'idle') {
      requestAnimationFrame(renderLoop);
    }
  };

  return (
    <div className="flex flex-col items-center w-full max-w-xl mx-auto space-y-4">
      {/* HUD : Score, Timer & HighScore */}
      <div className="flex items-center justify-between w-full px-6 py-3 bg-slate-900 border border-slate-800 rounded-2xl shadow-lg">
        <div className="text-left">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Score</p>
          <p className="text-2xl font-black text-indigo-400">{score}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Temps</p>
          <p className={`text-2xl font-black ${timeLeft <= 5 ? 'text-red-500 animate-ping' : 'text-amber-400'}`}>
            {timeLeft}s
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Record</p>
          <p className="text-2xl font-black text-emerald-400">{highScore}</p>
        </div>
      </div>

      {/* Zone de Jeu / Caméra */}
      <div className="relative w-full aspect-[4/3] rounded-3xl overflow-hidden border-4 border-indigo-500/30 shadow-2xl bg-slate-950 flex items-center justify-center">
        <video ref={videoRef} className="hidden" playsInline autoPlay muted />
        <canvas ref={canvasRef} className="w-full h-full object-cover" />

        {/* Écran d'accueil */}
        {gameState === 'idle' && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center space-y-4 p-6 text-center">
            <h2 className="text-3xl font-black text-white">INDEX SMASH 👆💥</h2>
            <p className="text-sm text-slate-300 max-w-xs">
              Lève tes index face à la caméra et explose les cibles avant la fin du chrono !
            </p>
            <button
              onClick={startCameraAndGame}
              className="px-8 py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-2xl shadow-lg transition-all active:scale-95"
            >
              Jouer maintenant
            </button>
          </div>
        )}

        {/* Écran de chargement */}
        {gameState === 'loading' && (
          <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center space-y-3">
            <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm font-semibold text-indigo-300">Initialisation de la caméra et de l'IA...</p>
          </div>
        )}

        {/* Écran de fin de partie */}
        {gameState === 'gameover' && (
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center space-y-4 p-6 text-center animate-fade-in">
            <h2 className="text-3xl font-black text-red-500">TEMPS ÉCOULÉ ! ⏱️</h2>
            <div className="space-y-1">
              <p className="text-slate-400 text-sm">Score final</p>
              <p className="text-5xl font-black text-white">{score}</p>
            </div>
            {score >= highScore && score > 0 && (
              <p className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
                🎉 NOUVEAU RECORD !
              </p>
            )}
            <button
              onClick={resetGame}
              className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg transition-transform active:scale-95 mt-2"
            >
              Rejouer
            </button>
          </div>
        )}

        {/* Message d'erreur */}
        {gameState === 'error' && (
          <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center space-y-4">
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
    </div>
  );
}