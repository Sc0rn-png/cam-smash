export default function App() {
  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4">
      <h1 className="text-4xl font-extrabold text-indigo-500 mb-4 tracking-tight">
        CAM-SMASH 🥊
      </h1>
      <p className="text-slate-400 mb-6 text-center max-w-md">
        Environnement prêt. Prochaine étape : intégration de la caméra et du canvas Phaser 3.
      </p>
      <div className="px-4 py-2 bg-indigo-600 rounded-lg text-sm font-semibold shadow-lg shadow-indigo-500/30">
        Status : Serveur OK
      </div>
    </div>
  );
}