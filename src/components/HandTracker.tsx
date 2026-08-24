import { useRef, useState } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export default function HandTracker() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [status, setStatus] = useState<'idle' | 'loading' | 'active' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const initCamera = async () => {
    setStatus('loading');
    setErrorMsg('');

    try {
      // 1. Chargement des fichiers WASM MediaPipe (version fixée 0.10.14)
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );

      // 2. Initialisation IA avec fallback automatique GPU -> CPU
      let handLandmarker: HandLandmarker;
      try {
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
        });
      } catch {
        // Fallback CPU si WebGL/GPU échoue sur le mobile
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
        });
      }

      // 3. Demande native de caméra déclenchée par le clic
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });

      if (!videoRef.current || !canvasRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      video.srcObject = stream;
      await video.play();

      setStatus('active');

      // 4. Boucle de détection
      let lastVideoTime = -1;
      const processFrame = () => {
        if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;

          // Ajuster la résolution du canvas à la vidéo réelle
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 480;

          const results = handLandmarker.detectForVideo(video, performance.now());

          if (ctx) {
            ctx.save();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            if (results.landmarks) {
              for (const landmarks of results.landmarks) {
                // Point 8 = Bout de l'index
                const indexTip = landmarks[8];
                if (indexTip) {
                  const x = indexTip.x * canvas.width;
                  const y = indexTip.y * canvas.height;

                  // Cercle extérieur (Halo)
                  ctx.beginPath();
                  ctx.arc(x, y, 22, 0, 2 * Math.PI);
                  ctx.fillStyle = 'rgba(99, 102, 241, 0.4)';
                  ctx.fill();

                  // Cible centrale (Vert fluo)
                  ctx.beginPath();
                  ctx.arc(x, y, 10, 0, 2 * Math.PI);
                  ctx.fillStyle = '#22c55e';
                  ctx.fill();
                  ctx.lineWidth = 3;
                  ctx.strokeStyle = '#ffffff';
                  ctx.stroke();
                }
              }
            }
            ctx.restore();
          }
        }
        requestAnimationFrame(processFrame);
      };

      processFrame();
    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setErrorMsg(err.message || 'Accès à la caméra refusé ou non supporté.');
    }
  };

  return (
    <div className="relative w-full max-w-lg mx-auto rounded-3xl overflow-hidden border-4 border-indigo-500/30 shadow-2xl bg-slate-900 min-h-[360px] flex items-center justify-center">
      {/* Écran d'accueil avant activation */}
      {status === 'idle' && (
        <div className="text-center p-6 space-y-4">
          <p className="text-slate-300 text-sm">
            Clique sur le bouton ci-dessous pour autoriser la caméra et démarrer le suivi d'index.
          </p>
          <button
            onClick={initCamera}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-indigo-500/30 transition-transform active:scale-95"
          >
            Lancer la caméra 🚀
          </button>
        </div>
      )}

      {/* Chargement */}
      {status === 'loading' && (
        <div className="flex flex-col items-center justify-center p-6 text-indigo-400 space-y-3 animate-pulse">
          <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-semibold">Initialisation de l'IA et de la caméra...</p>
        </div>
      )}

      {/* Message d'erreur */}
      {status === 'error' && (
        <div className="text-center p-6 space-y-4 text-red-400">
          <p className="text-sm font-semibold">{errorMsg}</p>
          <button
            onClick={initCamera}
            className="px-4 py-2 bg-slate-800 text-white text-xs rounded-lg border border-slate-700"
          >
            Réessayer
          </button>
        </div>
      )}

      {/* Rendu vidéo et canvas */}
      <video ref={videoRef} className="hidden" playsInline autoPlay muted />
      <canvas
        ref={canvasRef}
        className={`w-full h-auto transform -scale-x-100 ${status === 'active' ? 'block' : 'hidden'}`}
      />
    </div>
  );
}