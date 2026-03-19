import React, { useState, useEffect } from 'react';
import { X, Settings, Key, Globe, Cpu, Save, AlertCircle, CheckCircle2, Sparkles } from 'lucide-react';
import { AIConfig, AIProvider } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: AIConfig) => void;
  initialConfig: AIConfig;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onSave, initialConfig }) => {
  const [config, setConfig] = useState<AIConfig>(initialConfig);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setConfig(initialConfig);
      setIsSaved(false);
    }
  }, [isOpen, initialConfig]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(config);
    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
      onClose();
    }, 1000);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-8 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 text-blue-400 rounded-xl">
              <Settings size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-white uppercase tracking-tight">AI Settings</h2>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Configure your LLM provider</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-xl transition-all"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
          {/* Provider Selection */}
          <div className="space-y-4">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
              <Cpu size={14} /> Provider Type
            </label>
            <div className="grid grid-cols-2 gap-4">
              {(['gemini', 'openai'] as AIProvider[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setConfig({ ...config, provider: p })}
                  className={`p-4 rounded-2xl border-2 transition-all text-left relative overflow-hidden group ${
                    config.provider === p 
                      ? "border-blue-500 bg-blue-500/10 text-white" 
                      : "border-slate-800 bg-slate-900/50 text-slate-500 hover:border-slate-700"
                  }`}
                >
                  <div className="font-black uppercase tracking-widest text-sm relative z-10">
                    {p === 'gemini' ? 'Gemini Native' : 'OpenAI SDK'}
                  </div>
                  <div className="text-[10px] font-bold opacity-60 relative z-10">
                    {p === 'gemini' ? 'Direct Google API' : 'Compatible Endpoint'}
                  </div>
                  {config.provider === p && (
                    <div className="absolute -right-2 -bottom-2 text-blue-500/20">
                      <CheckCircle2 size={48} />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Flash Mode Toggle */}
          <div className="space-y-4">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
              <Sparkles size={14} /> Performance Mode
            </label>
            <div className="flex items-center justify-between p-4 bg-slate-950/50 border border-slate-800 rounded-2xl">
              <div className="flex flex-col">
                <span className="text-xs font-bold text-white uppercase tracking-tight">
                  {config.useFlash ? "Speed Mode (Flash)" : "Quality Mode (Pro)"}
                </span>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                  {config.useFlash ? "Lower latency, standard reasoning" : "Higher latency, advanced reasoning"}
                </span>
              </div>
              <button
                onClick={() => setConfig({ ...config, useFlash: !config.useFlash })}
                className={`w-12 h-6 rounded-full transition-all relative ${
                  config.useFlash ? "bg-blue-600" : "bg-slate-800"
                }`}
              >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                  config.useFlash ? "left-7" : "left-1"
                }`} />
              </button>
            </div>
          </div>

          {/* API Key */}
          <div className="space-y-4">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
              <Key size={14} /> API Key
            </label>
            <div className="relative">
              <input
                type="password"
                value={config.apiKey || ''}
                onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                placeholder={config.provider === 'gemini' ? "Paste your Gemini API Key..." : "Paste your OpenAI SDK Key..."}
                className="w-full bg-slate-950 border border-slate-800 rounded-2xl py-4 px-4 text-white placeholder:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-mono text-sm"
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600">
                <Key size={16} />
              </div>
            </div>
            {config.provider === 'gemini' && (
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Get your key from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Google AI Studio</a>. 
                Leave empty to use the system default key.
              </p>
            )}
          </div>

          {config.provider === 'openai' && (
            <div className="space-y-6 animate-in slide-in-from-top-4 duration-300">
              {/* Base URL */}
              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                  <Globe size={14} /> Base URL
                </label>
                <input
                  type="text"
                  value={config.baseUrl || ''}
                  onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                  placeholder="https://api.apiyi.com/v1"
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl py-4 px-4 text-white placeholder:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-mono text-sm"
                />
              </div>

              {/* Chat Model */}
              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                  <Cpu size={14} /> Chat Model
                </label>
                <input
                  type="text"
                  value={config.chatModel || ''}
                  onChange={(e) => setConfig({ ...config, chatModel: e.target.value })}
                  placeholder="gemini-3.1-pro-preview"
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl py-4 px-4 text-white placeholder:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-mono text-sm"
                />
              </div>

              {/* Embedding Model */}
              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                  <Sparkles size={14} /> Embedding Model
                </label>
                <input
                  type="text"
                  value={config.embeddingModel || ''}
                  onChange={(e) => setConfig({ ...config, embeddingModel: e.target.value })}
                  placeholder="text-embedding-3-small"
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl py-4 px-4 text-white placeholder:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-mono text-sm"
                />
              </div>
            </div>
          )}

          <div className="p-4 bg-blue-500/5 border border-blue-500/10 rounded-2xl flex gap-3">
            <CheckCircle2 className="text-blue-500 shrink-0" size={18} />
            <p className="text-[10px] text-blue-400 leading-relaxed font-bold uppercase tracking-wider">
              Settings are synced with your GitHub account when logged in.
            </p>
          </div>
        </div>

        <div className="p-8 bg-slate-900/80 border-t border-slate-800 flex items-center justify-end gap-4">
          <button 
            onClick={onClose}
            className="px-6 py-3 text-slate-400 hover:text-white font-bold uppercase tracking-widest text-xs transition-all"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            disabled={isSaved}
            className={`px-8 py-3 rounded-xl font-black uppercase tracking-[0.2em] text-xs flex items-center gap-2 transition-all shadow-xl ${
              isSaved 
                ? "bg-emerald-500 text-white shadow-emerald-500/20" 
                : "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20 active:scale-95"
            }`}
          >
            {isSaved ? (
              <>
                <CheckCircle2 size={16} />
                Saved
              </>
            ) : (
              <>
                <Save size={16} />
                Save Config
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
