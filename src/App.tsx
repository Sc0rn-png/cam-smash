import HandTracker from './components/HandTracker';

export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4">
      <h1 className="text-3xl font-black text-indigo-500 mb-1 tracking-tight">
        INDEX SMASH 👆👆
      </h1>
      <p className="text-slate-400 mb-6 text-sm text-center">
        Lève tes deux index face à la caméra pour contrôler le jeu.
      </p>
      <HandTracker />
    </div>
  );
}
