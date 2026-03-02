
import React, { useEffect, useRef, useState } from 'react';
import { Highlight } from '../types';
import { Sparkles, Loader2 } from 'lucide-react';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-css';

interface CodeViewerProps {
  content: string;
  filename: string;
  highlights: Highlight[];
  scrollTrigger?: number;
  onExplainSelection?: (selection: string) => void;
  onScanFile?: () => void;
  isScanning?: boolean;
}

export const CodeViewer: React.FC<CodeViewerProps> = ({ content, filename, highlights, scrollTrigger, onExplainSelection, onScanFile, isScanning }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null);
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);

  const lines = content.split('\n');
  const fileHighlights = React.useMemo(() => 
    highlights.filter(h => h.file === filename || filename.endsWith(h.file)),
    [highlights, filename]
  );

  const lastScrolledRef = useRef<string | null>(null);

  const getLanguage = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts': return 'typescript';
      case 'tsx': return 'tsx';
      case 'js': return 'javascript';
      case 'jsx': return 'jsx';
      case 'md': return 'markdown';
      case 'json': return 'json';
      case 'css': return 'css';
      default: return 'javascript';
    }
  };

  useEffect(() => {
    Prism.highlightAll();
  }, [content, filename]);

  useEffect(() => {
    if (fileHighlights.length > 0 && containerRef.current) {
      const firstHighlight = fileHighlights[0];
      const element = document.getElementById(`line-${firstHighlight.start}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [fileHighlights, filename, scrollTrigger]);

  const handleSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      
      setSelection({
        text: sel.toString().trim(),
        top: Math.max(80, rect.top - 50),
        left: rect.left + rect.width / 2
      });
    } else {
      setSelection(null);
    }
  };

  const language = getLanguage(filename);

  return (
    <div className="flex flex-col h-full bg-slate-950 mono text-[13px] relative overflow-hidden" onMouseUp={handleSelection}>
      <div className="bg-slate-900/80 backdrop-blur-md px-6 py-3 text-slate-400 text-xs border-b border-slate-800 flex justify-between items-center sticky top-0 z-20 shrink-0">
        <div className="flex items-center gap-3">
           <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
           <span className="text-slate-200 font-bold tracking-tight">{filename.split('/').pop()}</span>
           <span className="text-[10px] opacity-30 font-mono tracking-tighter truncate max-w-[200px]">{filename}</span>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={onScanFile}
            disabled={isScanning}
            className="flex items-center gap-2 px-3 py-1 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 rounded-md border border-blue-500/30 transition-all text-[10px] font-bold uppercase tracking-wider disabled:opacity-50"
          >
            {isScanning ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {isScanning ? 'Scanning...' : 'Scan Symbols'}
          </button>
          <span className="opacity-40 font-mono text-[10px] uppercase tracking-widest">{lines.length} Lines</span>
        </div>
      </div>

      {selection && (
        <div 
          className="fixed z-[100] transform -translate-x-1/2 flex gap-1 animate-in zoom-in-95 fade-in duration-200 shadow-2xl"
          style={{ top: selection.top, left: selection.left }}
        >
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onExplainSelection?.(selection.text);
              setSelection(null);
            }}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-full text-[11px] font-bold shadow-[0_0_25px_rgba(37,99,235,0.4)] flex items-center gap-2 hover:bg-blue-500 hover:scale-105 transition-all border border-blue-400/30"
          >
            <Sparkles size={14} /> Explain Selection
          </button>
        </div>
      )}

      <div ref={containerRef} className="flex-1 overflow-auto py-6 custom-scrollbar scroll-smooth">
        <div className="min-w-fit w-full">
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((line, i) => {
                const lineNum = i + 1;
                const matchingHighlight = fileHighlights.find(h => lineNum >= h.start && lineNum <= h.end);
                const isStartOfHighlight = matchingHighlight && lineNum === matchingHighlight.start;
                const isHovered = hoveredLine === lineNum;

                return (
                  <tr 
                    key={lineNum} 
                    id={`line-${lineNum}`}
                    onMouseEnter={() => setHoveredLine(lineNum)}
                    onMouseLeave={() => setHoveredLine(null)}
                    className={`transition-all duration-300 group ${matchingHighlight ? 'bg-blue-600/10' : 'hover:bg-white/[0.02]'}`}
                  >
                    <td className={`w-14 text-right pr-4 text-slate-700 select-none whitespace-nowrap align-top py-0.5 border-l-4 transition-all duration-500 ${matchingHighlight ? 'border-blue-500 text-blue-400/60 font-bold' : 'border-transparent'}`}>
                      {lineNum}
                    </td>
                    <td className="relative align-top py-0.5 px-4 min-w-[400px]">
                      {isStartOfHighlight && (
                        <div className="absolute -top-6 left-4 flex items-center gap-2 z-10 pointer-events-none animate-in fade-in slide-in-from-left-4 duration-700">
                          <div className="text-[10px] bg-blue-600 text-white px-2.5 py-1 rounded-md shadow-[0_0_20px_rgba(37,99,235,0.4)] font-sans font-black flex items-center gap-2 uppercase tracking-tighter border border-blue-400">
                            <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                            {matchingHighlight.function_name || matchingHighlight.label}
                          </div>
                          {(matchingHighlight.params || matchingHighlight.returns) && (
                              <div className="text-[9px] bg-slate-950 border border-slate-800 text-slate-400 px-2 py-1 rounded-md shadow-2xl mono whitespace-nowrap backdrop-blur-sm">
                                {matchingHighlight.params && <span className="text-blue-400/80">({matchingHighlight.params})</span>}
                                {matchingHighlight.returns && <span className="text-emerald-400/80 ml-1">→ {matchingHighlight.returns}</span>}
                              </div>
                          )}
                        </div>
                      )}

                      {isHovered && matchingHighlight?.explanation && (
                        <div className="absolute left-4 bottom-full mb-2 z-50 w-[300px] animate-in fade-in zoom-in-95 duration-200">
                          <div className="bg-slate-900 border border-slate-700 p-3 rounded-xl shadow-2xl backdrop-blur-md">
                            <div className="flex items-center gap-2 mb-2">
                              <Sparkles size={12} className="text-blue-400" />
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">AI Insight</span>
                            </div>
                            <p className="text-[11px] text-slate-300 leading-relaxed font-sans italic">
                              {matchingHighlight.explanation}
                            </p>
                          </div>
                          <div className="w-3 h-3 bg-slate-900 border-r border-b border-slate-700 rotate-45 absolute -bottom-1.5 left-6" />
                        </div>
                      )}

                      <pre className={`language-${language} whitespace-pre text-slate-300 m-0 leading-relaxed transition-all duration-300 pr-10 ${matchingHighlight ? 'opacity-100' : 'opacity-80 group-hover:opacity-100'}`}>
                        <code className={`language-${language}`}>{line || ' '}</code>
                      </pre>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};


