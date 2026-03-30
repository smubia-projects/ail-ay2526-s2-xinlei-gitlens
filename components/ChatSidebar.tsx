import React, { useRef, useEffect } from 'react';
import { ChevronRight, FileCode, X, Loader2, Sparkles, GitBranch, Layers, Network, Activity, MapIcon } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { FormattedText } from './FormattedText';
import { Highlight, AIConfig } from '../types';
import { fetchFileContent } from '../services/github';

interface ChatSidebarProps {
  runAnalysis: (userQuery: string, history?: { role: string; content: string }[], forceFlash?: boolean) => Promise<void>;
  handleNavigate: (path: string, line?: number, highlight?: Highlight) => void;
  handleSelectFile: (path: string) => void;
  handleVisualizeDependencies: (highlight: Highlight) => void;
  handleLoadBundle: (bundle: { title: string; files: string[] }) => void;
  handleSaveAIConfig: (config: AIConfig, tokenOverride?: string) => void;
}

export function ChatSidebar({
  runAnalysis,
  handleNavigate,
  handleSelectFile,
  handleVisualizeDependencies,
  handleLoadBundle,
  handleSaveAIConfig
}: ChatSidebarProps) {
  const {
    messages, setMessages,
    query, setQuery,
    isLoading,
    isDragging, setIsDragging,
    attachedFiles, setAttachedFiles,
    showFileSuggestions, setShowFileSuggestions,
    fileSuggestions, setFileSuggestions,
    suggestionIndex, setSuggestionIndex,
    sidebarTab, setSidebarTab,
    currentSources,
    focusedFunction, setFocusedFunction,
    isGeneratingGraph,
    aiConfig,
    repo, files, githubToken
  } = useAppContext();

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!messagesContainerRef.current || !scrollRef.current) return;
    
    const observer = new ResizeObserver(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
    
    observer.observe(messagesContainerRef.current);
    return () => observer.disconnect();
  }, []);

  const handleAttachFile = async (path: string) => {
    const file = files.find(f => f.path === path);
    if (file && !attachedFiles.some(af => af.path === path)) {
      try {
        const { content } = await fetchFileContent(repo!, path, githubToken || undefined);
        setAttachedFiles(prev => [...prev, { ...file, content }]);
      } catch (e) {
        console.error("Failed to fetch content for attached file:", e);
      }
    }
  };

  const handleRemoveFile = (path: string) => {
    setAttachedFiles(prev => prev.filter(af => af.path !== path));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const path = e.dataTransfer.getData('text/plain');
    if (path) {
      handleAttachFile(path);
      setSidebarTab('chat');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const val = e.target.value;
    setQuery(val);

    const lastAtPos = val.lastIndexOf('@');
    if (lastAtPos !== -1 && (lastAtPos === 0 || val[lastAtPos - 1] === ' ')) {
      const search = val.slice(lastAtPos + 1).toLowerCase();
      const filtered = files.filter(f => f.type === 'blob' && f.path.toLowerCase().includes(search)).slice(0, 10);
      if (filtered.length > 0) {
        setFileSuggestions(filtered);
        setShowFileSuggestions(true);
        setSuggestionIndex(0);
      } else {
        setShowFileSuggestions(false);
      }
    } else {
      setShowFileSuggestions(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showFileSuggestions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestionIndex(prev => (prev + 1) % fileSuggestions.length);
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestionIndex(prev => (prev - 1 + fileSuggestions.length) % fileSuggestions.length);
        return;
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = fileSuggestions[suggestionIndex];
        const lastAtPos = query.lastIndexOf('@');
        const newVal = query.slice(0, lastAtPos) + `@${selected.path.split('/').pop()} `;
        setQuery(newVal);
        handleAttachFile(selected.path);
        setShowFileSuggestions(false);
        return;
      } else if (e.key === 'Escape') {
        setShowFileSuggestions(false);
        return;
      }
    }

    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleQuery();
    }
  };

  const handleQuery = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim() || !repo) return;
    const userQuery = query;
    const currentMessages = messages;
    setQuery('');
    
    // Reset textarea height
    const textarea = document.getElementById('chat-input') as HTMLTextAreaElement;
    if (textarea) {
      textarea.style.height = 'auto';
    }

    setMessages(prev => [...prev, { 
      role: 'user', 
      content: userQuery,
      sources: attachedFiles.length > 0 ? attachedFiles.map(f => ({ path: f.path, startLine: 1, endLine: 1 })) : undefined
    }]);
    setFocusedFunction(null);
    await runAnalysis(userQuery, currentMessages);
    setAttachedFiles([]); // Clear after sending
  };

  if (sidebarTab !== 'chat') return null;

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full">
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto min-h-0 p-5 flex flex-col gap-6 custom-scrollbar bg-neutral-950 scroll-smooth"
      >
        <div className="flex flex-col gap-6 animate-in fade-in duration-300" ref={messagesContainerRef}>
          {isLoading && currentSources.length > 0 && (
            <div className="flex items-center gap-2 text-[10px] text-emerald-500 font-bold uppercase tracking-widest animate-pulse px-2">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
              Retrieved {currentSources.length} relevant snippets
            </div>
          )}
          {messages.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-neutral-700 gap-4 opacity-50">
              <Activity size={48} />
              <div className="text-center">
                <p className="text-sm font-medium">No messages yet</p>
                <p className="text-[11px]">Ask a question about the code below</p>
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`flex flex-col gap-3 ${m.role === 'user' ? 'items-end' : 'items-start animate-in fade-in slide-in-from-left-4'} shrink-0 mb-4`}>
                <div className={`max-w-[92%] p-4 rounded-2xl shadow-2xl transition-all ${
                  m.role === 'user' 
                    ? 'bg-brand-primary text-white rounded-tr-none border border-brand-primary shadow-brand-primary/20' 
                    : 'glass border border-white/5 text-neutral-200 rounded-tl-none'
                }`}>
                   {m.role === 'assistant' ? (
                     <FormattedText text={m.content} onFileClick={handleSelectFile} />
                   ) : (
                     <div className="text-sm font-medium leading-relaxed">{m.content}</div>
                   )}
                   
                   {m.sources && m.sources.length > 0 && (
                     <div className="mt-4 pt-4 border-t border-white/5 flex flex-col gap-2.5">
                       <div className="text-[9px] font-bold text-neutral-500 uppercase tracking-widest flex items-center gap-2">
                         <MapIcon size={10} className="text-brand-primary" /> Retrieved Context
                       </div>
                       <div className="flex flex-wrap gap-1.5">
                         {m.sources.map((s, idx) => (
                           <button 
                             key={idx}
                             onClick={() => handleNavigate(s.path, s.startLine)}
                             className="text-[9px] px-2 py-1 bg-white/5 hover:bg-white/10 text-neutral-400 rounded-lg border border-white/5 transition-all truncate max-w-[140px] font-bold"
                           >
                             {s.path.split('/').pop()} <span className="opacity-50 ml-1">L{s.startLine}</span>
                           </button>
                         ))}
                       </div>
                     </div>
                   )}
                </div>
                
                {m.analysis && (
                  <div className="w-full flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-500 mt-2">
                    {m.analysis.call_tree_markdown && m.analysis.call_tree_markdown.trim() !== "" && (
                      <div className="bg-neutral-900/40 rounded-2xl p-4 border border-white/5 shadow-inner">
                        <div className="flex items-center gap-2 text-[9px] font-bold text-neutral-500 mb-3 uppercase tracking-widest">
                          <GitBranch size={12} className="rotate-90 text-brand-primary" /> Context Tree
                        </div>
                        <div 
                          className="mono text-[10px] text-neutral-400 whitespace-pre-wrap leading-relaxed bg-black/40 p-3 rounded-xl border border-white/5 border-l-2 border-l-brand-primary/50 max-h-[300px] overflow-y-auto custom-scrollbar"
                          onWheel={(e) => e.stopPropagation()}
                        >
                          {m.analysis.call_tree_markdown}
                        </div>
                      </div>
                    )}
                    
                    {m.analysis.context_bundles && m.analysis.context_bundles.length > 0 && (
                      <div className="bg-brand-primary/5 rounded-2xl p-4 border border-brand-primary/20 shadow-inner">
                        <div className="flex items-center gap-2 text-[9px] font-bold text-brand-primary mb-3 uppercase tracking-widest">
                          <Layers size={12} /> Suggested Context Bundles
                        </div>
                        <div className="flex flex-col gap-2">
                          {m.analysis.context_bundles.map((bundle, bIdx) => (
                            <div key={bIdx} className="p-3 rounded-xl bg-black/40 border border-white/5 hover:border-brand-primary/30 transition-all group/bundle">
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="text-[11px] font-bold text-neutral-200 group-hover/bundle:text-brand-primary transition-colors">{bundle.title}</div>
                                <button 
                                  onClick={() => handleLoadBundle(bundle)}
                                  className="text-[9px] px-2 py-1 bg-brand-primary/10 text-brand-primary rounded-lg border border-brand-primary/20 hover:bg-brand-primary/20 transition-all font-bold uppercase tracking-widest"
                                >
                                  Load Context
                                </button>
                              </div>
                              <p className="text-[10px] text-neutral-500 leading-relaxed mb-2">{bundle.description}</p>
                              <div className="flex flex-wrap gap-1">
                                {bundle.files.map((f, fIdx) => (
                                  <span key={fIdx} className="text-[8px] px-1.5 py-0.5 bg-white/5 text-neutral-600 rounded border border-white/5 mono">
                                    {f.split('/').pop()}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {m.analysis.highlights && m.analysis.highlights.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <div className="text-[9px] font-bold text-neutral-600 uppercase pl-2 tracking-widest mb-1">Identified Focus</div>
                        <div className="grid grid-cols-1 gap-2">
                          {m.analysis.highlights.map((h, idx) => (
                            <div key={idx} onClick={() => handleNavigate(h.file, h.start, h)}
                              className={`flex items-center justify-between p-4 border rounded-2xl transition-all text-left group shadow-sm cursor-pointer ${
                                focusedFunction === h 
                                  ? 'bg-brand-primary/10 border-brand-primary shadow-brand-primary/10' 
                                  : 'bg-neutral-900/50 border border-white/5 hover:border-brand-primary/30 hover:bg-neutral-900'
                              }`}
                            >
                              <div className="flex flex-col overflow-hidden">
                                <span className="text-xs font-bold text-white mono group-hover:text-brand-primary transition-colors truncate">{h.function_name || h.label}</span>
                                <span className="text-[10px] text-neutral-500 mono opacity-80 mt-1 truncate">{h.file.split('/').pop()}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleVisualizeDependencies(h);
                                  }}
                                  className="p-2 bg-neutral-800 hover:bg-brand-primary text-neutral-400 hover:text-white rounded-lg transition-all border border-white/5"
                                  title="Visualize Dependencies"
                                >
                                  {isGeneratingGraph ? <Loader2 size={14} className="animate-spin" /> : <Network size={14} />}
                                </button>
                                {h.start !== undefined && (
                                  <div className="text-[10px] bg-neutral-800 text-neutral-400 px-2.5 py-1 rounded-lg border border-white/5 font-mono font-bold shrink-0">L{h.start}</div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        
        {isLoading && (
          <div className="flex flex-col gap-4 animate-pulse opacity-40 shrink-0">
            <div className="h-4 bg-neutral-800 rounded-full w-1/2" />
            <div className="h-32 bg-neutral-800 rounded-2xl w-full" />
          </div>
        )}
      </div>

      <div className={`p-5 border-t border-white/5 bg-black/40 backdrop-blur-2xl shrink-0 transition-all ${isDragging ? 'bg-brand-primary/10 ring-2 ring-brand-primary ring-inset' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {attachedFiles.map(f => (
              <div key={f.path} className="flex items-center gap-2 px-2.5 py-1.5 bg-brand-primary/10 border border-brand-primary/20 rounded-lg text-[10px] text-brand-primary font-bold animate-in zoom-in-95">
                <FileCode size={12} />
                <span className="truncate max-w-[120px]">{f.path.split('/').pop()}</span>
                <button onClick={() => handleRemoveFile(f.path)} className="hover:text-white transition-colors">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between mb-4 px-1">
          <div className="flex items-center gap-2">
            <button 
              type="button"
              onClick={() => handleSaveAIConfig({ ...aiConfig, useFlash: !aiConfig.useFlash })}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-[10px] font-bold uppercase tracking-widest ${
                aiConfig.useFlash 
                  ? "bg-amber-400/10 border-amber-400/30 text-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.1)]" 
                  : "bg-purple-400/10 border-purple-400/30 text-purple-400 shadow-[0_0_15px_rgba(167,139,250,0.1)]"
              }`}
            >
              <Sparkles size={12} className={aiConfig.useFlash ? "animate-pulse" : ""} />
              {aiConfig.useFlash ? "Speed (Flash)" : "Quality (Pro)"}
            </button>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => setMessages([])}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/5 bg-neutral-900 text-neutral-500 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10 transition-all text-[10px] font-bold uppercase tracking-widest"
              >
                <X size={12} />
                Clear
              </button>
            )}
          </div>
          {isLoading && (
            <div className="text-[10px] text-neutral-500 font-bold uppercase tracking-widest flex items-center gap-2">
              <Loader2 size={12} className="animate-spin text-brand-primary" />
              Analyzing...
            </div>
          )}
        </div>
        <form onSubmit={handleQuery} className="relative group">
          {showFileSuggestions && (
            <div className="absolute bottom-full left-0 w-full mb-3 bg-neutral-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50 animate-in slide-in-from-bottom-2 backdrop-blur-xl">
              <div className="p-3 border-b border-white/5 text-[9px] font-bold text-neutral-500 uppercase tracking-widest">Files</div>
              <div className="max-h-48 overflow-y-auto custom-scrollbar">
                {fileSuggestions.map((f, i) => (
                  <div 
                    key={f.path}
                    onClick={() => {
                      const lastAtPos = query.lastIndexOf('@');
                      const newVal = query.slice(0, lastAtPos) + `@${f.path.split('/').pop()} `;
                      setQuery(newVal);
                      handleAttachFile(f.path);
                      setShowFileSuggestions(false);
                    }}
                    className={`px-4 py-2.5 text-xs cursor-pointer flex items-center gap-3 transition-colors ${i === suggestionIndex ? 'bg-brand-primary text-white' : 'text-neutral-400 hover:bg-white/5'}`}
                  >
                    <FileCode size={14} className="opacity-50" />
                    <div className="flex flex-col">
                      <span className="font-bold">{f.path.split('/').pop()}</span>
                      <span className={`text-[10px] opacity-60 ${i === suggestionIndex ? 'text-white/70' : 'text-neutral-500'}`}>{f.path}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <textarea 
            id="chat-input"
            value={query} 
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={isDragging ? "Drop file to attach..." : "Ask about logic or use @ to mention files... (Ctrl+Enter to send)"}
            className={`w-full bg-neutral-900/50 border border-white/5 rounded-2xl py-4 pl-6 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary/50 transition-all placeholder:text-neutral-600 resize-none min-h-[52px] max-h-[200px] ${isDragging ? 'placeholder:text-brand-primary' : ''}`}
            style={{ height: 'auto' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
            }}
          />
          <button type="submit" disabled={isLoading} className="absolute right-2.5 bottom-1.5 p-2.5 rounded-xl bg-white text-black shadow-xl shadow-white/10 hover:bg-neutral-200 transition-all disabled:opacity-30 active:scale-95">
            <ChevronRight size={20} />
          </button>
        </form>
      </div>
    </div>
  );
}
