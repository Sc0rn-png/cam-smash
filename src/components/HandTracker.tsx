import { useRef, useState, useEffect } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

interface Point {
  x: number;
  y: number;
}

interface TrailPoint {
  x: number;
  y: number;
  time: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
}

const PLAY_ZONE = {
  xMin: 0.1,
  xMax: 0.9,
  yMin: 0.22,
  yMax: 0.70,
};

function generatePattern(numPoints: number): Point[] {
  const points: Point[] = [];
  const minDist = 0.3;
  let attempts = 0;

  while (points.length < numPoints && attempts < 250) {
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

    if (isFarEnough) points.push(candidate);
  }

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
  const [showTutorial, setShowTutorial] = useState(false);
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
  const trailRef = useRef<TrailPoint[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const lastAITimeRef = useRef<number>(0);
  const fingerPosRef = useRef<Point | null>(null);

  const setGameStateSync = (state: 'idle' | 'loading' | 'playing' | 'gameover') => {
    gameStateRef.current = state;
    setGameState(state);
  };

  const getLevelInfo = (currentScore: number) => {
    if (currentScore >= 400) {
      return { level: 3, numPoints: 5, timeBonus: 6, name: 'OVERDRIVE', color: '#ec4899', ptsPerShape: 25 };
    }
    if (currentScore >= 200) {
      return { level: 2, numPoints: 4, timeBonus: 8, name: 'EXPERT', color: '#f59e0b', ptsPerShape: 15 };
    }
    return { level: 1, numPoints: 3, timeBonus: 10, name: 'NOVICE', color: '#06b6d4', ptsPerShape: 10 };
  };

  useEffect(() => {
    const savedScore = localStorage.getItem('hyper_tracer_high_score');
    if (savedScore) setHighScore(parseInt(savedScore, 10));

    const tutoSeen = localStorage.getItem('hyper_tracer_tuto_seen');
    if (!tutoSeen) setShowTutorial(true);

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

  const closeTutorial = () => {
    localStorage.setItem('hyper_tracer_tuto_seen', 'true');
    setShowTutorial(false);
  };

  const enableFullScreenAndWakeLock = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen().catch(() => {});
      }
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      }
    } catch (err) {
      console.warn('Screen setup warn:', err);
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

  const triggerExplosion = (x: number, y: number) => {
    const colors = ['#ffffff', '#fef08a', '#f97316', '#ef4444'];
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 9 + 3;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: Math.random() * 6 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1.0,
      });
    }
  };

  const spawnNewPattern = (numPoints: number) => {
    currentPatternRef.current = generatePattern(numPoints);
    activeCheckpointRef.current = 0;
  };

  const startCameraAndGame = async () => {
    if (showTutorial) closeTutorial();
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
      setGameStateSync('idle');
      setErrorMsg('Accès caméra refusé ou indisponible.');
    }
  };

  const startGame = () => {
    setScore(0);
    setTimeLeft(60);
    particlesRef.current = [];
    trailRef.current = [];
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
      // Arrière-plan caméra
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      // Voile sombre
      ctx.fillStyle = 'rgba(10, 15, 30, 0.70)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Traitement IA
      if (now - lastAITimeRef.current > 20) {
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
        const currentLvlInfo = getLevelInfo(score);

        // 1. Lignes guides (Lvl 1 uniquement)
        if (pattern.length > 0 && currentLvlInfo.level === 1) {
          ctx.beginPath();
          pattern.forEach((pt, idx) => {
            const pos = zoneToScreen(pt, canvas.width, canvas.height);
            if (idx === 0) ctx.moveTo(pos.x, pos.y);
            else ctx.lineTo(pos.x, pos.y);
          });
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.lineWidth = 4;
          ctx.setLineDash([8, 8]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // 2. Points numérotés
        pattern.forEach((pt, idx) => {
          const pos = zoneToScreen(pt, canvas.width, canvas.height);
          const isCurrent = idx === activeCheckpointRef.current;
          const isPassed = idx < activeCheckpointRef.current;

          ctx.beginPath();
          ctx.arc(pos.x, pos.y, isCurrent ? 24 : 18, 0, Math.PI * 2);
          ctx.fillStyle = isPassed
            ? '#22c55e'
            : isCurrent
            ? '#f59e0b'
            : 'rgba(30, 41, 59, 0.9)';
          ctx.fill();

          ctx.strokeStyle = isPassed ? '#86efac' : isCurrent ? '#fef08a' : '#64748b';
          ctx.lineWidth = isCurrent ? 3 : 2;
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.font = `bold ${isCurrent ? 16 : 13}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(idx + 1), pos.x, pos.y);
        });

        // 3. TRAÎNÉE FLAMME/PLASMA INCANDESCENTE
        if (finger) {
          const nowTime = performance.now();
          trailRef.current.push({ x: finger.x, y: finger.y, time: nowTime });

          // Conserver 350 ms de mémoire de mouvement
          trailRef.current = trailRef.current.filter((p) => nowTime - p.time < 350);

          // Étincelles volatiles
          if (Math.random() < 0.6) {
            particlesRef.current.push({
              x: finger.x + (Math.random() - 0.5) * 12,
              y: finger.y + (Math.random() - 0.5) * 12,
              vx: (Math.random() - 0.5) * 2,
              vy: -Math.random() * 2 - 0.5,
              size: Math.random() * 4 + 2,
              color: ['#fef08a', '#f97316', '#ef4444'][Math.floor(Math.random() * 3)],
              alpha: 1.0,
            });
          }

          if (trailRef.current.length > 1) {
            ctx.save();
            // Fusion de couleurs néon
            ctx.globalCompositeOperation = 'lighter';

            // COUCHE 1 : Halo externe rouge/orange large
            ctx.beginPath();
            for (let i = 0; i < trailRef.current.length - 1; i++) {
              const p1 = trailRef.current[i];
              const p2 = trailRef.current[i + 1];
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
            }
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.65)';
            ctx.lineWidth = 28;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();

            // COUCHE 2 : Cœur jaune incandescent
            ctx.beginPath();
            for (let i = 0; i < trailRef.current.length - 1; i++) {
              const p1 = trailRef.current[i];
              const p2 = trailRef.current[i + 1];
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
            }
            ctx.strokeStyle = 'rgba(254, 240, 138, 0.85)';
            ctx.lineWidth = 14;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();

            // COUCHE 3 : Fil central blanc intense
            ctx.beginPath();
            for (let i = 0; i < trailRef.current.length - 1; i++) {
              const p1 = trailRef.current[i];
              const p2 = trailRef.current[i + 1];
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
            }
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 4;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();

            // Orbe de lumière au bout du doigt
            const grad = ctx.createRadialGradient(finger.x, finger.y, 2, finger.x, finger.y, 24);
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(0.3, '#fef08a');
            grad.addColorStop(0.7, '#f97316');
            grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(finger.x, finger.y, 24, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
          }

          // Validation du checkpoint (28px max)
          const targetPt = pattern[activeCheckpointRef.current];
          if (targetPt) {
            const targetPos = zoneToScreen(targetPt, canvas.width, canvas.height);
            const dist = Math.hypot(finger.x - targetPos.x, finger.y - targetPos.y);

            if (dist < 28) {
              triggerExplosion(targetPos.x, targetPos.y);
              activeCheckpointRef.current += 1;

              if (activeCheckpointRef.current >= pattern.length) {
                setScore((prevScore) => {
                  const newScore = prevScore + currentLvlInfo.ptsPerShape;
                  if (newScore > highScore) {
                    setHighScore(newScore);
                    localStorage.setItem('hyper_tracer_high_score', newScore.toString());
                  }

                  const nextLvlInfo = getLevelInfo(newScore);
                  setTimeLeft((t) => t + nextLvlInfo.timeBonus);

                  setBonusNotification(`+${nextLvlInfo.timeBonus}s`);
                  setTimeout(() => setBonusNotification(null), 800);

                  spawnNewPattern(nextLvlInfo.numPoints);
                  return newScore;
                });
              }
            }
          }
        } else {
          trailRef.current = [];
        }

        // 4. Rendu des particules d'explosion
        particlesRef.current = particlesRef.current.filter((p) => {
          p.x += p.vx;
          p.y += p.vy;
          p.alpha -= 0.04;

          if (p.alpha <= 0) return false;

          ctx.save();
          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.fill();
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

      {/* HUD Supérieur */}
      <div className="absolute top-0 left-0 right-0 p-4 pt-6 flex flex-col items-center z-10 bg-gradient-to-b from-black/90 via-black/40 to-transparent pointer-events-none space-y-2">
        <div className="flex justify-between items-center w-full max-w-md px-2">
          {/* Badge Niveau */}
          <div className="flex flex-col items-start">
            <span
              className="text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full text-black shadow-md"
              style={{ backgroundColor: levelInfo.color }}
            >
              LVL {levelInfo.level} • {levelInfo.name}
            </span>
            <p className="text-3xl font-black text-white mt-1 drop-shadow-md">
              {score} <span className="text-xs text-slate-400 font-bold">PTS</span>
            </p>
          </div>

          {/* Chrono */}
          <div className="relative flex flex-col items-center">
            <span className="text-[10px] text-slate-300 font-extrabold uppercase tracking-widest">CHRONO</span>
            <p
              className={`text-4xl font-black transition-transform ${
                timeLeft <= 10 ? 'text-red-500 animate-ping' : 'text-amber-400'
              }`}
            >
              {timeLeft}s
            </p>

            {bonusNotification && (
              <span className="absolute -bottom-6 text-xl font-black text-green-400 animate-bounce drop-shadow-[0_0_10px_rgba(74,222,128,0.8)]">
                {bonusNotification}
              </span>
            )}
          </div>

          {/* Record */}
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest">RECORD</span>
            <p className="text-3xl font-black text-emerald-400 drop-shadow-md">{highScore}</p>
          </div>
        </div>

        {gameState === 'playing' && (
          <div className="bg-black/60 border border-white/10 backdrop-blur-md px-4 py-1 rounded-full text-center">
            <p className="text-xs font-bold text-slate-200">
              {levelInfo.numPoints} points • <span className="text-green-400">+{levelInfo.timeBonus}s par forme</span>
              {levelInfo.level > 1 && <span className="text-amber-400 ml-1">(Sans guide)</span>}
            </p>
          </div>
        )}
      </div>

      {/* MODAL TUTORIEL */}
      {showTutorial && (
        <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center z-30 space-y-6">
          <div className="max-w-sm space-y-4">
            <div className="inline-block bg-amber-500/20 text-amber-400 border border-amber-500/30 px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest">
              Comment jouer ?
            </div>

            <h2 className="text-3xl font-black text-white">Règles Rapides ⚡</h2>

            <div className="space-y-3 text-left">
              <div className="flex items-center space-x-3 bg-white/5 p-3 rounded-xl border border-white/10">
                <span className="text-2xl">☝️</span>
                <p className="text-xs text-slate-200">
                  Relie les points numérotés <b>dans l'ordre (1 ➔ 2 ➔ 3)</b> avec ton index.
                </p>
              </div>

              <div className="flex items-center space-x-3 bg-white/5 p-3 rounded-xl border border-white/10">
                <span className="text-2xl">⏱️</span>
                <p className="text-xs text-slate-200">
                  Chaque forme complétée t'accorde des <b>secondes de bonus</b> au chrono.
                </p>
              </div>

              <div className="flex items-center space-x-3 bg-white/5 p-3 rounded-xl border border-white/10">
                <span className="text-2xl">🙈</span>
                <p className="text-xs text-slate-200">
                  <b>Attention :</b> Dès le Niveau 2 (200 pts), les tracés de guide disparaissent !
                </p>
              </div>
            </div>

            <button
              onClick={startCameraAndGame}
              className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black rounded-2xl shadow-xl shadow-orange-500/30 text-base uppercase tracking-wider transition-transform active:scale-95"
            >
              C'est compris ! 🚀
            </button>
          </div>
        </div>
      )}

      {/* ÉCRAN D'ACCUEIL */}
      {gameState === 'idle' && !showTutorial && (
        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-lg flex flex-col items-center justify-center p-6 text-center z-20">
          <div className="max-w-xs space-y-6">
            <div className="inline-block bg-gradient-to-r from-orange-500 to-amber-400 p-3.5 rounded-2xl shadow-xl shadow-orange-500/20">
              <span className="text-4xl">🔥</span>
            </div>
            <h1 className="text-4xl font-black text-white tracking-tight">HYPER TRACER</h1>
            <p className="text-sm text-slate-300 font-medium leading-relaxed">
              Pointe ton index vers la caméra et relie les checkpoints le plus vite possible !
            </p>

            {errorMsg && <p className="text-xs font-bold text-red-400">{errorMsg}</p>}

            <div className="space-y-3">
              <button
                onClick={startCameraAndGame}
                className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black rounded-2xl shadow-xl shadow-orange-500/30 transition-transform active:scale-95 text-lg uppercase tracking-wider"
              >
                Jouer 🚀
              </button>

              <button
                onClick={() => setShowTutorial(true)}
                className="text-xs font-bold text-slate-400 hover:text-white underline tracking-wider uppercase"
              >
                Revoir le tuto
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CHARGEMENT */}
      {gameState === 'loading' && (
        <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center z-20 space-y-4">
          <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs font-black text-amber-300 tracking-widest uppercase">INITIALISATION CAPTEUR...</p>
        </div>
      )}

      {/* GAME OVER */}
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
    </div>
  );
}