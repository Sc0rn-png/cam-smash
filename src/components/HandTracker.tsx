import { useRef, useState, useEffect, useCallback } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { Heart, Play, HelpCircle, SkipForward, ArrowRight, RotateCcw, Smartphone } from 'lucide-react';

interface Point { x: number; y: number; }
interface Mine { x: number; y: number; radius: number; }
interface Particle { x: number; y: number; vx: number; vy: number; size: number; color: string; alpha: number; }

const PLAY_ZONE = { xMin: 0.1, xMax: 0.9, yMin: 0.2, yMax: 0.8 };

function generatePattern(numPoints: number): Point[] {
  const points: Point[] = [];
  const minDist = 0.22;
  let attempts = 0;
  while (points.length < numPoints && attempts < 300) {
    attempts++;
    const candidate: Point = {
      x: Number((0.15 + Math.random() * 0.7).toFixed(2)),
      y: Number((0.15 + Math.random() * 0.7).toFixed(2)),
    };
    const isFarEnough = points.every((p) => Math.hypot(p.x - candidate.x, p.y - candidate.y) >= minDist);
    if (isFarEnough) points.push(candidate);
  }
  if (points.length < numPoints) {
    const grid = [
      { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 },
      { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.2 }
    ];
    return grid.slice(0, numPoints);
  }
  return points;
}

const TIME_OVER_QUOTES = [
  "Le temps s'est écoulé! Tes réflexes aussi apparemment...",
  "Oof. La lenteur incarnée. Même un paresseux sous caféine va plus vite.",
  "Tic-tac, c'est fini! Tu cherchais encore tes doigts ou quoi?",
  "45 secondes pour faire ça ? Ma batterie se vide plus vite que ton score."
];

const MINE_QUOTES = [
  "BOOM! Félicitations, tu as réussi à toucher le seul truc qui brûle.",
  "Attention, ça pique! La mine n'était PAS un bonus de santé...",
  "Explosion totale! Tes doigts sont intacts, mais ton estime de toi a pris un coup.",
  "Je t'avais dit de pas toucher aux orbes spiky. La curiosité tue le joueur."
];

const HIGH_SCORE_QUOTES = [
  "NOUVEAU RECORD! Bon, c'est pas encore de l'art, mais c'est moins pire.",
  "Regardez-moi ça! Un record! Ne va pas choper la grosse tête non plus.",
  "Incroyable. Tu as battu ton propre score. L'univers en demeure stupéfait.",
  "Record pulvérisé ! Tu commences presque à ressembler à quelqu'un de compétent."
];

export default function HandTracker() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [currentScreen, setCurrentScreen] = useState<'home' | 'tuto' | 'playing'>('home');
  const [tutoStep, setTutoStep] = useState(1);
  const [gameState, setGameState] = useState<'idle' | 'loading' | 'playing' | 'gameover'>('idle');
  const [gameOverReason, setGameOverReason] = useState<'time' | 'mine'>('time');
  const [endQuote, setEndQuote] = useState('');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(45);
  const [lives, setLives] = useState(3);
  const [errorMsg, setErrorMsg] = useState('');
  const [bonusNotification, setBonusNotification] = useState<string | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);
  const [damagedHeartIndex, setDamagedHeartIndex] = useState<number | null>(null);

  const gameStateRef = useRef(gameState);
  const scoreRef = useRef(0);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const animationFrameId = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const currentPatternRef = useRef<Point[]>([]);
  const activeCheckpointRef = useRef<number>(0);
  const trailRef = useRef<Point[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const minesRef = useRef<Mine[]>([]);
  const shapesCompletedRef = useRef<number>(0);
  const lastAITimeRef = useRef<number>(0);
  const fingerPosRef = useRef<Point | null>(null);

  const setGameStateSync = (state: 'idle' | 'loading' | 'playing' | 'gameover') => {
    gameStateRef.current = state;
    setGameState(state);
  };

  // --- GESTION DU WAKE LOCK (ANTI-VEILLE) ---
  const requestWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator && (!wakeLockRef.current || wakeLockRef.current.released)) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      }
    } catch (err: any) {
      console.warn(`Wake Lock non disponible : ${err.message}`);
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current && !wakeLockRef.current.released) {
      await wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  }, []);

  // Maintient l'écran allumé quand le jeu est actif + réactive le Wake Lock lors du retour sur l'application
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && gameState === 'playing') {
        await requestWakeLock();
      }
    };

    if (gameState === 'playing') {
      requestWakeLock();
      document.addEventListener('visibilitychange', handleVisibilityChange);
    } else {
      releaseWakeLock();
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [gameState, requestWakeLock, releaseWakeLock]);

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const getLevelInfo = (currentScore: number) => {
    if (currentScore >= 600) return { level: 5, numPoints: 6, name: 'OVERDRIVE', color: '#ec4899', orbColor: '#f43f5e', ptsPerShape: 30, showGuide: false, numMines: 3 };
    if (currentScore >= 420) return { level: 4, numPoints: 5, name: 'MASTER', color: '#a855f7', orbColor: '#c084fc', ptsPerShape: 25, showGuide: false, numMines: 3 };
    if (currentScore >= 260) return { level: 3, numPoints: 5, name: 'EXPERT', color: '#ef4444', orbColor: '#f97316', ptsPerShape: 20, showGuide: false, numMines: 2 };
    if (currentScore >= 120) return { level: 2, numPoints: 4, name: 'AVANCE', color: '#f59e0b', orbColor: '#eab308', ptsPerShape: 15, showGuide: true, numMines: 2 };
    return { level: 1, numPoints: 3, name: 'NOVICE', color: '#06b6d4', orbColor: '#38bdf8', ptsPerShape: 10, showGuide: true, numMines: 1 };
  };

  const requestFullscreenMode = () => {
    const docEl = document.documentElement as any;
    if (docEl.requestFullscreen) {
      docEl.requestFullscreen().catch(() => {});
    } else if (docEl.webkitRequestFullscreen) {
      docEl.webkitRequestFullscreen().catch(() => {});
    }
  };

  useEffect(() => {
    const savedScore = localStorage.getItem('hyper_tracer_high_score');
    if (savedScore) setHighScore(parseInt(savedScore, 10));

    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      stopCameraStream();
    };
  }, []);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (gameState === 'playing' && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            handleGameOver('time');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [gameState, timeLeft]);

  const triggerExplosion = (x: number, y: number) => {
    const colors = ['#fef08a', '#f97316', '#ef4444', '#38bdf8'];
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 7 + 2;
      particlesRef.current.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: Math.random() * 5 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1.0,
      });
    }
  };

  const triggerGameOverImpact = (reason: 'time' | 'mine') => {
    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), 250);
    if (reason === 'mine' && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        for (let i = 0; i < 50; i++) {
          triggerExplosion(
            Math.random() * canvasRef.current.width,
            Math.random() * canvasRef.current.height
          );
        }
      }
    }
  };

  const handleGameOver = (reason: 'time' | 'mine') => {
    triggerGameOverImpact(reason);
    setGameOverReason(reason);
    setGameStateSync('gameover');

    const isNewRecord = scoreRef.current > highScore && scoreRef.current > 0;
    if (isNewRecord) {
      const q = HIGH_SCORE_QUOTES[Math.floor(Math.random() * HIGH_SCORE_QUOTES.length)];
      setEndQuote(q);
    } else if (reason === 'mine') {
      const q = MINE_QUOTES[Math.floor(Math.random() * MINE_QUOTES.length)];
      setEndQuote(q);
    } else {
      const q = TIME_OVER_QUOTES[Math.floor(Math.random() * TIME_OVER_QUOTES.length)];
      setEndQuote(q);
    }
  };

  const initCameraAndModel = async () => {
    if (streamRef.current && landmarkerRef.current) return true;
    setGameStateSync('loading');
    setErrorMsg('');
    try {
      stopCameraStream();
      if (!landmarkerRef.current) {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );
        landmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 1,
        });
      }
      if (!videoRef.current) throw new Error("Erreur élément vidéo");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => {
          video.play().then(() => resolve());
        };
      });
      return true;
    } catch (err: any) {
      console.error(err);
      setGameStateSync('idle');
      setErrorMsg('Accès caméra requis. Vérifie tes permissions.');
      return false;
    }
  };

  const zoneToScreen = (pt: Point, width: number, height: number): Point => {
    const zoneW = (PLAY_ZONE.xMax - PLAY_ZONE.xMin) * width;
    const zoneH = (PLAY_ZONE.yMax - PLAY_ZONE.yMin) * height;
    return {
      x: PLAY_ZONE.xMin * width + pt.x * zoneW,
      y: PLAY_ZONE.yMin * height + pt.y * zoneH,
    };
  };

  const spawnMines = (canvasWidth: number, canvasHeight: number, pattern: Point[], numMinesCount: number) => {
    const newMines: Mine[] = [];
    const minSafetyDist = 110;
    const patternScreenPoints = pattern.map((pt) => zoneToScreen(pt, canvasWidth, canvasHeight));
    let attempts = 0;
    while (newMines.length < numMinesCount && attempts < 200) {
      attempts++;
      const candidate: Mine = {
        x: PLAY_ZONE.xMin * canvasWidth + Math.random() * (PLAY_ZONE.xMax - PLAY_ZONE.xMin) * canvasWidth,
        y: PLAY_ZONE.yMin * canvasHeight + Math.random() * (PLAY_ZONE.yMax - PLAY_ZONE.yMin) * canvasHeight,
        radius: 20,
      };
      const isSafeFromOrbs = patternScreenPoints.every((orb) => Math.hypot(orb.x - candidate.x, orb.y - candidate.y) >= minSafetyDist);
      const isSafeFromOtherMines = newMines.every((m) => Math.hypot(m.x - candidate.x, m.y - candidate.y) >= 60);
      if (isSafeFromOrbs && isSafeFromOtherMines) {
        newMines.push(candidate);
      }
    }
    minesRef.current = newMines;
  };

  const spawnNewPattern = (numPoints: number, canvasWidth: number, canvasHeight: number, numMinesCount: number) => {
    const pattern = generatePattern(numPoints);
    currentPatternRef.current = pattern;
    activeCheckpointRef.current = 0;
    spawnMines(canvasWidth, canvasHeight, pattern, numMinesCount);
  };

  const startGame = () => {
    setScore(0);
    scoreRef.current = 0;
    setTimeLeft(45);
    setLives(3);
    shapesCompletedRef.current = 0;
    particlesRef.current = [];
    trailRef.current = [];
    const initialLvl = getLevelInfo(0);
    if (canvasRef.current) {
      spawnNewPattern(initialLvl.numPoints, canvasRef.current.width, canvasRef.current.height, initialLvl.numMines);
    }
    setGameStateSync('playing');
    if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    animationFrameId.current = requestAnimationFrame(renderLoop);
  };

  const launchGame = async () => {
    requestFullscreenMode();
    const isReady = await initCameraAndModel();
    if (!isReady) return;
    setCurrentScreen('playing');
    startGame();
  };

  const drawMine = (ctx: CanvasRenderingContext2D, mine: Mine) => {
    ctx.save();
    ctx.translate(mine.x, mine.y);
    const spikes = 8;
    ctx.fillStyle = '#ef4444';
    for (let i = 0; i < spikes; i++) {
      const angle = (i * Math.PI * 2) / spikes;
      ctx.save();
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, -mine.radius - 8);
      ctx.lineTo(-5, -mine.radius + 2);
      ctx.lineTo(5, -mine.radius + 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, mine.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#09090b';
    ctx.fill();
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#f87171';
    ctx.fill();
    ctx.restore();
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

      ctx.fillStyle = 'rgba(15, 23, 42, 0.70)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (now - lastAITimeRef.current > 20) {
        lastAITimeRef.current = now;
        const results = landmarker.detectForVideo(video, now);
        if (results.landmarks && results.landmarks[0]) {
          const indexTip = results.landmarks[0][8];
          if (indexTip) {
            const rawX = (1 - indexTip.x) * canvas.width;
            const rawY = indexTip.y * canvas.height;
            fingerPosRef.current = { x: rawX, y: rawY };
          }
        } else {
          fingerPosRef.current = null;
        }
      }

      const finger = fingerPosRef.current;

      if (gameStateRef.current === 'playing') {
        const pattern = currentPatternRef.current;
        const currentLvlInfo = getLevelInfo(scoreRef.current);

        if (pattern.length > 0 && currentLvlInfo.showGuide) {
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

        pattern.forEach((pt, idx) => {
          const pos = zoneToScreen(pt, canvas.width, canvas.height);
          const isCurrent = idx === activeCheckpointRef.current;
          const isPassed = idx < activeCheckpointRef.current;

          ctx.beginPath();
          ctx.arc(pos.x, pos.y, isCurrent ? 24 : 18, 0, Math.PI * 2);
          ctx.fillStyle = isPassed ? '#22c55e' : isCurrent ? currentLvlInfo.orbColor : 'rgba(30, 41, 59, 0.9)';
          ctx.fill();
          ctx.strokeStyle = isPassed ? '#86efac' : isCurrent ? '#ffffff' : '#64748b';
          ctx.lineWidth = isCurrent ? 3 : 2;
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.font = `bold ${isCurrent ? 16 : 13}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(idx + 1), pos.x, pos.y);
        });

        minesRef.current.forEach((mine) => drawMine(ctx, mine));

        if (finger) {
          trailRef.current.push({ x: finger.x, y: finger.y });
          if (trailRef.current.length > 25) trailRef.current.shift();

          if (trailRef.current.length > 1) {
            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            for (let i = 0; i < trailRef.current.length - 1; i++) {
              const p1 = trailRef.current[i];
              const p2 = trailRef.current[i + 1];
              const ratio = i / trailRef.current.length;

              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.strokeStyle = `rgba(239, 68, 68, ${ratio * 0.45})`;
              ctx.lineWidth = ratio * 32;
              ctx.stroke();

              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.strokeStyle = `rgba(249, 115, 22, ${ratio * 0.85})`;
              ctx.lineWidth = ratio * 16;
              ctx.stroke();

              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.strokeStyle = `rgba(254, 240, 138, ${ratio})`;
              ctx.lineWidth = ratio * 6;
              ctx.stroke();
            }
            ctx.restore();
          }

          for (let i = minesRef.current.length - 1; i >= 0; i--) {
            const mine = minesRef.current[i];
            const distToMine = Math.hypot(finger.x - mine.x, finger.y - mine.y);
            if (distToMine < mine.radius + 12) {
              setIsFlashing(true);
              setTimeout(() => setIsFlashing(false), 150);
              setLives((prevLives) => {
                const newLives = prevLives - 1;
                setDamagedHeartIndex(newLives);
                setTimeout(() => setDamagedHeartIndex(null), 500);
                if (newLives <= 0) {
                  handleGameOver('mine');
                }
                return newLives;
              });
              minesRef.current.splice(i, 1);
            }
          }

          const targetPt = pattern[activeCheckpointRef.current];
          if (targetPt) {
            const targetPos = zoneToScreen(targetPt, canvas.width, canvas.height);
            const dist = Math.hypot(finger.x - targetPos.x, finger.y - targetPos.y);
            if (dist < 28) {
              triggerExplosion(targetPos.x, targetPos.y);
              activeCheckpointRef.current += 1;

              if (activeCheckpointRef.current >= pattern.length) {
                shapesCompletedRef.current += 1;
                setScore((prevScore) => {
                  const newScore = prevScore + currentLvlInfo.ptsPerShape;
                  scoreRef.current = newScore;
                  if (newScore > highScore) {
                    setHighScore(newScore);
                    localStorage.setItem('hyper_tracer_high_score', newScore.toString());
                  }

                  const nextLvlInfo = getLevelInfo(newScore);
                  let shapesNeeded = 3;
                  let bonusAmount = 5;

                  if (nextLvlInfo.level >= 5) {
                    shapesNeeded = 2;
                    bonusAmount = 8;
                  } else if (nextLvlInfo.level === 4) {
                    shapesNeeded = 3;
                    bonusAmount = 8;
                  }

                  if (shapesCompletedRef.current % shapesNeeded === 0) {
                    setTimeLeft((t) => t + bonusAmount);
                    setBonusNotification(`+${bonusAmount}s`);
                    setTimeout(() => setBonusNotification(null), 800);
                  }

                  spawnNewPattern(nextLvlInfo.numPoints, canvas.width, canvas.height, nextLvlInfo.numMines);
                  return newScore;
                });
              }
            }
          }
        } else {
          if (trailRef.current.length > 0) trailRef.current.shift();
        }

        particlesRef.current = particlesRef.current.filter((p) => {
          p.x += p.vx;
          p.y += p.vy;
          p.alpha -= 0.03;
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

    if (gameStateRef.current === 'playing') {
      animationFrameId.current = requestAnimationFrame(renderLoop);
    }
  };

  const levelInfo = getLevelInfo(score);

  return (
    <div className="fixed inset-0 w-screen h-screen bg-slate-950 overflow-hidden select-none font-sans">
      <video ref={videoRef} className="hidden" playsInline autoPlay muted />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover" />

      {isFlashing && (
        <div className="absolute inset-0 bg-white z-50 pointer-events-none transition-opacity duration-150" />
      )}

      {/* PAGE D'ACCUEIL */}
      {currentScreen === 'home' && (
        <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-xl flex flex-col justify-between p-6 z-40 text-center">
          <div className="pt-10 space-y-3">
            <span className="text-[10px] font-black uppercase tracking-[0.3em] px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
              Motion Tracking Arcade
            </span>
            <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-500 to-red-500 tracking-tight uppercase drop-shadow-sm">
              HYPER TRACER
            </h1>
            <p className="text-sm font-semibold text-slate-300 leading-snug max-w-xs mx-auto">
              Tes doigts sont tes pinceaux.<br />
              Le vide est ton terrain de jeu.
            </p>
          </div>

          <div className="my-auto space-y-4 max-w-xs mx-auto w-full">
            {highScore > 0 && (
              <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-3 shadow-inner">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Meilleur Record</p>
                <p className="text-2xl font-black text-amber-400">{highScore} <span className="text-xs text-slate-500">PTS</span></p>
              </div>
            )}

            {errorMsg && (
              <div className="bg-red-500/10 border border-red-500/30 p-3 rounded-xl text-xs font-bold text-red-400">
                {errorMsg}
              </div>
            )}

            <button
              onClick={() => launchGame()}
              className="w-full py-4 bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 text-slate-950 font-black rounded-2xl shadow-xl shadow-orange-500/25 active:scale-95 transition-transform flex items-center justify-center gap-2 text-lg uppercase tracking-wider"
            >
              <Play className="w-5 h-5 fill-slate-950" /> JOUER DIRECT
            </button>

            <button
              onClick={() => {
                setTutoStep(1);
                setCurrentScreen('tuto');
              }}
              className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold rounded-2xl border border-white/10 active:scale-95 transition-transform flex items-center justify-center gap-2 text-sm"
            >
              <HelpCircle className="w-4 h-4 text-amber-400" /> Comment jouer ?
            </button>
          </div>

          <p className="pb-4 text-[11px] text-slate-500 font-medium">
            Propulsé par la caméra de ton smartphone
          </p>
        </div>
      )}

      {/* PAGE TUTORIEL */}
      {currentScreen === 'tuto' && (
        <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-xl flex flex-col justify-between p-6 z-40 text-center">
          <div className="flex justify-between items-center pt-2">
            <span className="text-xs font-black text-amber-400 tracking-widest uppercase">
              Étape {tutoStep} / 4
            </span>
            <button
              onClick={() => launchGame()}
              className="flex items-center gap-1 text-xs font-bold py-1.5 rounded-full bg-slate-900 text-slate-400 hover:text-white px-3 border border-white/10 active:scale-95"
            >
              Skip <SkipForward className="w-3 h-3" />
            </button>
          </div>

          <div className="my-auto max-w-xs mx-auto space-y-6">
            {tutoStep === 1 && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="relative w-24 h-24 mx-auto flex items-center justify-center">
                  <div className="absolute inset-0 bg-amber-500/10 rounded-full blur-xl animate-pulse" />
                  <div className="relative bg-slate-900 border border-slate-700 w-14 h-24 rounded-2xl flex flex-col items-center justify-between p-2 shadow-xl shadow-amber-500/10">
                    <div className="w-5 h-1 bg-slate-700 rounded-full mt-1" />
                    <Smartphone className="w-6 h-6 text-amber-400 opacity-90" strokeWidth={1.5} />
                    <div className="w-3 h-3 rounded-full border border-slate-700 mb-1" />
                  </div>
                </div>
                <h2 className="text-xl font-black text-white uppercase tracking-wide">
                  Positionne ton écran
                </h2>
                <p className="text-xs text-slate-300 font-medium leading-relaxed">
                  Pose ton téléphone face à toi<br />
                  à environ <span className="text-amber-400 font-bold">30 - 40 cm</span>.<br />
                  <span className="text-slate-500 text-[11px] font-semibold">(Ou tiens-le de l'autre main pour les braves)</span>
                </p>
              </div>
            )}

            {tutoStep === 2 && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="text-5xl bg-slate-900 border border-white/10 w-20 h-20 rounded-3xl flex items-center justify-center mx-auto shadow-xl">
                  ☝️
                </div>
                <h2 className="text-xl font-black text-white uppercase tracking-wide">
                  Prépare ta plume
                </h2>
                <p className="text-xs text-slate-300 font-medium leading-relaxed">
                  Lève ton <span className="text-amber-400 font-bold">index</span> vers la caméra.<br />
                  Si tu étais un artiste, <br />
                  ce serait ta plume numérique.
                </p>
              </div>
            )}

            {tutoStep === 3 && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="flex gap-4 mx-auto justify-center items-center h-20">
                  <div className="relative">
                    <div className="w-[36px] h-[36px] rounded-full bg-[#22c55e] border-2 border-[#86efac] flex items-center justify-center shadow-lg z-10 relative">
                      <span className="text-white text-[13px] font-bold">1</span>
                    </div>
                  </div>
                  <div className="w-[48px] h-[48px] rounded-full bg-[#38bdf8] border-[3px] border-white flex items-center justify-center shadow-[0_0_15px_#38bdf8] z-20">
                    <span className="text-white text-base font-bold">2</span>
                  </div>
                  <div className="relative">
                    <div className="w-[36px] h-[36px] rounded-full bg-[rgba(30,41,59,0.9)] border-2 border-[#64748b] flex items-center justify-center shadow-lg z-10 relative">
                      <span className="text-white text-[13px] font-bold">3</span>
                    </div>
                  </div>
                </div>
                <h2 className="text-xl font-black text-white uppercase tracking-wide">
                  Chasse aux orbes
                </h2>
                <p className="text-xs text-slate-300 font-medium leading-relaxed">
                  Relie un maximum d'<span className="text-[#38bdf8] font-bold">orbes de couleur</span><br />
                  dans l'ordre indiqué<br />
                  avant la fin du temps imparti.
                </p>
              </div>
            )}

            {tutoStep === 4 && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
                  <svg width="60" height="60" viewBox="-30 -30 60 60" className="drop-shadow-[0_0_15px_rgba(239,68,68,0.5)] animate-pulse">
                    <g fill="#ef4444">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <polygon key={i} points="0,-28 -5,-18 5,-18" transform={`rotate(${(i * 360) / 8})`} />
                      ))}
                    </g>
                    <circle cx="0" cy="0" r="20" fill="#09090b" stroke="#ef4444" strokeWidth="3" />
                    <circle cx="0" cy="0" r="5" fill="#f87171" />
                  </svg>
                </div>
                <h2 className="text-xl font-black text-red-500 uppercase tracking-wide">
                  Attention aux Pièges!
                </h2>
                <p className="text-xs text-slate-300 font-medium leading-relaxed">
                  Certaines orbes sont... <span className="text-red-400 font-bold">différentes</span>.<br />
                  Ne touche surtout pas aux mines spiky, <br />
                  sinon c'est l'explosion immédiate !
                </p>
              </div>
            )}
          </div>

          <div className="pb-4 max-w-xs mx-auto w-full">
            {tutoStep < 4 ? (
              <button
                onClick={() => setTutoStep((prev) => prev + 1)}
                className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-black rounded-2xl shadow-xl shadow-orange-500/20 active:scale-95 transition-transform flex items-center justify-center gap-2 text-sm uppercase tracking-wider"
              >
                Compris! <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={() => launchGame()}
                className="w-full py-4 bg-gradient-to-r from-emerald-400 to-teal-500 text-slate-950 font-black rounded-2xl shadow-xl shadow-emerald-500/30 active:scale-95 transition-transform flex items-center justify-center gap-2 text-base uppercase tracking-wider animate-bounce"
              >
                C'est parti !
              </button>
            )}
          </div>
        </div>
      )}

      {/* INTERFACE EN JEU */}
      {currentScreen === 'playing' && gameState !== 'gameover' && (
        <div className="absolute top-0 left-0 right-0 p-4 pt-6 flex flex-col items-center z-10 bg-gradient-to-b from-black/90 via-black/40 to-transparent pointer-events-none space-y-2">
          <div className="flex justify-between items-center w-full max-w-md px-2">
            <div className="flex flex-col items-start">
              <span
                className="text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full text-black shadow-md"
                style={{ backgroundColor: levelInfo.color }}
              >
                LVL {levelInfo.level}/5 {levelInfo.name}
              </span>
              <p className="text-3xl font-black text-white mt-1 drop-shadow-md">
                {score} <span className="text-xs text-slate-400 font-bold">PTS</span>
              </p>
            </div>

            <div className="relative flex flex-col items-center">
              <span className="text-[10px] text-slate-300 font-extrabold uppercase tracking-widest">CHRONO</span>
              <p className={`text-4xl font-black transition-transform ${timeLeft <= 10 ? 'text-red-500 animate-ping' : 'text-amber-400'}`}>
                {timeLeft}s
              </p>
              {bonusNotification && (
                <span className="absolute -bottom-6 text-xl font-black text-green-400 animate-bounce drop-shadow-[0_0_10px_rgba(74,222,128,0.8)]">
                  {bonusNotification}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
              {[0, 1, 2].map((index) => {
                const isAlive = index < lives;
                const isExploding = damagedHeartIndex === index;
                return (
                  <Heart
                    key={index}
                    className={`w-6 h-6 transition-all duration-300 ${
                      isAlive
                        ? 'text-red-500 fill-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.8)]'
                        : 'text-slate-700 fill-slate-900 opacity-30 scale-90'
                    } ${isExploding ? 'animate-ping text-white fill-white scale-150' : ''}`}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ÉCRAN GAME OVER */}
      {gameState === 'gameover' && (
        <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 z-40 text-center animate-in fade-in duration-300">
          <div className="space-y-4 mb-8">
            <h2 className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-500 uppercase tracking-tight">
              GAME OVER
            </h2>
            <p className="text-sm font-semibold text-slate-400 max-w-xs mx-auto italic px-4">
              "{endQuote}"
            </p>
          </div>

          <div className="bg-slate-900/50 border border-white/10 rounded-3xl p-8 mb-10 w-full max-w-xs space-y-6 shadow-2xl">
            <div>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Score Final</p>
              <p className="text-5xl font-black text-white">{score} <span className="text-lg text-slate-500">PTS</span></p>
            </div>

            <div className="h-px w-full bg-white/10" />

            <div>
              <p className="text-[10px] font-black text-amber-500/50 uppercase tracking-widest mb-1">Meilleur Score</p>
              <p className="text-2xl font-black text-amber-400">{highScore} <span className="text-xs text-amber-500/50">PTS</span></p>
            </div>
          </div>

          <div className="space-y-3 w-full max-w-xs">
            <button
              onClick={() => startGame()}
              className="w-full py-4 bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 text-slate-950 font-black rounded-2xl shadow-xl shadow-orange-500/25 active:scale-95 transition-transform flex items-center justify-center gap-2 text-lg uppercase tracking-wider"
            >
              <RotateCcw className="w-5 h-5 stroke-[2.5]" /> REJOUER
            </button>
            <button
              onClick={() => {
                setCurrentScreen('home');
                setGameStateSync('idle');
              }}
              className="w-full py-3 bg-transparent text-slate-400 font-bold rounded-2xl active:scale-95 transition-transform text-sm uppercase tracking-wide hover:text-white"
            >
              Menu Principal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}