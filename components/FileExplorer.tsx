
import React, { useMemo } from 'react';
import { RepoFile } from '../types';
import { 
  Folder, 
  FileCode, 
  FileJson, 
  FileText, 
  FileImage, 
  FileArchive, 
  FileSearch, 
  FileTerminal, 
  ChevronRight, 
  ChevronDown,
  Settings,
  Lock,
  FileSpreadsheet,
  FileAudio,
  FileVideo,
  Database
} from 'lucide-react';

interface FileExplorerProps {
  files: RepoFile[];
  onSelectFile: (path: string) => void;
  selectedPath: string | null;
}

interface TreeNode {
  name: string;
  path: string;
  type: 'blob' | 'tree';
  children: Map<string, TreeNode>;
}

const getFileIcon = (filename: string) => {
  const ext = filename.split('.').pop()?.toLowerCase();
  
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rb', 'java', 'c', 'cpp', 'cs', 'php', 'rs', 'swift', 'kt', 'dart'].includes(ext || '')) {
    return <FileCode size={14} className="text-blue-400" />;
  }
  if (['json', 'yaml', 'yml', 'toml', 'xml'].includes(ext || '')) {
    return <FileJson size={14} className="text-amber-400" />;
  }
  if (['md', 'txt', 'rtf', 'pdf', 'doc', 'docx'].includes(ext || '')) {
    return <FileText size={14} className="text-slate-400" />;
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext || '')) {
    return <FileImage size={14} className="text-emerald-400" />;
  }
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext || '')) {
    return <FileArchive size={14} className="text-rose-400" />;
  }
  if (['sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1'].includes(ext || '')) {
    return <FileTerminal size={14} className="text-emerald-500" />;
  }
  if (['sql', 'db', 'sqlite', 'mongodb', 'prisma'].includes(ext || '')) {
    return <Database size={14} className="text-indigo-400" />;
  }
  if (['csv', 'xlsx', 'xls'].includes(ext || '')) {
    return <FileSpreadsheet size={14} className="text-emerald-600" />;
  }
  if (['mp3', 'wav', 'ogg', 'flac'].includes(ext || '')) {
    return <FileAudio size={14} className="text-violet-400" />;
  }
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext || '')) {
    return <FileVideo size={14} className="text-rose-500" />;
  }
  if (['lock', 'key', 'pem', 'crt'].includes(ext || '')) {
    return <Lock size={14} className="text-amber-500" />;
  }
  if (filename.startsWith('.') || ['env', 'config', 'settings'].includes(ext || '')) {
    return <Settings size={14} className="text-slate-500" />;
  }
  if (['test', 'spec'].some(s => filename.toLowerCase().includes(s))) {
    return <FileSearch size={14} className="text-emerald-400" />;
  }

  return <FileCode size={14} className="text-slate-500" />;
};

export const FileExplorer: React.FC<FileExplorerProps> = ({ files, onSelectFile, selectedPath }) => {
  const tree = useMemo(() => {
    const root: TreeNode = { name: '', path: '', type: 'tree', children: new Map() };
    files.forEach(file => {
      const parts = file.path.split('/');
      let current = root;
      parts.forEach((part, i) => {
        if (!current.children.has(part)) {
          current.children.set(part, {
            name: part,
            path: parts.slice(0, i + 1).join('/'),
            type: i === parts.length - 1 ? file.type : 'tree',
            children: new Map(),
          });
        }
        current = current.children.get(part)!;
      });
    });
    return root;
  }, [files]);

  const [expanded, setExpanded] = React.useState<Set<string>>(new Set(['']));

  const toggleExpand = (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setExpanded(next);
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const isExpanded = expanded.has(node.path);
    const isSelected = selectedPath === node.path;
    const hasChildren = node.children.size > 0;

    return (
      <div key={node.path} className="select-none">
        {node.name && (
          <div
            className={`flex items-center gap-1.5 py-0.5 px-2 cursor-pointer hover:bg-slate-800 transition-colors text-sm ${isSelected ? 'bg-blue-600/20 text-blue-400 border-r-2 border-blue-500' : 'text-slate-400'}`}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={() => {
              if (node.type === 'tree') toggleExpand(node.path);
              else onSelectFile(node.path);
            }}
          >
            {node.type === 'tree' ? (
              <>
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Folder size={14} className="text-blue-400" />
              </>
            ) : (
              <>
                <div className="w-[14px]" />
                {getFileIcon(node.name)}
              </>
            )}
            <span className="truncate">{node.name}</span>
          </div>
        )}
        {node.type === 'tree' && isExpanded && (
          <div>
            {Array.from(node.children.values())
              .sort((a, b) => {
                if (a.type !== b.type) return a.type === 'tree' ? -1 : 1;
                return a.name.localeCompare(b.name);
              })
              .map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto py-2">
      {renderNode(tree, -1)}
    </div>
  );
};
