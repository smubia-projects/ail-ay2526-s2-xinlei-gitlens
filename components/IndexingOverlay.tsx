import React, { useState, useEffect } from 'react';
import { Loader2, Shield, Zap, Search, Database, Cpu, Globe, GitBranch } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface IndexingOverlayProps {
  isVisible: boolean;
  repoName?: string;
  loadingTime?: number;
  progress?: { current: number; total: number; stage: string } | null;
}

const steps = [
  { id: 'Initializing', icon: <Globe size={18} />, text: "Connecting to GitHub API..." },
  { id: 'Fetching Repository Tree', icon: <GitBranch size={18} />, text: "Fetching repository tree structure..." },
  { id: 'Analyzing Project Structure', icon: <Search size={18} />, text: "Identifying core modules and entry points..." },
  { id: 'Generating Repository Overview', icon: <Cpu size={18} />, text: "Analyzing project architecture with Gemini..." },
  { id: 'Deep Indexing', icon: <Database size={18} />, text: "Indexing symbols and logic flows..." },
  { id: 'Saving Index', icon: <Shield size={18} />, text: "Securing metadata in database cluster..." },
  { id: 'Finalizing', icon: <Zap size={18} />, text: "Finalizing repository map..." },
];

export const IndexingOverlay: React.FC<IndexingOverlayProps> = ({ isVisible, repoName, loadingTime, progress }) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  useEffect(() => {
    if (progress) {
      const stage = progress.stage;
      const index = steps.findIndex(s => stage.includes(s.id) || s.id.includes(stage));
      if (index !== -1) {
        setCurrentStepIndex(index);
      } else if (stage === 'Scanning Entry Points' || stage === 'Generating Semantic Vector' || stage === 'Saving to Cache') {
        setCurrentStepIndex(3); // Map these to "Analyzing project architecture"
      }
    }
  }, [progress]);

  const calculateProgress = () => {
    if (!progress) return 0;
    if (progress.stage === 'Deep Indexing') {
      // Deep indexing is the 5th step (index 4)
      // We'll say it covers 60% to 90% of the total bar
      const base = 60;
      const range = 30;
      const subProgress = (progress.current / progress.total) * range;
      return base + subProgress;
    }
    if (progress.stage === 'Saving Index') return 95;
    return progress.current;
  };

  const progressValue = calculateProgress();

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center"
        >
          <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 rounded-full blur-[120px] animate-pulse" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-600/20 rounded-full blur-[120px] animate-pulse delay-700" />
          </div>

          <div className="relative max-w-md w-full space-y-8">
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-2xl animate-ping" />
                <div className="relative bg-slate-900 border border-blue-500/30 p-6 rounded-3xl shadow-2xl shadow-blue-500/10">
                  <Loader2 size={48} className="text-blue-500 animate-spin" />
                </div>
              </div>
              
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-white uppercase tracking-tighter">
                  Indexing <span className="text-blue-500">Repository</span> {loadingTime !== undefined && <span className="text-slate-500 ml-2">({loadingTime}s)</span>}
                </h2>
                <p className="text-slate-400 font-mono text-xs uppercase tracking-[0.2em]">
                  {repoName || "Initializing..."}
                </p>
              </div>
            </div>

            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 space-y-4 text-left">
              {steps.map((step, index) => (
                <div 
                  key={index} 
                  className={`flex items-center gap-4 transition-all duration-500 ${
                    index === currentStepIndex 
                      ? "text-blue-400 translate-x-2" 
                      : index < currentStepIndex 
                        ? "text-emerald-500 opacity-50" 
                        : "text-slate-600 opacity-30"
                  }`}
                >
                  <div className={`p-1.5 rounded-lg border ${
                    index === currentStepIndex 
                      ? "bg-blue-500/10 border-blue-500/30" 
                      : index < currentStepIndex 
                        ? "bg-emerald-500/10 border-emerald-500/30" 
                        : "bg-slate-800 border-slate-700"
                  }`}>
                    {step.icon}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold uppercase tracking-wider">
                      {step.text}
                    </span>
                    {index === currentStepIndex && progress?.stage === 'Deep Indexing' && (
                      <span className="text-[9px] text-blue-500/70 font-mono">
                        Processing file {progress.current} of {progress.total}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-4">
              <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-blue-500"
                  initial={{ width: "0%" }}
                  animate={{ width: `${progressValue}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
              <p className="text-[10px] text-slate-500 mt-3 font-mono uppercase tracking-widest">
                {progress?.stage || "Please wait while Gemini analyzes the codebase structure"}
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
