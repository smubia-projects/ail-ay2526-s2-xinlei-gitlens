
import React, { useMemo } from 'react';
import { RepoFile } from '../types';
import { Folder, FileCode, ChevronRight, ChevronDown } from 'lucide-react';

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
                <FileCode size={14} className="text-slate-500" />
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
