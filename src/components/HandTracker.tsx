import React, { useEffect, useRef, useState } from 'react';
import { Heart, Maximize2, Play, RotateCcw, ShieldAlert } from 'lucide-react';

interface Point {
  x: number;
  y: number;
}

interface Mine {
  x: number;
  y: number;
  radius: number;
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

export const HandTracker: React.FC = () => {
  // États de jeu
  const [gameState, setGameState] = useState<'START' | 'PLAYING' | 'GAMEOVER'>('START');
  const [timeLeft, setTimeLeft] = useState<number>(45);
  const [lives, setLives] = useState<number>(3);
  const [score, setScore] = useState<number>(0);
  const [highScore, setHighScore] = useState<number>(0);
  const [shapesCount, setShapesCount] = useState<number>(0);
  const [bonusNotification, setBonusNotification] = useState<string | null>(null);
  const [isFlashing, setIsFlashing] = useState<boolean>(false);
  const [damagedHeartIndex, setDamagedHeartIndex] = useState<number | null>(null);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trailRef = useRef<Point[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const minesRef = useRef<Mine[]>([]);
  const patternRef = useRef<Point[]>([]);
  const activeCheckpointRef = useRef<number>(0);
  const shapesCompletedRef = useRef<number>(0);
  const simulatedFingerRef = useRef<Point | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Chargement du meilleur score
  useEffect(() => {
    const saved = localStorage.getItem('hyper_tracer_high_score');
    if (saved) setHighScore(parseInt(saved, 10));
  }, []);

  // --- 1. FONCTION DE PLEIN ÉCRAN SÉCURISÉE ---
  const toggleFullscreen = () => {
    try {
      if (!document.fullscreenElement) {
        if (containerRef.current?.requestFullscreen) {
          containerRef.current.requestFullscreen().catch((err) => {
            console.warn("Plein écran non disponible ou refusé par le navigateur:", err);
          });
        }
      }
    } catch (e) {
      console.warn("Erreur Fullscreen API:", e);
    }
  };

  // --- 2. GESTION DU TEMPS ---
  useEffect(() => {
    if (gameState !== 'PLAYING') return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          setGameState('GAMEOVER');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [gameState]);

  // --- 3. GÉNÉRATION DES MOTIFS & MINES ---
  const generatePattern = (width: number, height: number): Point[] => {
    const points: Point[] = [];
    const count = 4 + Math.floor(Math.random() * 2);
    const margin = 120;

    for (let i = 0; i < count; i++) {
      points.push({
        x: margin + Math.random() * (width - margin * 2),
        y: margin + Math.random() * (height - margin * 2),
      });
    }
    return points;
  };

  const spawnMines = (width: number, height: number, patternPoints: Point[]) => {
    const newMines: Mine[] = [];
    const numMines = Math.floor(Math.random() * 2) + 1; // 1 ou 2 mines par forme

    for (let i = 0; i < numMines; i++) {
      let x = 0, y = 0, safe = false;
      let attempts = 0;

      while (!safe && attempts < 20) {
        x = 100 + Math.random() * (width - 200);
        y = 100 + Math.random() * (height - 200);
        attempts++;

        // Vérifier qu'elle n'est pas trop proche des cibles
        safe = patternPoints.every(pt => Math.hypot(pt.x - x, pt.y - y) > 90);
      }

      newMines.push({ x, y, radius: 20 });
    }
    minesRef.current = newMines;
  };

  const spawnNewShape = () => {
    if (!canvasRef.current) return;
    const w = canvasRef.current.width;
    const h = canvasRef.current.height;

    patternRef.current = generatePattern(w, h);
    activeCheckpointRef.current = 0;
    spawnMines(w, h, patternRef.current);
  };

  // --- 4. DÉMARRAGE DU JEU ---
  const startGame = () => {
    setTimeLeft(45);
    setLives(3);
    setScore(0);
    setShapesCount(0);
    shapesCompletedRef.current = 0;
    trailRef.current = [];
    particlesRef.current = [];

    if (canvasRef.current) {
      canvasRef.current.width = window.innerWidth;
      canvasRef.current.height = window.innerHeight;
      spawnNewShape();
    }

    setGameState('PLAYING');
  };

  // --- 5. EFFETS ET PARTICULES ---
  const triggerExplosion = (x: number, y: number) => {
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 6 + 2;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: Math.random() * 5 + 2,
        color: '#fef08a',
        alpha: 1.0,
      });
    }
  };

  // --- 6. DESSIN DE LA MINE ---
  const drawMine = (ctx: CanvasRenderingContext2D, mine: Mine) => {
    ctx.save();
    ctx.translate(mine.x, mine.y);

    // Piques rouges
    const spikes = 8;
    ctx.fillStyle = '#ef4444';
    for (let i = 0; i < spikes; i++) {
      const angle = (i * Math.PI * 2) / spikes;
      ctx.save();
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, -mine.radius - 8);
      ctx.lineTo(-6, -mine.radius + 2);
      ctx.lineTo(6, -mine.radius + 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Corps central (Noir)
    ctx.beginPath();
    ctx.arc(0, 0, mine.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#09090b';
    ctx.fill();
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Cœur clignotant
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#f87171';
    ctx.fill();

    ctx.restore();
  };

  // --- 7. BOUCLE DE RENDU PRINCIPALE ---
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    // Simulation de la souris/touch pour tester le doigt
    const handlePointerMove = (e: PointerEvent) => {
      simulatedFingerRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', handlePointerMove);

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Nettoyage fond
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (gameState === 'PLAYING') {
        const finger = simulatedFingerRef.current;
        const pattern = patternRef.current;
        const activeIdx = activeCheckpointRef.current;

        // A. DESSIN DU MOTIF DE CIBLES
        if (pattern.length > 0) {
          ctx.beginPath();
          ctx.moveTo(pattern[0].x, pattern[0].y);
          for (let i = 1; i < pattern.length; i++) {
            ctx.lineTo(pattern[i].x, pattern[i].y);
          }
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
          ctx.lineWidth = 4;
          ctx.setLineDash([8, 8]);
          ctx.stroke();
          ctx.setLineDash([]);

          // Points de passage
          pattern.forEach((pt, idx) => {
            const isActive = idx === activeIdx;
            const isPassed = idx < activeIdx;

            ctx.beginPath();
            ctx.arc(pt.x, pt.y, isActive ? 22 : 14, 0, Math.PI * 2);
            ctx.fillStyle = isPassed ? '#22c55e' : isActive ? '#3b82f6' : '#3f3f46';
            ctx.fill();
            ctx.strokeStyle = isActive ? '#93c5fd' : '#18181b';
            ctx.lineWidth = 3;
            ctx.stroke();
          });
        }

        // B. DESSIN DES MINES
        minesRef.current.forEach((mine) => drawMine(ctx, mine));

        // C. TRAÎNÉE DE FLAMME MULTI-COUCHE DU DOIGT
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

              // Couche 1: Halo Rouge
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.strokeStyle = `rgba(239, 68, 68, ${ratio * 0.45})`;
              ctx.lineWidth = ratio * 34;
              ctx.stroke();

              // Couche 2: Corps Orange
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.strokeStyle = `rgba(249, 115, 22, ${ratio * 0.85})`;
              ctx.lineWidth = ratio * 18;
              ctx.stroke();

              // Couche 3: Cœur Jaune/Blanc
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.strokeStyle = `rgba(254, 240, 138, ${ratio})`;
              ctx.lineWidth = ratio * 7;
              ctx.stroke();
            }
            ctx.restore();

            // Étincelles volatiles
            if (Math.random() < 0.6) {
              particlesRef.current.push({
                x: finger.x + (Math.random() - 0.5) * 10,
                y: finger.y + (Math.random() - 0.5) * 10,
                vx: (Math.random() - 0.5) * 3,
                vy: (Math.random() - 0.5) * 3 - 1,
                size: Math.random() * 4 + 2,
                color: Math.random() > 0.5 ? '#fef08a' : '#f97316',
                alpha: 1.0,
              });
            }
          }

          // --- DETECT COLLISION AVEC LES MINES ---
          for (let i = minesRef.current.length - 1; i >= 0; i--) {
            const mine = minesRef.current[i];
            const dist = Math.hypot(finger.x - mine.x, finger.y - mine.y);

            if (dist < mine.radius + 12) {
              // Flash Noir
              setIsFlashing(true);
              setTimeout(() => setIsFlashing(false), 150);

              // Dégâts Vies & Animation Cœur
              setLives((prev) => {
                const newLives = prev - 1;
                setDamagedHeartIndex(newLives);
                setTimeout(() => setDamagedHeartIndex(null), 500);

                if (newLives <= 0) {
                  setGameState('GAMEOVER');
                }
                return newLives;
              });

              // Détruire la mine
              minesRef.current.splice(i, 1);
            }
          }

          // --- VALIDATION DES POINTS CIBLES ---
          const currentTarget = pattern[activeIdx];
          if (currentTarget) {
            const distToTarget = Math.hypot(finger.x - currentTarget.x, finger.y - currentTarget.y);
            if (distToTarget < 28) {
              triggerExplosion(currentTarget.x, currentTarget.y);
              activeCheckpointRef.current += 1;

              // Forme terminée !
              if (activeCheckpointRef.current >= pattern.length) {
                shapesCompletedRef.current += 1;
                setShapesCount(shapesCompletedRef.current);

                // Calcul du score
                setScore((prevScore) => {
                  const newScore = prevScore + 100;
                  if (newScore > highScore) {
                    setHighScore(newScore);
                    localStorage.setItem('hyper_tracer_high_score', newScore.toString());
                  }
                  return newScore;
                });

                // BONUS SEULEMENT TOUTES LES 3 FORMES
                if (shapesCompletedRef.current % 3 === 0) {
                  setTimeLeft((t) => t + 5);
                  setBonusNotification('+5s');
                  setTimeout(() => setBonusNotification(null), 1000);
                }

                // Générer la forme suivante
                spawnNewShape();
              }
            }
          }
        } else {
          if (trailRef.current.length > 0) trailRef.current.shift();
        }

        // D. PARTICULES & EXPLOSIONS
        for (let i = particlesRef.current.length - 1; i >= 0; i--) {
          const p = particlesRef.current[i];
          p.x += p.vx;
          p.y += p.vy;
          p.alpha -= 0.02;

          if (p.alpha <= 0) {
            particlesRef.current.splice(i, 1);
          } else {
            ctx.save();
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointermove', handlePointerMove);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [gameState, highScore]);

  return (
    <div ref={containerRef} className="relative w-full h-screen bg-black overflow-hidden select-none font-sans">
      {/* FLASH NOIR LORS DU CHOC MINE */}
      {isFlashing && <div className="absolute inset-0 bg-black z-50 pointer-events-none" />}

      {/* BARRE HAUTE UI : TEMPS & VIES */}
      {gameState === 'PLAYING' && (
        <div className="absolute top-4 left-4 right-4 flex justify-between items-center z-40 pointer-events-none">
          {/* SCORE & CHRONO */}
          <div className="flex items-center gap-4">
            <div className="bg-zinc-900/90 border border-zinc-800 px-5 py-2.5 rounded-2xl text-white font-mono text-2xl shadow-xl flex items-center gap-2">
              <span>⏱️</span>
              <span className={timeLeft <= 10 ? 'text-red-500 font-bold animate-pulse' : 'text-amber-400 font-bold'}>
                {timeLeft}s
              </span>
              {bonusNotification && (
                <span className="ml-2 text-green-400 text-lg font-bold animate-bounce">{bonusNotification}</span>
              )}
            </div>

            <div className="bg-zinc-900/90 border border-zinc-800 px-4 py-2.5 rounded-2xl text-zinc-300 font-mono text-lg">
              Score: <span className="text-white font-bold">{score}</span>
            </div>
          </div>

          {/* VIES (HAUT À DROITE) */}
          <div className="flex items-center gap-3 bg-zinc-900/90 border border-zinc-800 px-4 py-2.5 rounded-2xl shadow-xl">
            {[0, 1, 2].map((index) => {
              const isAlive = index < lives;
              const isExploding = damagedHeartIndex === index;

              return (
                <Heart
                  key={index}
                  className={`w-8 h-8 transition-all duration-300 ${
                    isAlive
                      ? 'text-red-500 fill-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.8)]'
                      : 'text-zinc-700 fill-zinc-900 scale-90 opacity-40'
                  } ${isExploding ? 'animate-ping text-white fill-white scale-150' : ''}`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* BOUTON PLEIN ÉCRAN PERMANENT */}
      <button
        onClick={toggleFullscreen}
        className="absolute bottom-4 right-4 z-40 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white p-3 rounded-2xl border border-zinc-800 backdrop-blur transition active:scale-95 shadow-lg"
        title="Mode Plein Écran"
      >
        <Maximize2 className="w-6 h-6" />
      </button>

      {/* ECAN DE DÉMARRAGE */}
      {gameState === 'START' && (
        <div className="absolute inset-0 bg-zinc-950/90 backdrop-blur-md z-40 flex flex-col items-center justify-center text-white p-6">
          <div className="max-w-md text-center space-y-6">
            <h1 className="text-5xl font-extrabold tracking-wider bg-gradient-to-r from-red-500 via-orange-400 to-yellow-300 bg-clip-text text-transparent">
              HYPER TRACER
            </h1>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Pointe ton doigt pour relier les cibles lumineuses. Esquive impérativement les <span className="text-red-400 font-bold">mines mortelles</span> !
            </p>

            <div className="bg-zinc-900/80 p-4 rounded-2xl border border-zinc-800 text-left space-y-2 text-xs text-zinc-300">
              <div className="flex items-center gap-2">⏱️ <span><strong>45s</strong> au départ, <strong>+5s</strong> tous les 3 motifs accomplis.</span></div>
              <div className="flex items-center gap-2">❤️ <span><strong>3 vies</strong>. Toucher une mine détruit un cœur.</span></div>
              <div className="flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-red-500" /> <span>Attention au flash noir en cas d'impact !</span></div>
            </div>

            <button
              onClick={() => {
                toggleFullscreen(); // Déclenche le plein écran
                startGame();        // Démarre le jeu immédiatement
              }}
              className="w-full py-4 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white font-bold text-xl rounded-2xl shadow-lg shadow-red-600/30 flex items-center justify-center gap-3 transition active:scale-95 cursor-pointer"
            >
              <Play className="fill-white w-6 h-6" /> JOUER
            </button>
          </div>
        </div>
      )}

      {/* ÉCRAN DE GAME OVER */}
      {gameState === 'GAMEOVER' && (
        <div className="absolute inset-0 bg-black/95 backdrop-blur-md z-40 flex flex-col items-center justify-center text-white p-6">
          <div className="max-w-md text-center space-y-6">
            <h2 className="text-4xl font-extrabold text-red-500">PARTIE TERMINÉE</h2>
            <div className="space-y-2 bg-zinc-900/90 border border-zinc-800 p-6 rounded-2xl">
              <p className="text-zinc-400">Score final: <span className="text-2xl font-bold text-white">{score}</span></p>
              <p className="text-zinc-400">Formes complétées: <span className="text-xl font-bold text-amber-400">{shapesCount}</span></p>
              <p className="text-xs text-zinc-500 pt-2">Meilleur score: {highScore}</p>
            </div>

            <button
              onClick={() => {
                toggleFullscreen();
                startGame();
              }}
              className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-bold text-xl rounded-2xl shadow-lg flex items-center justify-center gap-3 transition active:scale-95 cursor-pointer"
            >
              <RotateCcw className="w-6 h-6" /> RECOMMENCER
            </button>
          </div>
        </div>
      )}

      {/* CANVAS */}
      <canvas ref={canvasRef} className="w-full h-full block cursor-none" />
    </div>
  );
};