import { useEffect, useRef, useState } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export default function HandTracker() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<string>("Chargement de l'IA...");
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let animFrameId: number;
    let stream: MediaStream | null = null;
    let handLandmarker: HandLandmarker | null = null;

    const init = async () => {
      try {
        setStatus("Chargement du modèle de détection...");
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );

        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 2
        });

        setStatus("Demande d'accès caméra...");
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 }
          }
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();

          let lastVideoTime = -1;
          const process = () => {
            if (videoRef.current && canvasRef.current && handLandmarker) {
              const video = videoRef.current;
              const canvas = canvasRef.current;
              const ctx = canvas.getContext('2d');

              if (video.currentTime !== lastVideoTime && video.readyState >= 2) {
                lastVideoTime = video.currentTime;
                const results = handLandmarker.detectForVideo(video, performance.now());

                if (ctx) {
                  ctx.save();
                  ctx.clearRect(0, 0, canvas.width, canvas.height);
                  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                  if (results.landmarks) {
                    for (const landmarks of results.landmarks) {
                      // Repère 8 = Bout de l'index
                      const indexTip = landmarks[8];
                      if (indexTip) {
                        const x = indexTip.x * canvas.width;
                        const y = indexTip.y * canvas.height;

                        // Halo lumineux
                        ctx.beginPath();
                        ctx.arc(x, y, 22, 0, 2 * Math.PI);
                        ctx.fillStyle = 'rgba(99, 102, 241, 0.4)';
                        ctx.fill();

                        // Point central vert
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
                setIsLoaded(true);
              }
            }
            animFrameId = requestAnimationFrame(process);
          };
          process();
        }
      } catch (err: any) {
        console.error("Erreur HandLandmarker :", err);
        setStatus(`Erreur : ${err.message || "Accès caméra refusé"}`);
      }
    };

    init();

    return () => {
      if (animFrameId) cancelAnimationFrame(animFrameId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (handLandmarker) handLandmarker.close();
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