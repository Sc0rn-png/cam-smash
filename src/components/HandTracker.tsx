import { useRef, useState, useEffect } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

interface Point {
  x: number;
  y: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
}

interface FloatingText {
  id: number;
  text: string;
  x: number;
  y: number;
  color: string;
  alpha: number;
}

const PLAY_ZONE = {
  xMin: 0.1,
  xMax: 0.9,
  yMin: 0.22,
  yMax: 0.70,
};

// Générateur équitable de formes aléatoires bien espacées
function generatePattern(numPoints: number): Point[] {
  const points: Point[] = [];
  const minDist = 0.28;
  let attempts = 0;

  while (points.length < numPoints && attempts < 200) {
    attempts++;
    const candidate: Point = {
      x: Number((0.15 + Math.random() * 0.7).toFixed(2)),
      y: Number((0.15 + Math.random() * 0.7).toFixed(2)),
    };

    const isFarEnough = points.every((p) => {
      const dx = p.x - candidate.x;
      const dy = p.y - candidate.y;
      return Math.hypot(dx, dy) >= minDist;
    });

    if (isFarEnough) {
      points.push(candidate);
    }
  }

  // Fallback grille si tirage difficile
  if (points.length < numPoints) {
    const grid = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.5, y: 0.5 },
      { x: 0.2, y: 0.8 },
      { x: 0.8, y: 0.8 },
    ];
    return grid.slice(0, numPoints);
  }

  return points;
}

export default function HandTracker() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [gameState, setGameState] = useState<'idle' | 'loading' | 'playing' | 'gameover'>('idle');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [errorMsg, setErrorMsg] = useState('');
  const [bonusNotification, setBonusNotification] = useState<string | null>(null);

  const gameStateRef = useRef(gameState);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const animationFrameId = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const currentPatternRef = useRef<Point[]>([]);
  const activeCheckpointRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const floatingTextsRef = useRef<FloatingText[]>([]);
  const lastAITimeRef = useRef<number>(0);
  const fingerPosRef = useRef<Point | null>(null);

  const setGameStateSync = (state: 'idle' | 'loading' | 'playing' | 'gameover') => {
    gameStateRef.current = state;
    setGameState(state);
  };

  // Calcul du niveau selon le score
  const getLevelInfo = (currentScore: number) => {
    if (currentScore >= 400) {
      return { level: 3, numPoints: 5, timeBonus: 6, name: 'OVERDRIVE', color: '#ec4899', ptsPerShape: 25 };
    }
    if (currentScore >= 200) {
      return { level: 2, numPoints: 4, timeBonus: 8, name: 'SPEED', color: '#f59e0b', ptsPerShape: 15 };
    }
    return { level: 1, numPoints: 3, timeBonus: 10, name: 'INTENSE', color: '#06b6d4', ptsPerShape: 10 };
  };

  useEffect(() => {
    const saved = localStorage.getItem('hyper_tracer_high_score');
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

  // Timer principal
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

  // Wake Lock
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (wakeLockRef.current !== null && document.visibilityState === 'visible') {
        try {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
        } catch (err) {
          console.warn('Wake Lock error:', err);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    };
  }, []);

  const enableFullScreenAndWakeLock = async () => {
    try {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      }
    } catch (err) {
      console.warn('Fullscreen failed:', err);
    }
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      }
    } catch (err) {
      console.warn('WakeLock failed:', err);
    }
  };

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

  // Émission de particules de flamme
  const emitFlameParticles = (x: number, y: number) => {
    const fireColors = ['#ffffff', '#fef08a', '#f97316', '#ef4444', '#b91c1c'];
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 3 + 1;
      particlesRef.current.push({
        x: x + (Math.random() - 0.5) * 8,
        y: y + (Math.random() - 0.5) * 8,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        size: Math.random() * 8 + 4,
        color: fireColors[Math.floor(Math.random() * fireColors.length)],
        alpha: 1.0,
        life: 1.0,
        maxLife: Math.random() * 0.4 + 0.3,
      });
    }
  };

  // Explosion d'étincelles
  const triggerExplosion = (x: number, y: number, color: string) => {
    for (let i = 0; i < 35; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 12 + 4;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: Math.random() * 6 + 3,
        color,
        alpha: 1.0,
        life: 1.0,
        maxLife: Math.random() * 0.5 + 0.5,
      });
    }
  };

  const spawnNewPattern = (numPoints: number) => {
    currentPatternRef.current = generatePattern(numPoints);
    activeCheckpointRef.current = 0;
  };

  const startCameraAndGame = async () => {
    await enableFullScreenAndWakeLock();
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
      setErrorMsg(err instanceof Error ? err.message : 'Erreur caméra.');
    }
  };

  const startGame = () => {
    setScore(0);
    setTimeLeft(60);
    particlesRef.current = [];
    floatingTextsRef.current = [];
    spawnNewPattern(3);
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
      // Miroir webcam
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      // Assombrissement du fond pour faire ressortir les flammes
      ctx.fillStyle = 'rgba(10, 10, 20, 0.55)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Suivi IA
      if (now - lastAITimeRef.current > 25) {
        lastAITimeRef.current = now;
        const results = landmarker.detectForVideo(video, now);

        if (results.landmarks && results.landmarks[0]) {
          const indexTip = results.landmarks[0][8];
          if (indexTip) {
            const rawX = (1 - indexTip.x) * canvas.width;
            const rawY = indexTip.y * canvas.height;

            const zoneLeft = PLAY_ZONE.xMin * canvas.width;
            const zoneRight = PLAY_ZONE.xMax * canvas.width;
            const zoneTop = PLAY_ZONE.yMin * canvas.height;
            const zoneBottom = PLAY_ZONE.yMax * canvas.height;

            if (rawX >= zoneLeft && rawX <= zoneRight && rawY >= zoneTop && rawY <= zoneBottom) {
              fingerPosRef.current = { x: rawX, y: rawY };
            } else {
              fingerPosRef.current = null;
            }
          }
        } else {
          fingerPosRef.current = null;
        }
      }

      const finger = fingerPosRef.current;

      if (gameStateRef.current === 'playing') {
        const pattern = currentPatternRef.current;

        // Tracé des lignes reliant la forme
        if (pattern.length > 0) {
          ctx.beginPath();
          pattern.forEach((pt, idx) => {
            const pos = zoneToScreen(pt, canvas.width, canvas.height);
            if (idx === 0) ctx.moveTo(pos.x, pos.y);
            else ctx.lineTo(pos.x, pos.y);
          });
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.lineWidth = 6;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.stroke();
        }

        // Checkpoints / Points numérotés
        pattern.forEach((pt, idx) => {
          const pos = zoneToScreen(pt, canvas.width, canvas.height);
          const isCurrent = idx === activeCheckpointRef.current;
          const isPassed = idx < activeCheckpointRef.current;

          ctx.beginPath();
          ctx.arc(pos.x, pos.y, isCurrent ? 26 : 18, 0, Math.PI * 2);
          ctx.fillStyle = isPassed
            ? '#22c55e'
            : isCurrent
            ? '#f59e0b'
            : 'rgba(30, 41, 59, 0.85)';
          ctx.fill();

          ctx.strokeStyle = isPassed ? '#86efac' : isCurrent ? '#fef08a' : '#94a3b8';
          ctx.lineWidth = isCurrent ? 4 : 2;
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.font = `bold ${isCurrent ? 18 : 14}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(idx + 1), pos.x, pos.y);
        });

        // Validation du franchissement des points
        const targetPt = pattern[activeCheckpointRef.current];
        if (targetPt && finger) {
          const targetPos = zoneToScreen(targetPt, canvas.width, canvas.height);
          const dist = Math.hypot(finger.x - targetPos.x, finger.y - targetPos.y);

          // Émission du sillage de flammes au bout du doigt
          emitFlameParticles(finger.x, finger.y);

          if (dist < 48) {
            triggerExplosion(targetPos.x, targetPos.y, '#f59e0b');
            activeCheckpointRef.current += 1;

            // Forme complétée !
            if (activeCheckpointRef.current >= pattern.length) {
              setScore((prevScore) => {
                const newScore = prevScore + getLevelInfo(prevScore).ptsPerShape;
                if (newScore > highScore) {
                  setHighScore(newScore);
                  localStorage.setItem('hyper_tracer_high_score', newScore.toString());
                }

                const currentLvl = getLevelInfo(newScore);
                
                // Bonus de temps
                setTimeLeft((t) => t + currentLvl.timeBonus);

                // Notification visuelle
                setBonusNotification(`+${currentLvl.timeBonus}s`);
                setTimeout(() => setBonusNotification(null), 800);

                // Texte flottant
                floatingTextsRef.current.push({
                  id: Date.now(),
                  text: `+${currentLvl.timeBonus}s`,
                  x: targetPos.x,
                  y: targetPos.y - 20,
                  color: '#4ade80',
                  alpha: 1.0,
                });

                // Génération de la forme suivante
                spawnNewPattern(currentLvl.numPoints);
                return newScore;
              });
            }
          }
        }

        // Rendu & Mise à jour des Particules de Flammes
        particlesRef.current = particlesRef.current.filter((p) => {
          p.x += p.vx;
          p.y += p.vy;
          p.life -= 0.03;
          p.size *= 0.95;

          if (p.life <= 0 || p.size <= 0.5) return false;

          ctx.save();
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.fill();
          ctx.restore();
          return true;
        });

        // Rendu des textes flottants (+10s)
        floatingTextsRef.current = floatingTextsRef.current.filter((ft) => {
          ft.y -= 1.8;
          ft.alpha -= 0.025;
          if (ft.alpha <= 0) return false;

          ctx.save();
          ctx.globalAlpha = Math.max(0, ft.alpha);
          ctx.font = 'black 24px sans-serif';
          ctx.fillStyle = ft.color;
          ctx.textAlign = 'center';
          ctx.fillText(ft.text, ft.x, ft.y);
          ctx.restore();
          return true;
        });
      }
    }

    animationFrameId.current = requestAnimationFrame(renderLoop);
  };

  const levelInfo = getLevelInfo(score);

  return (
    <div className="fixed inset-0 w-screen h-screen bg-slate-950 overflow-hidden select-none font-sans">
      <video ref={videoRef} className="hidden" playsInline autoPlay muted />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover" />

      {/* HUD Supérieur - Style Arcade Modernisé */}
      <div className="absolute top-0 left-0 right-0 p-4 pt-6 flex flex-col items-center z-10 bg-gradient-to-b from-black/90 via-black/40 to-transparent pointer-events-none space-y-2">
        <div className="flex justify-between items-center w-full max-w-md px-2">
          {/* Badge Niveau */}
          <div className="flex flex-col items-start">
            <span
              className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full text-black"
              style={{ backgroundColor: levelInfo.color }}
            >
              LVL {levelInfo.level} • {levelInfo.name}
            </span>
            <p className="text-3xl font-black text-white mt-1 drop-shadow-md">{score} <span className="text-xs text-slate-400 font-bold">PTS</span></p>
          </div>

          {/* Chrono central avec effet Dopamine sur Bonus */}
          <div className="relative flex flex-col items-center">
            <span className="text-[10px] text-slate-300 font-extrabold uppercase tracking-widest">CHRONO</span>
            <div className="flex items-center space-x-1">
              <p
                className={`text-4xl font-black transition-transform ${
                  timeLeft <= 10 ? 'text-red-500 animate-ping' : 'text-amber-400'
                }`}
              >
                {timeLeft}s
              </p>
            </div>

            {/* Notification flottante de temps additionnel */}
            {bonusNotification && (
              <span className="absolute -bottom-6 text-xl font-black text-green-400 animate-bounce drop-shadow-[0_0_10px_rgba(74,222,128,0.8)]">
                {bonusNotification}
              </span>
            )}
          </div>

          {/* Meilleur Score */}
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest">RECORD</span>
            <p className="text-3xl font-black text-emerald-400 drop-shadow-md">{highScore}</p>
          </div>
        </div>

        {/* Indicateur explicatif du mode actuel */}
        {gameState === 'playing' && (
          <div className="bg-black/60 border border-white/10 backdrop-blur-md px-4 py-1 rounded-full text-center">
            <p className="text-xs font-bold text-slate-200">
              {levelInfo.numPoints} points à relier <span className="text-green-400">(+{levelInfo.timeBonus}s par forme)</span>
            </p>
          </div>
        )}
      </div>

      {/* Écran d'accueil */}
      {gameState === 'idle' && (
        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-lg flex flex-col items-center justify-center p-6 text-center z-20">
          <div className="max-w-xs space-y-6">
            <div className="inline-block bg-gradient-to-r from-orange-500 to-amber-400 p-3 rounded-2xl shadow-xl shadow-orange-500/20 mb-2">
              <span className="text-4xl">🔥</span>
            </div>
            <h1 className="text-4xl font-black text-white tracking-tight">HYPER TRACER</h1>
            <p className="text-sm text-slate-300 font-medium leading-relaxed">
              Relie les checkpoints numérotés avec ton index pour gagner du temps et faire exploser ton score !
            </p>

            <button
              onClick={startCameraAndGame}
              className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black rounded-2xl shadow-xl shadow-orange-500/30 transition-transform active:scale-95 text-lg uppercase tracking-wider"
            >
              Lancer la partie 🚀
            </button>
          </div>
        </div>
      )}

      {/* Écran de Chargement */}
      {gameState === 'loading' && (
        <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center z-20 space-y-4">
          <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-bold text-amber-300 tracking-wider">CONNEXION CAPTEUR...</p>
        </div>
      )}

      {/* Game Over - Relance Immédiate */}
      {gameState === 'gameover' && (
        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-20 space-y-6">
          <div className="space-y-2">
            <h2 className="text-3xl font-black text-red-500 uppercase tracking-wider">TEMPS ÉCOULÉ !</h2>
            <p className="text-xs text-slate-400 uppercase font-bold tracking-widest">Score Final</p>
            <p className="text-6xl font-black text-white drop-shadow-lg">{score}</p>
          </div>

          {score >= highScore && score > 0 && (
            <div className="bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-wider animate-pulse">
              🏆 NOUVEAU RECORD !
            </div>
          )}

          <button
            onClick={startGame}
            className="px-10 py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black rounded-2xl shadow-xl shadow-orange-500/30 transition-transform active:scale-95 text-lg uppercase tracking-wider"
          >
            Rejouer 🔄
          </button>
        </div>
      )}

      {/* Écran d'Erreur */}
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