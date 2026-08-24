import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    Hands: any;
  }
}

export default function HandTracker() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<string>("Attente du chargement du CDN...");
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let animFrameId: number;
    let stream: MediaStream | null = null;

    const initCameraAndHands = async () => {
      try {
        // 1. Attendre que le script CDN MediaPipe soit bien injecté
        let attempts = 0;
        while (!window.Hands && attempts < 50) {
          await new Promise((r) => setTimeout(r, 100));
          attempts++;
        }

        if (!window.Hands) {
          setStatus("Erreur : Impossible de charger MediaPipe depuis le CDN.");
          return;
        }

        setStatus("Initialisation du modèle d'IA...");
        const hands = new window.Hands({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
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

                // Halo lumineux
                canvasCtx.beginPath();
                canvasCtx.arc(x, y, 22, 0, 2 * Math.PI);
                canvasCtx.fillStyle = 'rgba(99, 102, 241, 0.4)';
                canvasCtx.fill();

                // Cible centrale
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

        // 2. Demande native d'accès à la caméra (Mobile friendly)
        setStatus("Autorisation caméra requise...");
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user', // Caméra frontale
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();

          // 3. Boucle de rendu haute performance
          const processFrame = async () => {
            if (videoRef.current && videoRef.current.readyState === 4) {
              await hands.send({ image: videoRef.current });
            }
            animFrameId = requestAnimationFrame(processFrame);
          };
          processFrame();
        }
      } catch (err: any) {
        console.error("Erreur d'initialisation :", err);
        setStatus(`Erreur : ${err.message || "Accès à la caméra refusé"}`);
      }
    };

    initCameraAndHands();

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