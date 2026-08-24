import { useEffect, useRef, useState } from 'react';

// Déclaration pour TypeScript
declare global {
  interface Window {
    Hands: any;
    Camera: any;
  }
}

export default function HandTracker() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!videoRef.current || !canvasRef.current) return;
    if (!window.Hands || !window.Camera) {
      console.error("MediaPipe n'est pas encore chargé depuis le CDN");
      return;
    }

    const videoElement = videoRef.current;
    const canvasElement = canvasRef.current;
    const canvasCtx = canvasElement.getContext('2d');

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
      if (!canvasCtx) return;

      canvasCtx.save();
      canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
      canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

      if (results.multiHandLandmarks) {
        for (const landmarks of results.multiHandLandmarks) {
          // Repère 8 = Bout de l'index
          const indexTip = landmarks[8];

          if (indexTip) {
            const x = indexTip.x * canvasElement.width;
            const y = indexTip.y * canvasElement.height;

            // Halo extérieur
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

    const camera = new window.Camera(videoElement, {
      onFrame: async () => {
        await hands.send({ image: videoElement });
      },
      width: 640,
      height: 480,
    });

    camera.start();

    return () => {
      camera.stop();
      hands.close();
    };
  }, []);

  return (
    <div className="relative w-full max-w-lg mx-auto rounded-3xl overflow-hidden border-4 border-indigo-500/30 shadow-2xl bg-slate-900">
      {!isLoaded && (
        <div className="absolute inset-0 bg-slate-950/90 flex items-center justify-center text-indigo-400 font-bold text-center p-4 animate-pulse z-10">
          Initialisation de la caméra et du suivi des index...
        </div>
      )}
      <video ref={videoRef} className="hidden" playsInline />
      <canvas ref={canvasRef} width={640} height={480} className="w-full h-auto transform -scale-x-100" />
    </div>
  );
}