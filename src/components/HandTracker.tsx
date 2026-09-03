import { useRef, useState, useEffect } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { Heart } from 'lucide-react';

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
      { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.5, y: 0.5 },
      { x: 0.2, y: 0.8 }, { x: 0.8, y: 0.8 }, { x: 0.5, y: 0.2 }
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

  // Niveaux avec thèmes de couleurs uniques pour les orbes
  const getLevelInfo = (currentScore: number) => {
    if (currentScore >= 600) {
      return { 
        level: 5, numPoints: 6, name: 'OVERDRIVE', color: '#ec4899', orbColor: '#f43f5e', 
        ptsPerShape: 30, showGuide: false, numMines: 3 
      };
    }
    if (currentScore >= 420) {
      return { 
        level: 4, numPoints: 5, name: 'MASTER', color: '#a855f7', orbColor: '#c084fc', 
        ptsPerShape: 25, showGuide: false, numMines: 3 
      };
    }
    if (currentScore >= 260) {
      return { 
        level: 3, numPoints: 5, name: 'EXPERT', color: '#ef4444', orbColor: '#f97316', 
        ptsPerShape: 20, showGuide: false, numMines: 2 
      };
    }
    if (currentScore >= 120) {
      return { 
        level: 2, numPoints: 4, name: 'AVANCÉ', color: '#f59e0b', orbColor: '#eab308', 
        ptsPerShape: 15, showGuide: true, numMines: 2 
      };
    }
    return { 
      level: 1, numPoints: 3, name: 'NOVICE', color: '#06b6d4', orbColor: '#38bdf8', 
      ptsPerShape: 10, showGuide: true, numMines: 1 
    };
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

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
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

  // Plein écran automatique au démarrage
  const forceFullscreen = () => {
    const docEl = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    if (docEl.requestFullscreen) {
      docEl.requestFullscreen().catch(() => {});
    } else if (docEl.webkitRequestFullscreen) {
      docEl.webkitRequestFullscreen().catch(() => {});
    }
  };

  const closeTutorial = () => {
    localStorage.setItem('hyper_tracer_tuto_seen', 'true');
    setShowTutorial(false);
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
    const patternScreenPoints = pattern.map(pt => zoneToScreen(pt, canvasWidth, canvasHeight));

    let attempts = 0;
    while (newMines.length < numMinesCount && attempts < 200) {
      attempts++;
      const candidate: Mine = {
        x: PLAY_ZONE.xMin * canvasWidth + Math.random() * (PLAY_ZONE.xMax - PLAY_ZONE.xMin) * canvasWidth,
        y: PLAY_ZONE.yMin * canvasHeight + Math.random() * (PLAY_ZONE.yMax - PLAY_ZONE.yMin) * canvasHeight,
        radius: 20,
      };

      const isSafeFromOrbs = patternScreenPoints.every(
        (orb) => Math.hypot(orb.x - candidate.x, orb.y - candidate.y) >= minSafetyDist
      );

      const isSafeFromOtherMines = newMines.every(
        (m) => Math.hypot(m.x - candidate.x, m.y - candidate.y) >= 60
      );

      if (isSafeFromOrbs && isSafeFromOtherMines) {
        newMines.push(candidate);
      }
    }
    minesRef.current = newMines;
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

  const triggerExplosion = (x: number, y: number) => {
    const colors = ['#fef08a', '#f97316', '#ef4444', '#38bdf8'];
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 7 + 2;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: Math.random() * 5 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1.0,
      });
    }
  };

  const spawnNewPattern = (numPoints: number, canvasWidth: number, canvasHeight: number, numMinesCount: number) => {
    const pattern = generatePattern(numPoints);
    currentPatternRef.current = pattern;
    activeCheckpointRef.current = 0;
    spawnMines(canvasWidth, canvasHeight, pattern, numMinesCount);
  };

  const startCameraAndGame = async () => {
    forceFullscreen();
    if (showTutorial) closeTutorial();
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
    } catch (err) {
      console.error(err);
      setGameStateSync('idle');
      setErrorMsg('Accès caméra refusé ou indisponible.');
    }
  };

  const startGame = () => {
    forceFullscreen();
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
          
          // Couleur dynamique selon le niveau !
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
                  setGameStateSync('gameover');
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

                  if (shapesCompletedRef.current % 3 === 0) {
                    setTimeLeft((t) => t + 5);
                    setBonusNotification('+5s');
                    setTimeout(() => setBonusNotification(null), 800);
                  }

                  const nextLvlInfo = getLevelInfo(newScore);
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

      {isFlashing && <div className="absolute inset-0 bg-black z-50 pointer-events-none" />}

      <div className="absolute top-0 left-0 right-0 p-4 pt-6 flex flex-col items-center z-10 bg-gradient-to-b from-black/90 via-black/40 to-transparent pointer-events-none space-y-2">
        <div className="flex justify-between items-center w-full max-w-md px-2">
          <div className="flex flex-col items-start">
            <span
              className="text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full text-black shadow-md"
              style={{ backgroundColor: levelInfo.color }}
            >
              LVL {levelInfo.level}/5 • {levelInfo.name}
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

        {gameState === 'playing' && (
          <div className="bg-black/60 border border-white/10 backdrop-blur-md px-4 py-1 rounded-full text-center">
            <p className="text-xs font-bold text-slate-200">
              {levelInfo.numPoints} orbes • <span className="text-amber-400">+5s / 3 formes</span>
              {!levelInfo.showGuide && <span className="text-red-400 ml-1.5">(Guide désactivé)</span>}
            </p>
          </div>
        )}
      </div>

      {showTutorial && (
        <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center z-30 space-y-6">
          <div className="max-w-sm space-y-4">
            <div className="inline-block bg-amber-500/20 text-amber-400 border border-amber-500/30 px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest">
              Règles du Jeu
            </div>

            <h2 className="text-3xl font-black text-white">Hyper Tracer ⚡</h2>

            <div className="space-y-3 text-left">
              <div className="flex items-center space-x-3 bg-white/5 p-3 rounded-xl border border-white/10">
                <span className="text-2xl">☝️</span>
                <p className="text-xs text-slate-200">
                  Relie les orbes numérotées <b>(1 ➔ 2 ➔ 3...)</b> avec ton index.
                </p>
              </div>

              <div className="flex items-center space-x-3 bg-white/5 p-3 rounded-xl border border-white/10">
                <span className="text-2xl">💣</span>
                <p className="text-xs text-slate-200">
                  Évite les <b>mines rouges</b> (jamais placées sur les orbes).
                </p>
              </div>
            </div>

            <button
              onClick={startCameraAndGame}
              className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black rounded-2xl shadow-xl shadow-orange-500/30 text-base uppercase tracking-wider transition-transform active:scale-95"
            >
              C'est parti ! 🚀
            </button>
          </div>
        </div>
      )}

      {gameState === 'idle' && !showTutorial && (
        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-lg flex flex-col items-center justify-center p-6 text-center z-20">
          <div className="max-w-xs space-y-6">
            <div className="inline-block bg-gradient-to-r from-orange-500 to-amber-400 p-3.5 rounded-2xl shadow-xl shadow-orange-500/20">
              <span className="text-4xl">🔥</span>
            </div>
            <h1 className="text-4xl font-black text-white tracking-tight">HYPER TRACER</h1>
            <p className="text-sm text-slate-300 font-medium leading-relaxed">
              Vise avec ton index et bats le chrono à travers les niveaux !
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
                Tutoriel
              </button>
            </div>
          </div>
        </div>
      )}

      {gameState === 'loading' && (
        <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center z-20 space-y-4">
          <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs font-black text-amber-300 tracking-widest uppercase">LANCEMENT DE LA CAMÉRA...</p>
        </div>
      )}

      {gameState === 'gameover' && (
        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-20 space-y-6">
          <div className="space-y-2">
            <h2 className="text-3xl font-black text-red-500 uppercase tracking-wider">GAME OVER</h2>
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