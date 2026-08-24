import { useRef, useState } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export default function HandTracker() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'active' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const startCamera = async () => {
    setStatus('loading');
    setErrorMsg('');

    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );

      // Chargement depuis le fichier local placé dans /public
      const handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/hand_landmarker.task',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
      });

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });

      if (!videoRef.current || !canvasRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      video.srcObject = stream;
      await video.play();
      setStatus('active');

      let lastVideoTime = -1;
      const render = () => {
        if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 480;

          const results = handLandmarker.detectForVideo(video, performance.now());

          if (ctx) {
            ctx.save();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            if (results.landmarks) {
              for (const landmarks of results.landmarks) {
                const indexTip = landmarks[8];
                if (indexTip) {
                  const x = indexTip.x * canvas.width;
                  const y = indexTip.y * canvas.height;

                  ctx.beginPath();
                  ctx.arc(x, y, 22, 0, 2 * Math.PI);
                  ctx.fillStyle = 'rgba(99, 102, 241, 0.4)';
                  ctx.fill();

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
        requestAnimationFrame(render);
      };

      render();
    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setErrorMsg(err?.message || "Impossible de charger l'IA ou d'accéder à la caméra.");
    }
  };

  return (
    <div className="relative w-full max-w-lg mx-auto rounded-3xl overflow-hidden border-4 border-indigo-500/30 shadow-2xl bg-slate-900 min-h-[360px] flex items-center justify-center">
      {status === 'idle' && (
        <button
          onClick={startCamera}
          className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg transition-transform active:scale-95"
        >
          Lancer la caméra
        </button>
      )}

      {status === 'loading' && (
        <div className="flex flex-col items-center justify-center p-6 text-indigo-400 space-y-3 animate-pulse">
          <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-semibold">Chargement de l'IA...</p>
        </div>
      )}

      {status === 'error' && (
        <div className="text-center p-6 space-y-4 text-red-400">
          <p className="text-sm font-semibold">{errorMsg}</p>
          <button
            onClick={startCamera}
            className="px-4 py-2 bg-slate-800 text-white text-xs rounded-lg border border-slate-700"
          >
            Réessayer
          </button>
        </div>
      )}

      <video ref={videoRef} className="hidden" playsInline autoPlay muted />
      <canvas
        ref={canvasRef}
        className={`w-full h-auto transform -scale-x-100 ${status === 'active' ? 'block' : 'hidden'}`}
      />
    </div>
  );
}