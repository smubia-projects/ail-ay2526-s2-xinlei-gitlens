
import React, { useEffect, useRef, useState } from 'react';
import { Highlight } from '../types';
import { Sparkles, Loader2, Copy, Check, ExternalLink } from 'lucide-react';
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
  targetLine?: number;
  onExplainSelection?: (selection: string) => void;
  onScanFile?: () => void;
  isScanning?: boolean;
  isImage?: boolean;
  downloadUrl?: string;
}

interface CodeLineProps {
  line: string;
  lineNum: number;
  language: string;
  matchingHighlight?: Highlight;
  isHovered: boolean;
  onMouseEnter: (lineNum: number) => void;
  onMouseLeave: () => void;
}

const CodeLine = React.memo<CodeLineProps>(({ line, lineNum, language, matchingHighlight, isHovered, onMouseEnter, onMouseLeave }) => {
  const isStartOfHighlight = matchingHighlight && lineNum === matchingHighlight.start;
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [line, language]);

  return (
    <tr 
      id={`line-${lineNum}`}
      onMouseEnter={() => onMouseEnter(lineNum)}
      onMouseLeave={onMouseLeave}
      className={`transition-all duration-300 group ${matchingHighlight ? 'bg-white/5' : 'hover:bg-white/[0.02]'}`}
    >
      <td className={`w-14 text-right pr-4 text-neutral-700 select-none whitespace-nowrap align-top py-0.5 border-l-4 transition-all duration-500 ${matchingHighlight ? 'border-white/50 text-white/60 font-bold' : 'border-transparent'}`}>
        {lineNum}
      </td>
      <td className="relative align-top py-0.5 px-4 min-w-[400px]">
        {isStartOfHighlight && (
          <div className="absolute -top-6 left-4 flex items-center gap-2 z-10 pointer-events-none animate-in fade-in slide-in-from-left-4 duration-700">
            <div className="text-[10px] bg-white text-black px-2.5 py-1 rounded-md shadow-[0_0_20px_rgba(255,255,255,0.2)] font-sans font-black flex items-center gap-2 uppercase tracking-tighter border border-white/20">
              <div className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
              {matchingHighlight.function_name || matchingHighlight.label}
            </div>
            {(matchingHighlight.params || matchingHighlight.returns) && (
                <div className="text-[9px] bg-black border border-white/10 text-neutral-400 px-2 py-1 rounded-md shadow-2xl mono whitespace-nowrap backdrop-blur-sm">
                  {matchingHighlight.params && <span className="text-neutral-300">({matchingHighlight.params})</span>}
                  {matchingHighlight.returns && <span className="text-neutral-300 ml-1">→ {matchingHighlight.returns}</span>}
                </div>
            )}
          </div>
        )}

        {isHovered && matchingHighlight?.explanation && (
          <div className="absolute left-4 bottom-full mb-2 z-50 w-[300px] animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-neutral-900 border border-white/10 p-3 rounded-xl shadow-2xl backdrop-blur-md">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={12} className="text-white" />
                <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">AI Insight</span>
              </div>
              <p className="text-[11px] text-neutral-300 leading-relaxed font-sans italic">
                {matchingHighlight.explanation}
              </p>
            </div>
            <div className="w-3 h-3 bg-neutral-900 border-r border-b border-white/10 rotate-45 absolute -bottom-1.5 left-6" />
          </div>
        )}

        <pre className={`language-${language} whitespace-pre text-neutral-300 m-0 leading-relaxed transition-all duration-300 pr-10 ${matchingHighlight ? 'opacity-100' : 'opacity-80 group-hover:opacity-100'}`}>
          <code ref={codeRef} className={`language-${language}`}>{line || ' '}</code>
        </pre>
      </td>
    </tr>
  );
});

export const CodeViewer: React.FC<CodeViewerProps> = ({ content, filename, highlights, scrollTrigger, targetLine, onExplainSelection, onScanFile, isScanning, isImage, downloadUrl }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const observerTarget = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null);
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(500);
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const lines = content.split('\n');
  const fileHighlights = React.useMemo(() => 
    highlights.filter(h => h.file === filename || filename.endsWith(h.file)),
    [highlights, filename]
  );

  // Reset visible count when file changes
  useEffect(() => {
    setVisibleCount(500);
  }, [filename]);

  // Ensure visibleCount includes the target highlight or targetLine
  useEffect(() => {
    let maxLine = 0;
    if (fileHighlights.length > 0) {
      maxLine = Math.max(...fileHighlights.map(h => h.end));
    }
    if (targetLine && targetLine > maxLine) {
      maxLine = targetLine;
    }
    
    if (maxLine > visibleCount) {
      setVisibleCount(prev => Math.max(prev, maxLine + 100));
    }
  }, [fileHighlights, filename, scrollTrigger, targetLine]);

  useEffect(() => {
    if (containerRef.current) {
      if (targetLine) {
        const element = document.getElementById(`line-${targetLine}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      }

      if (fileHighlights.length > 0) {
        const firstHighlight = fileHighlights[0];
        const element = document.getElementById(`line-${firstHighlight.start}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  }, [fileHighlights, filename, scrollTrigger, targetLine]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && visibleCount < lines.length) {
          setVisibleCount(prev => Math.min(prev + 500, lines.length));
        }
      },
      { threshold: 0.1, root: containerRef.current, rootMargin: '200px' }
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => observer.disconnect();
  }, [visibleCount, lines.length]);

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

  const language = getLanguage(filename);
  const visibleLines = lines.slice(0, visibleCount);

  return (
    <div className="flex flex-col h-full bg-black mono text-[13px] relative overflow-hidden" onMouseUp={handleSelection}>
      <div className="bg-black/80 backdrop-blur-md px-6 py-3 text-neutral-400 text-xs border-b border-white/10 flex justify-between items-center sticky top-0 z-20 shrink-0">
        <div className="flex items-center gap-3">
           <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
           <span className="text-white font-bold tracking-tight">{filename.split('/').pop()}</span>
           <span className="text-[10px] opacity-30 font-mono tracking-tighter truncate max-w-[200px]">{filename}</span>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={handleCopy}
            className="flex items-center gap-2 px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-md border border-white/10 transition-all text-[10px] font-bold uppercase tracking-wider"
            title="Copy file content"
          >
            {isCopied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            {isCopied ? 'Copied' : 'Copy'}
          </button>
          <button 
            onClick={onScanFile}
            disabled={isScanning}
            className="flex items-center gap-2 px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-md border border-white/20 transition-all text-[10px] font-bold uppercase tracking-wider disabled:opacity-50"
          >
            {isScanning ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {isScanning ? 'Scanning...' : 'Scan Symbols'}
          </button>
          <span className="opacity-40 font-mono text-[10px] uppercase tracking-widest">
            {visibleCount < lines.length ? `${visibleCount} / ${lines.length}` : lines.length} Lines
          </span>
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
            className="bg-white text-black px-3 py-1.5 rounded-full text-[11px] font-bold shadow-[0_0_25px_rgba(255,255,255,0.2)] flex items-center gap-2 hover:bg-neutral-200 hover:scale-105 transition-all border border-white/30"
          >
            <Sparkles size={14} /> Explain Selection
          </button>
        </div>
      )}

      <div ref={containerRef} className="flex-1 overflow-auto py-6 custom-scrollbar scroll-smooth">
        {isImage && downloadUrl ? (
          <div className="flex flex-col items-center justify-center p-12 min-h-[400px]">
            <div className="relative group">
              <div className="absolute -inset-4 bg-white/5 blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <img 
                src={downloadUrl} 
                alt={filename} 
                className="max-w-full max-h-[70vh] rounded-2xl shadow-2xl border border-white/10 relative z-10 animate-in fade-in zoom-in-95 duration-500"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="mt-8 flex flex-col items-center gap-2">
              <span className="text-neutral-400 text-xs font-bold uppercase tracking-widest">Image Preview</span>
              <a 
                href={downloadUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-brand-primary text-[11px] hover:underline flex items-center gap-1"
              >
                View Raw <ExternalLink size={10} />
              </a>
            </div>
          </div>
        ) : (
          <div className="min-w-fit w-full">
            <table className="w-full border-collapse">
              <tbody>
                {visibleLines.map((line, i) => (
                  <CodeLine 
                    key={i + 1}
                    line={line}
                    lineNum={i + 1}
                    language={language}
                    matchingHighlight={fileHighlights.find(h => (i + 1) >= h.start && (i + 1) <= h.end)}
                    isHovered={hoveredLine === (i + 1)}
                    onMouseEnter={setHoveredLine}
                    onMouseLeave={() => setHoveredLine(null)}
                  />
                ))}
              </tbody>
            </table>
            {visibleCount < lines.length && (
              <div ref={observerTarget} className="h-20 flex items-center justify-center text-neutral-500 text-xs font-bold uppercase tracking-widest">
                <Loader2 size={16} className="animate-spin mr-2" /> Loading more lines...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};


