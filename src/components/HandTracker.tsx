import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    Hands: any;
  }
}

// Chargeur dynamique de script avec fallback CDN
const loadMediaPipeHands = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (window.Hands) return resolve();

    const cdns = [
      'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js',
      'https://unpkg.com/@mediapipe/hands@0.4.1675469240/hands.js',
    ];

    let current = 0;

    const tryLoad = () => {
      if (current >= cdns.length) {
        return reject(new Error("Tous les CDN MediaPipe ont échoué. Vérifie ta connexion."));
      }

      const script = document.createElement('script');
      script.src = cdns[current];
      script.crossOrigin = 'anonymous';

      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        current++;
        tryLoad();
      };

      document.head.appendChild(script);
    };

    tryLoad();
  });
};

export default function HandTracker() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<string>("Chargement du moteur d'IA...");
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let animFrameId: number;
    let stream: MediaStream | null = null;

    const init = async () => {
      try {
        // 1. Chargement résilient des scripts MediaPipe
        setStatus("Téléchargement de MediaPipe...");
        await loadMediaPipeHands();

        setStatus("Initialisation du modèle de suivi...");
        const hands = new window.Hands({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
        });

        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.6,
          minTrackingConfidence: 0.6,
        });

        hands.onResults((results: any) => {
          const canvasElement = canvasRef.current;
          if (!canvasElement) return;
          const canvasCtx = canvasElement.getContext('2d');
          if (!canvasCtx) return;

          canvasCtx.save();
          canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
          canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

          if (results.multiHandLandmarks) {
            for (const landmarks of results.multiHandLandmarks) {
              const indexTip = landmarks[8];
              if (indexTip) {
                const x = indexTip.x * canvasElement.width;
                const y = indexTip.y * canvasElement.height;

                // Halo
                canvasCtx.beginPath();
                canvasCtx.arc(x, y, 22, 0, 2 * Math.PI);
                canvasCtx.fillStyle = 'rgba(99, 102, 241, 0.4)';
                canvasCtx.fill();

                // Point central
                canvasCtx.beginPath();
                canvasCtx.arc(x, y, 10, 0, 2 * Math.PI);
                canvasCtx.fillStyle = '#22c55e';
                canvasCtx.fill();
                canvasCtx.lineWidth = 3;
                canvasCtx.strokeStyle = '#ffffff';
                canvasCtx.stroke();
              }
            }
          }
          canvasCtx.restore();
          setIsLoaded(true);
        });

        // 2. Activation caméra native
        setStatus("Demande d'accès caméra...");
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();

          const process = async () => {
            if (videoRef.current && videoRef.current.readyState === 4) {
              await hands.send({ image: videoRef.current });
            }
            animFrameId = requestAnimationFrame(process);
          };
          process();
        }
      } catch (err: any) {
        console.error(err);
        setStatus(`Erreur : ${err.message || "Accès caméra refusé"}`);
      }
    };

    init();

    return () => {
      if (animFrameId) cancelAnimationFrame(animFrameId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="relative w-full max-w-lg mx-auto rounded-3xl overflow-hidden border-4 border-indigo-500/30 shadow-2xl bg-slate-900">
      {!isLoaded && (
        <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center text-indigo-400 font-bold text-center p-6 z-10">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-500 mb-4"></div>
          <p className="text-sm">{status}</p>
        </div>
      )}
      <video ref={videoRef} className="hidden" playsInline autoPlay muted />
      <canvas ref={canvasRef} width={640} height={480} className="w-full h-auto transform -scale-x-100" />
    </div>
  );
}