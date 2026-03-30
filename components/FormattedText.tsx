import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check, FileCode } from 'lucide-react';

export const FormattedText = ({ text, onFileClick }: { text: string; onFileClick?: (path: string) => void }) => {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const components = {
    pre({ children, ...props }: any) {
      let content = '';
      if (children && children.props && children.props.children) {
        content = String(children.props.children).replace(/\n$/, '');
      }
      
      return (
        <div className="relative group mt-4 mb-4">
          <div className="absolute top-3 right-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
            <button
              onClick={() => {
                navigator.clipboard.writeText(content);
                setCopiedCode(content);
                setTimeout(() => setCopiedCode(null), 2000);
              }}
              className="p-2 bg-neutral-900/80 backdrop-blur-md text-neutral-400 rounded-xl hover:bg-neutral-800 hover:text-white border border-white/5 transition-all shadow-xl"
              title="Copy code"
            >
              {copiedCode === content ? <Check size={14} className="text-brand-primary" /> : <Copy size={14} />}
            </button>
          </div>
          <div className="bg-black/40 rounded-2xl border border-white/5 overflow-hidden shadow-2xl">
            <div className="px-4 py-2 bg-white/5 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/40" />
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500/20 border border-amber-500/40" />
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/20 border border-emerald-500/40" />
              </div>
              <div className="text-[9px] font-bold text-neutral-600 uppercase tracking-widest">Code Block</div>
            </div>
            <pre className="!mt-0 !mb-0 p-4 overflow-x-auto custom-scrollbar" {...props}>
              {children}
            </pre>
          </div>
        </div>
      );
    },
    code({ node, className, children, ...props }: any) {
      const content = String(children).replace(/\n$/, '');
      const isPath = /^[a-zA-Z0-9._\-\/]+\.[a-zA-Z0-9]+$/.test(content);
      
      const match = /language-(\w+)/.exec(className || '');
      const isBlock = match || String(children).includes('\n');

      if (isBlock) {
        return (
          <code className={`${className || ''} block mono text-[12px] leading-relaxed text-neutral-300`} {...props}>
            {children}
          </code>
        );
      }
      
      if (isPath && onFileClick) {
        return (
          <button 
            onClick={() => onFileClick(content)}
            className="bg-brand-primary/10 text-brand-primary px-2 py-0.5 rounded-lg mono text-[11px] font-bold border border-brand-primary/20 hover:bg-brand-primary/20 transition-all cursor-pointer inline-flex items-center gap-1.5"
          >
            <FileCode size={12} />
            {content}
          </button>
        );
      }
      
      return (
        <code className={`${className || ''} bg-white/5 text-neutral-300 px-1.5 py-0.5 rounded-md mono text-[11px] font-medium border border-white/10`} {...props}>
          {children}
        </code>
      );
    }
  };

  return (
    <div className="markdown-body prose prose-invert prose-neutral max-w-none text-[13px] leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {typeof text === 'string' ? text : JSON.stringify(text, null, 2)}
      </ReactMarkdown>
    </div>
  );
};
