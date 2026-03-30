import React, { useState, useRef } from 'react';
import { ChevronRight, FileCode } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

interface ChatInputProps {
  handleQuery: () => void;
  handleAttachFile: (path: string) => void;
  isDragging: boolean;
}

export function ChatInput({ handleQuery, handleAttachFile, isDragging }: ChatInputProps) {
  const { 
    query, setQuery, 
    isLoading, 
    fileSuggestions, setFileSuggestions,
    showFileSuggestions, setShowFileSuggestions,
    suggestionIndex, setSuggestionIndex,
    files
  } = useAppStore();

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

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleQuery(); }} className="relative group">
      {showFileSuggestions && fileSuggestions.length > 0 && (
        <div className="absolute bottom-full mb-2 left-0 right-0 bg-neutral-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="p-2 text-xs font-bold text-neutral-500 uppercase tracking-widest border-b border-white/5 bg-black/20">
            Attach File
          </div>
          <div className="max-h-48 overflow-y-auto">
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
  );
}
