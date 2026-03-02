import React, { useState, useEffect } from 'react';
import { Loader2, Shield, Zap, Search, Database, Cpu, Globe, GitBranch } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface IndexingOverlayProps {
  isVisible: boolean;
  repoName?: string;
  loadingTime?: number;
}

const steps = [
  { icon: <Globe size={18} />, text: "Connecting to GitHub API..." },
  { icon: <GitBranch size={18} />, text: "Fetching repository tree structure..." },
  { icon: <Search size={18} />, text: "Identifying core modules and entry points..." },
  { icon: <Cpu size={18} />, text: "Analyzing project architecture with Gemini..." },
  { icon: <Database size={18} />, text: "Indexing symbols and logic flows..." },
  { icon: <Shield size={18} />, text: "Securing metadata in database cluster..." },
  { icon: <Zap size={18} />, text: "Finalizing repository map..." },
];

export const IndexingOverlay: React.FC<IndexingOverlayProps> = ({ isVisible, repoName, loadingTime }) => {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (isVisible) {
      const interval = setInterval(() => {
        setCurrentStep((prev) => (prev + 1) % steps.length);
      }, 2500);
      return () => clearInterval(interval);
    } else {
      setCurrentStep(0);
    }
  }, [isVisible]);

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
                    index === currentStep 
                      ? "text-blue-400 translate-x-2" 
                      : index < currentStep 
                        ? "text-emerald-500 opacity-50" 
                        : "text-slate-600 opacity-30"
                  }`}
                >
                  <div className={`p-1.5 rounded-lg border ${
                    index === currentStep 
                      ? "bg-blue-500/10 border-blue-500/30" 
                      : index < currentStep 
                        ? "bg-emerald-500/10 border-emerald-500/30" 
                        : "bg-slate-800 border-slate-700"
                  }`}>
                    {step.icon}
                  </div>
                  <span className="text-xs font-bold uppercase tracking-wider">
                    {step.text}
                  </span>
                </div>
              ))}
            </div>

            <div className="pt-4">
              <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-blue-500"
                  initial={{ width: "0%" }}
                  animate={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
              <p className="text-[10px] text-slate-500 mt-3 font-mono uppercase tracking-widest">
                Please wait while Gemini analyzes the codebase structure
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
