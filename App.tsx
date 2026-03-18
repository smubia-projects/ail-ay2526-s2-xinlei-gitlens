
import React, { useState, useEffect, useRef } from 'react';
import { Github, GitBranch, Terminal, ChevronRight, Code2, Layers, Cpu, Compass, Map, ExternalLink, Activity, FolderOpen, Info, ArrowRightCircle, Eye, EyeOff, Network, Loader2, GitPullRequest, X, AlertTriangle, Sparkles, FileCode, Settings } from 'lucide-react';
import { FileExplorer } from './components/FileExplorer';
import { CodeViewer } from './components/CodeViewer';
import { Repository, RepoFile, ChatMessage, AnalysisResult, Highlight, RepoOverview, DependencyGraphData, RepoStats, AIConfig } from './types';
import { parseRepoUrl, fetchRepoTree, fetchFileContent } from './services/github';
import { analyzeCode, getRepoOverview, getFunctionFlow, explainSelection, getSymbolDependencies, analyzeFileSymbols, embedText, getUsageExamples, summarizeFile, setAIConfig } from './services/gemini';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { RepoVisualizer } from './components/RepoVisualizer';
import { FlowVisualizer } from './components/FlowVisualizer';
import { Dashboard } from './components/Dashboard';
import { HomePage } from './components/HomePage';
import { IndexingOverlay } from './components/IndexingOverlay';
import { SettingsModal } from './components/SettingsModal';

const FormattedText = ({ text, onFileClick }: { text: string; onFileClick?: (path: string) => void }) => {
  const components = {
    code({ node, inline, className, children, ...props }: any) {
      const content = String(children).replace(/\n$/, '');
      // Check if the code block looks like a file path
      const isPath = /^[a-zA-Z0-9._\-\/]+\.[a-zA-Z0-9]+$/.test(content);
      
      if (inline && isPath && onFileClick) {
        return (
          <button 
            onClick={() => onFileClick(content)}
            className="bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded-md mono text-[12px] border border-blue-500/20 hover:bg-blue-500/20 transition-colors cursor-pointer inline-flex items-center gap-1"
          >
            <FileCode size={12} />
            {content}
          </button>
        );
      }
      
      return (
        <code className={`${className} bg-slate-800/60 text-blue-400 px-1.5 py-0.5 rounded-md mono text-[12px] border border-slate-700/50`} {...props}>
          {children}
        </code>
      );
    }
  };

  return (
    <div className="markdown-body prose prose-invert prose-slate max-w-none text-[14px]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
};

export default function App() {
  const [url, setUrl] = useState('https://github.com/facebook/react');
  const [repo, setRepo] = useState<Repository | null>(null);
  const [files, setFiles] = useState<RepoFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<{ path: string; content: string } | null>(null);
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingTime, setLoadingTime] = useState(0);
  const [isIndexing, setIsIndexing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [aiConfig, setAiConfigState] = useState<AIConfig>(() => {
    const saved = localStorage.getItem('ai_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.useFlash === undefined) parsed.useFlash = true;
        setAIConfig(parsed);
        return parsed;
      } catch (e) {}
    }
    return { provider: 'gemini', useFlash: true };
  });

  const handleSaveAIConfig = (config: AIConfig) => {
    setAiConfigState(config);
    setAIConfig(config);
    localStorage.setItem('ai_config', JSON.stringify(config));
  };
  const [indexingProgress, setIndexingProgress] = useState<{ current: number; total: number; stage: string } | null>(null);
  const [overview, setOverview] = useState<RepoOverview | null>(null);
  const [activeHighlights, setActiveHighlights] = useState<Highlight[]>([]);
  const [scrollTrigger, setScrollTrigger] = useState<number>(0);
  const [targetLine, setTargetLine] = useState<number | undefined>(undefined);
  const [focusedFunction, setFocusedFunction] = useState<Highlight | null>(null);
  const [showHighlights, setShowHighlights] = useState(true);
  const [dependencyData, setDependencyData] = useState<DependencyGraphData | null>(null);
  const [isGeneratingGraph, setIsGeneratingGraph] = useState(false);
  const [isScanningFile, setIsScanningFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSources, setCurrentSources] = useState<{ path: string; startLine: number; endLine: number }[]>([]);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<'code' | 'map' | 'dashboard' | 'logic'>('code');
  const [sidebarTab, setSidebarTab] = useState<'map' | 'focus' | 'chat'>('map');
  const [view, setView] = useState<'home' | 'repo'>('home');
  const [stats, setStats] = useState<RepoStats | null>(null);
  const [githubUser, setGithubUser] = useState<any>(null);
  const [githubToken, setGithubToken] = useState<string | null>(null);
  const [jwtToken, setJwtToken] = useState<string | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('gitlens_token');
    if (token) {
      setJwtToken(token);
      checkAuth(token);
    } else {
      setIsCheckingAuth(false);
    }
    
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        const { token, user } = event.data;
        if (token) {
          localStorage.setItem('gitlens_token', token);
          setJwtToken(token);
          setGithubUser(user);
          // We'll get the githubToken on the next checkAuth or we can pass it in postMessage
          checkAuth(token);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const checkAuth = async (token?: string) => {
    const activeToken = token || jwtToken;
    if (!activeToken) {
      setIsCheckingAuth(false);
      return;
    }

    setIsCheckingAuth(true);
    try {
      console.log("Checking authentication status...");
      const res = await fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${activeToken}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        console.log("Auth check successful:", data.user.login);
        setGithubUser(data.user);
        setGithubToken(data.token);
        setJwtToken(activeToken);
      } else {
        console.log("Auth check failed (Not authenticated)");
        localStorage.removeItem('gitlens_token');
        setGithubUser(null);
        setGithubToken(null);
        setJwtToken(null);
      }
    } catch (e) {
      console.error("Auth check error:", e);
      setGithubUser(null);
      setGithubToken(null);
      setJwtToken(null);
    } finally {
      setIsCheckingAuth(false);
    }
  };

  const handleConnectGitHub = async () => {
    try {
      const res = await fetch('/api/auth/github/url');
      if (res.ok) {
        const { authUrl } = await res.json();
        window.open(authUrl, 'github_oauth', 'width=600,height=700');
      }
    } catch (e) {
      console.error("Failed to get auth URL", e);
    }
  };

  const handleInstallGitHub = async () => {
    try {
      const res = await fetch('/api/auth/github/url');
      if (res.ok) {
        const { installUrl } = await res.json();
        window.open(installUrl, 'github_install', 'width=800,height=800');
      }
    } catch (e) {
      console.error("Failed to get install URL", e);
    }
  };

  const handleLogoutGitHub = async () => {
    try {
      localStorage.removeItem('gitlens_token');
      setGithubUser(null);
      setGithubToken(null);
      setJwtToken(null);
    } catch (e) {
      console.error("Logout failed", e);
    }
  };

  useEffect(() => {
    let interval: any;
    if (isLoading || isIndexing) {
      setLoadingTime(0);
      interval = setInterval(() => {
        setLoadingTime(prev => prev + 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isLoading, isIndexing]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading, focusedFunction]);

  const handleFetchRepo = async (forceRefresh = false, overrideUrl?: string) => {
    console.time("handleFetchRepo");
    const targetUrl = overrideUrl || url;
    const parsed = parseRepoUrl(targetUrl);
    if (!parsed) {
      setError('Invalid GitHub URL format.');
      return;
    }
    setError(null);
    setIsIndexing(true);
    setOverview(null);
    setMessages([]);
    setFocusedFunction(null);

    try {
      setRepo(parsed);
      setView('repo');
      setUrl(targetUrl);
      setIndexingProgress({ current: 0, total: 100, stage: 'Initializing' });

      // 1. Check Cache first (if not force refresh)
      let repoId: string | null = null;
      if (!forceRefresh) {
        try {
          console.time("fetchCache");
          const cacheRes = await fetch(`/api/repo?owner=${parsed.owner}&name=${parsed.name}&branch=${parsed.branch}`);
          const contentType = cacheRes.headers.get("content-type");
          
          if (cacheRes.ok && contentType && contentType.includes("application/json")) {
            const cachedData = await cacheRes.json();
            console.timeEnd("fetchCache");
            repoId = cachedData._id;
            setFiles(cachedData.files);
            setOverview(cachedData.overview);
            setStats(cachedData.stats);
            setActiveHighlights(cachedData.highlights || []);
            setActiveTab('dashboard');
            
            const readme = cachedData.files.find((f: any) => f.path.toLowerCase().includes('readme.md'));
            if (readme) handleSelectFile(readme.path, parsed);
            
            setIsIndexing(false);
            console.timeEnd("handleFetchRepo");
            return;
          } else {
            console.timeEnd("fetchCache");
            console.warn("Cache fetch returned non-JSON or error:", cacheRes.status);
          }
        } catch (cacheErr) {
          console.timeEnd("fetchCache");
          console.warn("Cache fetch failed, falling back to GitHub", cacheErr);
        }
      }

      // 2. Fetch from GitHub and Analyze
      setIndexingProgress({ current: 10, total: 100, stage: 'Fetching Repository Tree' });
      const tree = await fetchRepoTree(parsed, githubToken || undefined);
      setFiles(tree);
      
      // Get context for better overview (package.json or README)
      setIndexingProgress({ current: 20, total: 100, stage: 'Analyzing Project Structure' });
      let context = "";
      const contextFile = tree.find(f => f.path.toLowerCase() === 'package.json' || f.path.toLowerCase() === 'readme.md');
      if (contextFile) {
        try {
          context = await fetchFileContent(parsed, contextFile.path, githubToken || undefined);
        } catch (e) {
          console.warn("Failed to fetch context file", e);
        }
      }

      setIndexingProgress({ current: 30, total: 100, stage: 'Generating Repository Overview' });
      const repoMap = await getRepoOverview(tree.map(f => f.path), context);
      setOverview(repoMap);

      // 3. Scan entry points for initial highlights
      setIndexingProgress({ current: 40, total: 100, stage: 'Scanning Entry Points' });
      let initialHighlights: any[] = [];
      if (repoMap.entry_points && repoMap.entry_points.length > 0) {
        const topEntry = repoMap.entry_points[0].path;
        // Verify the file actually exists in our tree to avoid 404
        const exists = tree.some(f => f.path === topEntry);
        
        if (exists) {
          try {
            const entryContent = await fetchFileContent(parsed, topEntry, githubToken || undefined);
            initialHighlights = await analyzeFileSymbols(topEntry, entryContent);
            setActiveHighlights(initialHighlights);
          } catch (e) {
            console.warn("Failed to scan entry point", e);
          }
        } else {
          console.warn(`Entry point ${topEntry} not found in repository tree.`);
        }
      }

      // 4. Generate Vector Embedding for semantic search
      setIndexingProgress({ current: 50, total: 100, stage: 'Generating Semantic Vector' });
      let vector: number[] = [];
      try {
        const summary = repoMap.summary || '';
        const arch = repoMap.architecture_type || '';
        const modules = (repoMap.core_modules || []).map(m => m.description || '').join(' ');
        const embeddingText = `${summary} ${arch} ${modules}`;
        vector = await embedText(embeddingText);
      } catch (e) {
        console.warn("Failed to generate embedding", e);
      }

      // Calculate stats
      const fileCount = tree.filter(f => f.type === 'blob').length;
      const folderCount = new Set(tree.map(f => f.path.split('/').slice(0, -1).join('/'))).size;
      
      const langMap: Record<string, number> = {};
      tree.forEach(f => {
        if (f.type === 'blob') {
          const ext = f.path.split('.').pop() || 'unknown';
          langMap[ext] = (langMap[ext] || 0) + 1;
        }
      });

      const colors = ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#f472b6'];
      const languages = Object.entries(langMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, count], i) => ({ name, count, color: colors[i % colors.length] }));

      const newStats = {
        fileCount,
        folderCount,
        languages,
        totalLines: fileCount * 150 // Estimated
      };
      setStats(newStats);

      // 5. Save to Cache and get repoId
      setIndexingProgress({ current: 60, total: 100, stage: 'Saving to Cache' });
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (jwtToken) {
          headers['Authorization'] = `Bearer ${jwtToken}`;
        }

        const saveRes = await fetch('/api/repo', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            owner: parsed.owner,
            name: parsed.name,
            branch: parsed.branch,
            files: tree,
            overview: repoMap,
            stats: newStats,
            highlights: initialHighlights,
            embedding: vector
          })
        });
        if (saveRes.ok) {
          const savedRepo = await saveRes.json();
          repoId = savedRepo._id;
        }
      } catch (saveErr) {
        console.error("Failed to save to cache", saveErr);
      }

        // 6. Deep Indexing: Chunk and Embed files for RAG
        if (repoId) {
          console.log("Starting deep indexing for snippets...");
          const codeFiles = tree.filter(f => 
            f.type === 'blob' && 
            /\.(ts|tsx|js|jsx|py|go|java|cpp|c|h|cs|rb|php|rs|swift|kt)$/i.test(f.path) &&
            !f.path.includes('node_modules') &&
            !f.path.includes('dist')
          ).slice(0, 50); // Limit to 50 files for now to avoid rate limits

          setIndexingProgress({ current: 0, total: codeFiles.length, stage: 'Deep Indexing' });

          const allSnippets: any[] = [];
          const BATCH_SIZE = 5;
          let completedFiles = 0;

          for (let i = 0; i < codeFiles.length; i += BATCH_SIZE) {
            const batch = codeFiles.slice(i, i + BATCH_SIZE);
            
            const batchResults = await Promise.all(batch.map(async (file) => {
              try {
                const content = await fetchFileContent(parsed, file.path, githubToken || undefined);
                
                // Get a high-level summary of the file to provide context for all chunks
                const fileSummary = await summarizeFile(file.path, content);
                
                const lines = content.split('\n');
                const chunkSize = 50;
                const overlap = 10;
                const fileSnippets: any[] = [];
                
                // Process chunks for this file
                const chunkPromises: Promise<any>[] = [];
                for (let j = 0; j < lines.length; j += (chunkSize - overlap)) {
                  const chunkLines = lines.slice(j, j + chunkSize);
                  const chunkContent = chunkLines.join('\n');
                  if (chunkContent.trim().length < 50) continue;

                  // Prepend file path AND the file summary to the chunk content
                  const embeddingText = `File: ${file.path}\nSummary: ${fileSummary}\n\nCode:\n${chunkContent}`;
                  
                  chunkPromises.push((async () => {
                    const chunkEmbedding = await embedText(embeddingText);
                    if (chunkEmbedding.length > 0) {
                      return {
                        path: file.path,
                        content: chunkContent,
                        startLine: j + 1,
                        endLine: j + chunkLines.length,
                        embedding: chunkEmbedding
                      };
                    }
                    return null;
                  })());
                }

                const results = await Promise.all(chunkPromises);
                fileSnippets.push(...results.filter(r => r !== null));
                
                completedFiles++;
                setIndexingProgress(prev => prev ? { ...prev, current: completedFiles } : null);
                return fileSnippets;
              } catch (e) {
                console.warn(`Failed to index ${file.path}`, e);
                completedFiles++;
                setIndexingProgress(prev => prev ? { ...prev, current: completedFiles } : null);
                return [];
              }
            }));

            batchResults.forEach(res => allSnippets.push(...res));
            
            // Small delay between batches to avoid rate limits
            await new Promise(r => setTimeout(r, 200));
          }

          if (allSnippets.length > 0) {
          setIndexingProgress(prev => prev ? { ...prev, stage: 'Saving Index' } : null);
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (jwtToken) {
            headers['Authorization'] = `Bearer ${jwtToken}`;
          }

          await fetch('/api/repo/index-snippets', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              owner: parsed.owner,
              name: parsed.name,
              repoId,
              snippets: allSnippets
            })
          });
        }
      }

      setIndexingProgress(null);
      setActiveTab('dashboard');

      const readme = tree.find(f => f.path.toLowerCase().includes('readme.md'));
      if (readme) handleSelectFile(readme.path, parsed);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error fetching repository');
    } finally {
      setIsIndexing(false);
    }
  };

  const handleSelectFile = async (path: string, r = repo) => {
    if (!r) return;
    try {
      const content = await fetchFileContent(r, path, githubToken || undefined);
      setSelectedFile({ path, content });
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to load file content.');
    }
  };

  const refineHighlights = (highlights: Highlight[], fileContent: string | undefined): Highlight[] => {
    if (!fileContent) return highlights;
    const lines = fileContent.split('\n');
    
    return highlights.map(h => {
      // If start is 1 and we have a function name or label, try to find it in the content
      if (h.start === 1 && (h.function_name || h.label)) {
        const searchTerm = h.function_name || h.label;
        
        // Specific patterns for common code structures
        const patterns = [
          `export async function ${searchTerm}`,
          `export function ${searchTerm}`,
          `async function ${searchTerm}`,
          `function ${searchTerm}`,
          `const ${searchTerm} =`,
          `let ${searchTerm} =`,
          `var ${searchTerm} =`,
          `${searchTerm}:`,
          `class ${searchTerm}`,
          `export const ${searchTerm}`,
          `interface ${searchTerm}`,
          `type ${searchTerm}`
        ];

        for (const pattern of patterns) {
          const foundIndex = lines.findIndex(line => line.includes(pattern));
          if (foundIndex !== -1) {
            return { ...h, start: foundIndex + 1, end: foundIndex + 5 };
          }
        }

        // Fallback to simple inclusion if no pattern matches
        const simpleIndex = lines.findIndex(line => line.includes(searchTerm));
        if (simpleIndex !== -1) {
          return { ...h, start: simpleIndex + 1, end: simpleIndex + 5 };
        }
      }
      return h;
    });
  };

  const runAnalysis = async (userQuery: string, forceFlash = false) => {
    console.time("runAnalysis");
    setIsLoading(true);
    setSidebarTab('chat');
    setError(null);
    setCurrentSources([]);
    const loadingId = Math.random().toString(36).substring(7);
    try {
      // 1. Semantic Search for relevant snippets
      let snippets: any[] = [];
      if (repo) {
        try {
          const queryVector = await embedText(userQuery);
          if (queryVector.length > 0) {
            const searchRes = await fetch('/api/search/snippets', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                vector: queryVector,
                owner: repo.owner,
                name: repo.name,
                limit: 5
              })
            });
            if (searchRes.ok) {
              snippets = await searchRes.json();
              setCurrentSources(snippets.map((s: any) => ({ path: s.path, startLine: s.startLine, endLine: s.endLine })));
            }
          }
        } catch (e) {
          console.warn("Semantic search failed", e);
        }
      }

      // 2. Call Gemini with context
      setMessages(prev => [...prev, { role: 'assistant', content: "...", id: loadingId }]);
      
      const rawAnalysis = await analyzeCode(
        userQuery, 
        selectedFile, 
        files.map(f => f.path), 
        overview, 
        forceFlash || aiConfig.useFlash,
        snippets // Pass snippets as context
      );
      const analysis = { 
        answer_markdown: rawAnalysis.answer_markdown || "No explanation provided.",
        highlights: Array.isArray(rawAnalysis.highlights) ? rawAnalysis.highlights : [],
        related: Array.isArray(rawAnalysis.related) ? rawAnalysis.related : [],
        call_tree_markdown: rawAnalysis.call_tree_markdown
      };
      
      // Refine highlights if they point to line 1 but have a name
      if (analysis.highlights.length > 0 && selectedFile) {
        analysis.highlights = refineHighlights(analysis.highlights, selectedFile.content);
      }

      setMessages(prev => prev.map(m => m.id === loadingId ? { 
        role: 'assistant', 
        content: analysis.answer_markdown, 
        analysis,
        sources: currentSources.length > 0 ? currentSources : undefined
      } : m));
      if (analysis.highlights.length > 0) {
        // Merge with existing highlights instead of overwriting
        setActiveHighlights(prev => {
          const newOnes = analysis.highlights.filter(nh => 
            !prev.some(ph => ph.file === nh.file && (ph.function_name === nh.function_name || ph.label === nh.label))
          );
          return [...prev, ...newOnes];
        });
        const firstFile = analysis.highlights[0].file;
        const fileExists = files.find(f => f.path.endsWith(firstFile) || firstFile.endsWith(f.path));
        if (fileExists && selectedFile?.path !== fileExists.path) {
          handleSelectFile(fileExists.path);
        }
      }
    } catch (err: any) {
      console.error("Analysis Error:", err);
      const errorMessage = err.message || "Unknown error";
      setMessages(prev => prev.map(m => m.id === loadingId ? { 
        role: 'assistant', 
        content: `Analysis failed: ${errorMessage}. Please try again.` 
      } : m));
    } finally {
      setIsLoading(false);
      console.timeEnd("runAnalysis");
    }
  };

  const handleExplainSelection = async (selection: string) => {
    if (!selectedFile) return;
    setIsLoading(true);
    setMessages(prev => [...prev, { role: 'user', content: `Explain this selection:\n\n\`\`\`\n${selection.slice(0, 300)}${selection.length > 300 ? '...' : ''}\n\`\`\`` }]);
    try {
      const explanation = await explainSelection(selection, selectedFile.path, selectedFile.content);
      setMessages(prev => [...prev, { role: 'assistant', content: explanation }]);
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { role: 'assistant', content: "Failed to explain selection." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuery = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim() || !repo) return;
    const userQuery = query;
    setQuery('');
    setMessages(prev => [...prev, { role: 'user', content: userQuery }]);
    setFocusedFunction(null);
    await runAnalysis(userQuery);
  };

  const handleNavigate = (path: string, line?: number, highlight?: Highlight) => {
    const fileExists = files.find(f => f.path.endsWith(path) || path.endsWith(f.path));
    if (fileExists) {
       handleSelectFile(fileExists.path);
       setScrollTrigger(prev => prev + 1);
       setTargetLine(line);
       if (highlight) {
         // Add to highlights if not already there, don't overwrite
         setActiveHighlights(prev => {
           const exists = prev.some(h => h.file === highlight.file && (h.function_name === highlight.function_name || h.label === highlight.label));
           return exists ? prev : [...prev, highlight];
         });
         setFocusedFunction(highlight);
         setSidebarTab('focus');
       } else {
         // Even without a specific highlight, switch to focus tab to show file symbols
         setSidebarTab('focus');
         if (line) {
           const jumpHighlight = { file: path, start: line, end: line, label: 'Jumped here', description: '', logic_source: '' };
           setActiveHighlights(prev => [...prev, jumpHighlight]);
         }
       }
    }
  };

  const handleModuleClick = (moduleName: string, description: string) => {
    setMessages(prev => [...prev, { role: 'user', content: `Explaining core module: ${moduleName}` }]);
    setFocusedFunction(null);
    
    // Find files in this module - more robust matching
    const moduleFiles = files.filter(f => 
      (f.path.startsWith(moduleName) || f.path.includes(`/${moduleName}/`)) && 
      f.type === 'blob'
    );
    
    if (moduleFiles.length > 0) {
      const priority = moduleFiles.find(f => 
        f.path.toLowerCase().includes('index') || 
        f.path.toLowerCase().includes('main') || 
        f.path.toLowerCase().includes('core') ||
        f.path.toLowerCase().includes('controller') ||
        f.path.toLowerCase().includes('route')
      );
      handleSelectFile((priority || moduleFiles[0]).path);
    }

    // FAST PATH: Use cached description from indexing overview
    const cachedAnalysis: AnalysisResult = {
      answer_markdown: `### ${moduleName} Module\n\n${description}\n\n---\n*This summary was retrieved instantly from the repository index. For a deeper implementation analysis, you can ask a specific question in the chat.*`,
      highlights: moduleFiles.slice(0, 5).map(f => ({
        file: f.path,
        start: 1,
        end: 1,
        label: f.path.split('/').pop() || f.path,
        description: `Key file within the ${moduleName} module.`,
        logic_source: `Identified via Repository Structure (${moduleName})`
      })),
      related: []
    };

    setMessages(prev => [...prev, { 
      role: 'assistant', 
      content: cachedAnalysis.answer_markdown,
      analysis: cachedAnalysis
    }]);
    setSidebarTab('chat');
  };

  const handleVisualizeDependencies = async (h: Highlight) => {
    setIsGeneratingGraph(true);
    const symbolName = h.function_name || h.label;
    try {
      // 1. Get structural dependencies from Gemini
      const dataPromise = getSymbolDependencies(
        symbolName,
        h.file,
        files.map(f => f.path),
        overview
      );

      // 2. Get call flow markdown (the text trace)
      const flowPromise = selectedFile ? getFunctionFlow(symbolName, selectedFile.content) : Promise.resolve("");

      // 3. Find actual usages in the codebase
      const searchResPromise = repo ? fetch(`/api/search/usages?symbol=${encodeURIComponent(symbolName)}&owner=${repo.owner}&name=${repo.name}`) : Promise.resolve(new Response(JSON.stringify([])));

      const [data, flow, searchRes] = await Promise.all([dataPromise, flowPromise, searchResPromise]);
      data.call_flow_markdown = flow;

      if (searchRes.ok) {
        const usages = await searchRes.json();
        const externalUsages = usages.filter((u: any) => u.file !== h.file);
        
        if (externalUsages.length > 0) {
          const examples = await getUsageExamples(symbolName, externalUsages);
          data.usage_examples = examples;

          // Update focusedFunction if it's the one we're analyzing
          setFocusedFunction(prev => {
            if (prev && (prev.function_name === symbolName || prev.label === symbolName)) {
              return { ...prev, usage_examples: examples };
            }
            return prev;
          });

          examples.forEach((ex: any) => {
            const nodeId = `${ex.file}:${ex.line}`;
            if (!data.nodes.find((n: any) => n.id === nodeId)) {
              data.nodes.push({
                id: nodeId,
                label: `Caller in ${ex.file.split('/').pop()}`,
                file: ex.file,
                type: 'function',
                line: ex.line
              });
              data.links.push({
                source: nodeId,
                target: data.nodes[0]?.id || symbolName,
                label: 'calls'
              });
            }
          });
        }
      }

      setDependencyData(data);
      setActiveTab('logic');
    } catch (err) {
      console.error(err);
      setError("Failed to generate logic flow.");
    } finally {
      setIsGeneratingGraph(false);
    }
  };

  const handleScanFile = async () => {
    if (!selectedFile) return;
    setIsScanningFile(true);
    try {
      const newHighlights = await analyzeFileSymbols(selectedFile.path, selectedFile.content);
      // Merge with existing highlights for this file
      setActiveHighlights(prev => {
        const others = prev.filter(h => h.file !== selectedFile.path);
        return [...others, ...newHighlights];
      });
      // Scroll to top to show the new symbols
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      setSidebarTab('focus');
    } catch (err) {
      console.error(err);
      setError("Failed to scan file symbols.");
    } finally {
      setIsScanningFile(false);
    }
  };

  const handleSelectRepoFromHome = (owner: string, name: string, branch: string) => {
    if (!owner) {
      setView('repo');
      setRepo(null);
      setFiles([]);
      setOverview(null);
      setStats(null);
      setUrl('');
      return;
    }
    const targetUrl = `https://github.com/${owner}/${name}`;
    handleFetchRepo(false, targetUrl);
  };

  if (isCheckingAuth) {
    return (
      <div className="h-screen w-full bg-slate-950 flex flex-col items-center justify-center gap-4">
        <Loader2 size={48} className="text-blue-500 animate-spin" />
        <div className="text-slate-500 font-bold uppercase tracking-widest text-xs">Verifying Session...</div>
      </div>
    );
  }

  if (view === 'home') {
    return (
      <>
        <HomePage 
          onSelectRepo={handleSelectRepoFromHome} 
          githubUser={githubUser}
          jwtToken={jwtToken}
          onConnectGitHub={handleConnectGitHub}
          onLogoutGitHub={handleLogoutGitHub}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onInstallGitHub={handleInstallGitHub}
        />
        <IndexingOverlay 
          isVisible={isIndexing} 
          repoName={repo ? `${repo.owner}/${repo.name}` : url} 
          loadingTime={loadingTime} 
          progress={indexingProgress}
        />
        <SettingsModal 
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onSave={handleSaveAIConfig}
          initialConfig={aiConfig}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-950">
      <header className="h-14 border-b border-slate-800 bg-slate-900/50 backdrop-blur-xl flex items-center px-6 justify-between shrink-0 z-50">
        <div className="flex items-center gap-3 shrink-0">
          <button 
            onClick={() => setView('home')}
            className="bg-blue-600 p-1.5 rounded-lg shadow-lg shadow-blue-500/20 hover:scale-110 transition-transform"
          >
            <Compass className="text-white" size={20} />
          </button>
          <h1 className="font-bold text-lg tracking-tight cursor-pointer" onClick={() => setView('home')}>
            GitLens <span className="text-blue-500">Cursor</span>
          </h1>
          <div className="h-4 w-[1px] bg-slate-700 mx-2" />
          <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-800 px-2 py-1 rounded border border-slate-700">
            <GitBranch size={12} />
            <span className="max-w-[150px] truncate">{repo ? `${repo.owner}/${repo.name}` : 'No repo loaded'}</span>
          </div>
        </div>
          <div className="flex-1 max-w-2xl px-8 flex gap-2">
            <div className="relative flex-1">
              <Github className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
              <input
                type="text" value={url} onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleFetchRepo()}
                placeholder="Paste GitHub URL..."
                className="w-full bg-slate-800 border border-slate-700 rounded-md py-1.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all placeholder:text-slate-600"
              />
            </div>
            <button
              onClick={() => handleFetchRepo()} disabled={isIndexing}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 shadow-lg shadow-blue-500/10 shrink-0"
            >
              {isIndexing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {isIndexing ? 'Mapping...' : 'Index Repo'}
            </button>
          </div>
        <div className="flex items-center gap-4 shrink-0">
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-blue-400 rounded-lg border border-slate-700 transition-all shadow-inner"
            title="AI Settings"
          >
            <Settings size={16} />
          </button>
          {githubUser ? (
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end">
                <span className="text-[10px] font-bold text-white leading-none">{githubUser.login}</span>
                <button 
                  onClick={handleLogoutGitHub}
                  className="text-[9px] text-slate-500 hover:text-red-400 font-bold uppercase tracking-widest mt-1 transition-colors"
                >
                  Disconnect
                </button>
              </div>
              <img 
                src={githubUser.avatar_url} 
                alt={githubUser.login} 
                className="h-8 w-8 rounded-full border border-slate-700 shadow-lg"
                referrerPolicy="no-referrer"
              />
            </div>
          ) : (
            <button 
              onClick={handleConnectGitHub}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-all text-[10px] font-bold uppercase tracking-widest"
            >
              <Github size={14} />
              Connect GitHub
            </button>
          )}
        </div>
      </header>

      {isIndexing && (
        <div className="bg-blue-600/10 border-b border-blue-500/20 p-2 flex items-center justify-center gap-3 text-blue-400 text-[10px] font-bold uppercase tracking-widest animate-in slide-in-from-top duration-300 relative z-40">
          <Loader2 size={14} className="animate-spin" />
          <span>
            {indexingProgress 
              ? (indexingProgress.total === 100 
                  ? `${indexingProgress.stage} (${indexingProgress.current}%)`
                  : `${indexingProgress.stage}: ${indexingProgress.current}/${indexingProgress.total} Files`)
              : 'Mapping Repository Architecture...'}
          </span>
          {indexingProgress && (
            <div className="w-32 h-1 bg-slate-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-300" 
                style={{ width: `${(indexingProgress.current / indexingProgress.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border-b border-red-500/20 p-2 flex items-center justify-center gap-3 text-red-400 text-xs font-medium animate-in slide-in-from-top duration-300 relative z-40">
          <AlertTriangle size={14} />
          <span className="truncate">{error}</span>
          <button onClick={() => setError(null)} className="ml-4 hover:text-white transition-colors shrink-0"><X size={14} /></button>
        </div>
      )}

      <main className="flex-1 flex overflow-hidden w-full relative">
        <aside className="w-64 border-r border-slate-800 bg-slate-950 flex flex-col shrink-0">
          <div className="p-3 border-b border-slate-800 flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">
            <Layers size={14} /> Filesystem
          </div>
          <div className="flex-1 overflow-hidden">
            <FileExplorer files={files} onSelectFile={handleSelectFile} selectedPath={selectedFile?.path || null} />
          </div>
        </aside>

        <section className="flex-1 flex flex-col min-w-0 bg-slate-900 border-r border-slate-800 relative overflow-hidden">
          <div className="h-10 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-950/50 shrink-0 z-10">
             <div className="flex items-center gap-4 h-full">
               <div className="flex h-full">
                 <button 
                   onClick={() => setActiveTab('dashboard')}
                   className={`px-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 ${activeTab === 'dashboard' ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                 >
                   <Activity size={14} /> Dashboard
                 </button>
                 <button 
                   onClick={() => setActiveTab('code')}
                   className={`px-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 ${activeTab === 'code' ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                 >
                   <Code2 size={14} /> Code
                 </button>
                 <button 
                   onClick={() => setActiveTab('map')}
                   className={`px-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 ${activeTab === 'map' ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                 >
                   <Map size={14} /> Visual Map
                 </button>
                 {dependencyData && (
                   <button 
                     onClick={() => setActiveTab('logic')}
                     className={`px-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 ${activeTab === 'logic' ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                   >
                     <Network size={14} /> Logic Flow
                   </button>
                 )}
               </div>
               {selectedFile && activeTab === 'code' && (
                 <div className="flex items-center gap-2 px-3 py-1 bg-slate-800/80 rounded-md border border-slate-700 text-[11px] font-medium text-blue-400 truncate max-w-[200px]">
                   {selectedFile.path.split('/').pop()}
                 </div>
               )}
             </div>
             <div className="flex items-center gap-2">
               {activeTab === 'code' && (
                 <button 
                  onClick={() => setShowHighlights(!showHighlights)}
                  className={`p-1.5 rounded-lg transition-all flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider ${showHighlights ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30 shadow-lg shadow-blue-500/5' : 'text-slate-500 border border-slate-800 hover:bg-slate-800'}`}
                 >
                   {showHighlights ? <Eye size={14} /> : <EyeOff size={14} />}
                   <span className="hidden sm:inline">{showHighlights ? 'Visible' : 'Hidden'}</span>
                 </button>
               )}
             </div>
          </div>
          <div className="flex-1 relative overflow-hidden min-w-0">
            {activeTab === 'dashboard' ? (
              stats ? (
                <Dashboard 
                  stats={stats} 
                  overview={overview} 
                  repoName={repo?.name || "Repository"} 
                  onRefresh={() => handleFetchRepo(true)}
                  isRefreshing={isIndexing}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-700 gap-4 opacity-50 p-10">
                  <Activity size={64} className="animate-pulse" />
                  <div className="text-center">
                    <p className="text-lg font-medium">Project Dashboard</p>
                    <p className="text-sm">Index a repository to see statistics and overview</p>
                  </div>
                </div>
              )
            ) : activeTab === 'code' ? (
              selectedFile ? (
                <CodeViewer 
                  content={selectedFile.content} 
                  filename={selectedFile.path} 
                  highlights={showHighlights ? (focusedFunction ? [focusedFunction] : activeHighlights) : []} 
                  scrollTrigger={scrollTrigger}
                  targetLine={targetLine}
                  onExplainSelection={handleExplainSelection}
                  onScanFile={handleScanFile}
                  isScanning={isScanningFile}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-700 gap-4 opacity-50 p-10">
                  <Terminal size={64} className="animate-pulse" />
                  <div className="text-center">
                    <p className="text-lg font-medium">Editor Workspace</p>
                    <p className="text-sm">Select a file from the sidebar or index a repository</p>
                  </div>
                </div>
              )
            ) : activeTab === 'map' ? (
              <RepoVisualizer files={files} onSelectFile={(path) => {
                handleSelectFile(path);
                setActiveTab('code');
              }} />
            ) : activeTab === 'logic' && dependencyData ? (
              <FlowVisualizer 
                data={dependencyData} 
                onClose={() => {
                  setDependencyData(null);
                  setActiveTab('code');
                }}
                onNavigate={(path, line) => {
                  handleNavigate(path, line);
                  setActiveTab('code');
                }}
              />
            ) : null}
          </div>
        </section>

        <aside className="w-[420px] min-w-[420px] max-w-[420px] bg-slate-950 flex flex-col shrink-0 border-l border-slate-800 z-20">
          <div className="border-b border-slate-800 bg-slate-950/80 backdrop-blur shrink-0">
            <div className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">
                <Activity size={14} className="text-blue-500" /> Intelligence
              </div>
              {isLoading && <div className="animate-spin text-blue-500"><Loader2 size={14} /></div>}
            </div>
            <div className="flex px-2 pb-2 gap-1">
              <button 
                onClick={() => setSidebarTab('map')}
                className={`flex-1 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${sidebarTab === 'map' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-slate-500 hover:bg-slate-800'}`}
              >
                Map
              </button>
              <button 
                onClick={() => setSidebarTab('focus')}
                className={`flex-1 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${sidebarTab === 'focus' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-slate-500 hover:bg-slate-800'}`}
              >
                Focus {activeHighlights.filter(h => selectedFile && h.file === selectedFile.path).length > 0 && `(${activeHighlights.filter(h => selectedFile && h.file === selectedFile.path).length})`}
              </button>
              <button 
                onClick={() => setSidebarTab('chat')}
                className={`flex-1 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${sidebarTab === 'chat' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-slate-500 hover:bg-slate-800'}`}
              >
                Chat {messages.length > 0 && `(${messages.length})`}
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-6 custom-scrollbar bg-slate-950 scroll-smooth">
            {sidebarTab === 'focus' && (
              <div className="flex flex-col gap-4 animate-in fade-in duration-300">
                {focusedFunction ? (
                  <div className="flex flex-col gap-6">
                    <div className="flex items-center justify-between">
                      <button 
                        onClick={() => setFocusedFunction(null)}
                        className="flex items-center gap-2 text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors uppercase tracking-widest"
                      >
                        <ChevronRight size={14} className="rotate-180" /> Back to list
                      </button>
                      <div className="text-[10px] mono text-slate-500 font-bold">L{focusedFunction.start} - L{focusedFunction.end}</div>
                    </div>

                    <div className="bg-slate-900 border border-blue-500/40 rounded-3xl shadow-2xl p-6 border-t-8 border-t-blue-600 relative">
                      <div className="flex items-center gap-3 text-blue-400 mb-6">
                        <div className="p-2 bg-blue-500/20 rounded-xl"><Cpu size={20} /></div>
                        <div className="flex flex-col">
                          <span className="font-black text-xs tracking-tight text-white uppercase">Focus Detail</span>
                          <span className="text-[13px] font-bold text-blue-300 mono truncate">{focusedFunction.function_name || focusedFunction.label}</span>
                        </div>
                      </div>

                      <div className="space-y-5">
                        <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800">
                          <div className="text-[10px] text-slate-600 uppercase font-black mb-2 flex items-center gap-2 tracking-widest">
                            <Info size={14} className="text-blue-500" /> 
                            {focusedFunction.logic_source === 'Repository Structure' ? 'Role in Module' : 'Responsibility'}
                          </div>
                          <p className="text-[13px] text-slate-300 leading-relaxed">{focusedFunction.description || focusedFunction.explanation}</p>
                        </div>

                        <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800">
                          <div className="text-[10px] text-slate-600 uppercase font-black mb-2 flex items-center gap-2 tracking-widest">
                            <ArrowRightCircle size={14} className="text-blue-500" /> 
                            {focusedFunction.logic_source === 'Repository Structure' ? 'Context' : 'Data Flow'}
                          </div>
                          <p className="text-[13px] text-slate-300 leading-relaxed italic opacity-80">{focusedFunction.logic_source || "Input/Output Signature"}</p>
                          {(focusedFunction.params || focusedFunction.returns) && (
                            <div className="mt-3 p-3 rounded-lg bg-blue-500/5 border border-blue-500/10 space-y-2">
                              {focusedFunction.params && (
                                <div>
                                  <div className="text-[9px] uppercase font-bold text-blue-400/70 mb-1">Arguments</div>
                                  <div className="text-[11px] mono text-blue-300 break-all">{focusedFunction.params}</div>
                                </div>
                              )}
                              {focusedFunction.returns && (
                                <div>
                                  <div className="text-[9px] uppercase font-bold text-emerald-400/70 mb-1">Returns</div>
                                  <div className="text-[11px] mono text-emerald-300 break-all">{focusedFunction.returns}</div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {focusedFunction.usage_examples && focusedFunction.usage_examples.length > 0 && (
                          <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800">
                            <div className="text-[10px] text-emerald-500 uppercase font-black mb-3 flex items-center gap-2 tracking-widest"><Activity size={14} /> Contextual Examples</div>
                            <div className="space-y-3">
                              {(focusedFunction.usage_examples || []).slice(0, 3).map((ex, i) => (
                                <div key={i} className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/50 hover:border-blue-500/30 transition-all group cursor-pointer"
                                  onClick={() => handleNavigate(ex.file, ex.line)}
                                >
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="text-[9px] font-bold text-slate-500 mono truncate max-w-[150px]">{ex.file.split('/').pop()}</div>
                                    <div className="text-[9px] text-blue-400/50 group-hover:text-blue-400 transition-colors">L{ex.line}</div>
                                  </div>
                                  <div className="text-[10px] mono text-blue-300/80 bg-slate-950 p-2 rounded-lg border border-slate-800/50 mb-2 break-all">
                                    {ex.arguments}
                                  </div>
                                  <p className="text-[10px] text-slate-500 leading-relaxed italic">{ex.context_explanation}</p>
                                </div>
                              ))}
                              {(focusedFunction.usage_examples || []).length > 3 && (
                                <button 
                                  onClick={() => setActiveTab('logic')}
                                  className="w-full py-2 text-[9px] font-bold text-slate-600 hover:text-blue-400 uppercase tracking-widest transition-colors"
                                >
                                  + {(focusedFunction.usage_examples || []).length - 3} more in Logic Flow
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        <div className="pt-2">
                          <button 
                            onClick={() => handleVisualizeDependencies(focusedFunction)}
                            disabled={isGeneratingGraph}
                            className="w-full flex items-center justify-center gap-3 py-3 rounded-2xl border border-slate-800 bg-slate-950/50 hover:bg-slate-900 hover:border-blue-500/50 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-blue-400 transition-all disabled:opacity-50 shadow-lg shadow-blue-500/5"
                          >
                            {isGeneratingGraph ? <Loader2 size={16} className="animate-spin" /> : <Network size={16} />}
                            {isGeneratingGraph ? 'Tracing Logic...' : 'Generate Logic Flow'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {selectedFile && activeHighlights.filter(h => h.file === selectedFile.path).length > 0 ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between px-2 mb-1">
                          <div className="text-[10px] font-bold text-blue-500 uppercase tracking-[0.2em] flex items-center gap-2">
                            <Sparkles size={12} /> Identified Focus
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                          {activeHighlights.filter(h => h.file === selectedFile.path).map((h, idx) => (
                            <div key={idx} onClick={() => handleNavigate(h.file, h.start, h)}
                              className={`flex items-center justify-between p-4 border rounded-2xl transition-all text-left group shadow-sm cursor-pointer ${focusedFunction === h ? 'bg-blue-600/10 border-blue-500 shadow-blue-500/10' : 'bg-slate-900 border border-slate-800 hover:border-blue-500/50 hover:bg-slate-800/80'}`}
                            >
                              <div className="flex flex-col overflow-hidden">
                                <span className="text-[13px] font-bold text-slate-100 mono group-hover:text-blue-300 transition-colors truncate">{h.function_name || h.label}</span>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-[10px] bg-slate-800 text-blue-400 px-1.5 py-0.5 rounded border border-slate-700 font-mono font-bold">L{h.start}</span>
                                  {h.params && <span className="text-[9px] text-slate-500 truncate max-w-[150px] italic">({h.params})</span>}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleVisualizeDependencies(h);
                                  }}
                                  className="p-2 bg-slate-800 hover:bg-blue-600 text-slate-400 hover:text-white rounded-lg transition-all border border-slate-700 shadow-inner"
                                  title="Visualize Dependencies"
                                >
                                  {isGeneratingGraph ? <Loader2 size={14} className="animate-spin" /> : <Network size={14} />}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="h-64 flex flex-col items-center justify-center text-slate-700 gap-4 opacity-50">
                        <Code2 size={48} />
                        <div className="text-center">
                          <p className="text-sm font-medium">No symbols identified</p>
                          <p className="text-[11px]">Click "Scan Symbols" in the editor to analyze this file</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {sidebarTab === 'map' && overview && (
              <div className="bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-800 p-6 space-y-6 animate-in fade-in duration-300 shadow-2xl overflow-hidden shrink-0">
                <div className="flex items-center gap-3 text-blue-400">
                  <div className="p-2 bg-blue-500/10 rounded-xl border border-blue-500/20"><Map size={20} /></div>
                  <div className="flex flex-col">
                    <span className="font-bold text-sm tracking-tight text-white">Repository Map</span>
                    <span className="text-[10px] text-slate-500 uppercase font-mono tracking-widest">{overview.architecture_type}</span>
                  </div>
                </div>
                <div className="border-l-4 border-blue-500/20 pl-4 py-1">
                  <FormattedText text={overview.summary} />
                </div>
                <div className="space-y-3">
                  <div className="text-[10px] font-bold text-slate-600 uppercase pl-1 tracking-[0.2em]">Entry Points</div>
                  <div className="grid grid-cols-1 gap-2">
                    {(overview.entry_points || []).map((ep, i) => (
                      <button key={i} onClick={() => handleNavigate(ep.path)}
                        className="w-full flex items-start gap-4 p-3 rounded-xl bg-slate-950/80 border border-slate-800 hover:border-blue-500/50 hover:bg-slate-900 transition-all text-left group shadow-sm"
                      >
                        <ExternalLink size={14} className="mt-0.5 text-slate-600 group-hover:text-blue-400 transition-colors" />
                        <div className="flex-1 overflow-hidden">
                          <div className="text-[12px] font-bold text-slate-100 mono group-hover:text-blue-300 transition-colors truncate">{ep.path.split('/').pop()}</div>
                          <div className="text-[11px] text-slate-500 leading-tight mt-1">{ep.purpose}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="text-[10px] font-bold text-slate-600 uppercase pl-1 tracking-[0.2em]">Core Modules</div>
                  <div className="grid grid-cols-1 gap-2">
                    {(overview.core_modules || []).map((cm, i) => (
                      <button key={i} onClick={() => handleModuleClick(cm.folder, cm.description)}
                        className="w-full p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 hover:border-blue-500/50 hover:bg-slate-900 transition-all text-left group shadow-sm"
                      >
                        <div className="text-[12px] font-bold text-blue-400 mono flex items-center gap-2 group-hover:translate-x-1 transition-transform">
                          <FolderOpen size={14} className="text-blue-500" /> {cm.folder}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-2 leading-relaxed">{cm.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {sidebarTab === 'chat' && (
              <div className="flex flex-col gap-6 animate-in fade-in duration-300">
                {isLoading && currentSources.length > 0 && (
                  <div className="flex items-center gap-2 text-[10px] text-emerald-500 font-bold uppercase tracking-widest animate-pulse px-2">
                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
                    Retrieved {currentSources.length} relevant snippets
                  </div>
                )}
                {messages.length === 0 ? (
                  <div className="h-64 flex flex-col items-center justify-center text-slate-700 gap-4 opacity-50">
                    <Activity size={48} />
                    <div className="text-center">
                      <p className="text-sm font-medium">No messages yet</p>
                      <p className="text-[11px]">Ask a question about the code below</p>
                    </div>
                  </div>
                ) : (
                  messages.map((m, i) => (
                    <div key={i} className={`flex flex-col gap-3 ${m.role === 'user' ? 'items-end' : 'items-start animate-in fade-in slide-in-from-left-4'} shrink-0`}>
                      <div className={`max-w-[95%] p-4 rounded-2xl shadow-xl transition-all ${m.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none border border-blue-500 shadow-blue-500/20' : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none'}`}>
                         {m.role === 'assistant' ? <FormattedText text={m.content} onFileClick={handleSelectFile} /> : <div className="text-[13px] font-medium opacity-90">{m.content}</div>}
                         {m.sources && m.sources.length > 0 && (
                           <div className="mt-4 pt-3 border-t border-slate-800 flex flex-col gap-2">
                             <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                               <Map size={10} className="text-emerald-500" /> Retrieved Context
                             </div>
                             <div className="flex flex-wrap gap-1.5">
                               {m.sources.map((s, idx) => (
                                 <button 
                                   key={idx}
                                   onClick={() => handleNavigate(s.path, s.startLine)}
                                   className="text-[9px] px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded border border-slate-700 transition-colors truncate max-w-[150px]"
                                 >
                                   {s.path.split('/').pop()} (L{s.startLine})
                                 </button>
                               ))}
                             </div>
                           </div>
                         )}
                      </div>
                      {m.analysis && (
                        <div className="w-full flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-500">
                          {m.analysis.call_tree_markdown && m.analysis.call_tree_markdown.trim() !== "" && (
                            <div className="bg-slate-900/40 rounded-2xl p-4 border border-slate-800/50 shadow-inner">
                              <div className="flex items-center gap-2 text-[10px] font-bold text-slate-600 mb-3 uppercase tracking-widest">
                                <GitBranch size={12} className="rotate-90 text-blue-500" /> Context Tree
                              </div>
                              <div 
                                className="mono text-[11px] text-slate-400 whitespace-pre-wrap leading-relaxed bg-slate-950/50 p-3 rounded-xl border border-slate-800 border-l-2 border-l-blue-500/50 max-h-[300px] overflow-y-auto custom-scrollbar"
                                onWheel={(e) => e.stopPropagation()}
                              >
                                {m.analysis.call_tree_markdown}
                              </div>
                            </div>
                          )}
                          {m.analysis.highlights && m.analysis.highlights.length > 0 && (
                            <div className="flex flex-col gap-2">
                              <div className="text-[10px] font-bold text-slate-600 uppercase pl-2 tracking-[0.2em] mb-1">Identified Focus</div>
                              <div className="grid grid-cols-1 gap-2">
                                {m.analysis.highlights.map((h, idx) => (
                                  <div key={idx} onClick={() => handleNavigate(h.file, h.start, h)}
                                    className={`flex items-center justify-between p-4 border rounded-2xl transition-all text-left group shadow-sm cursor-pointer ${focusedFunction === h ? 'bg-blue-600/10 border-blue-500 shadow-blue-500/10' : 'bg-slate-900 border border-slate-800 hover:border-blue-500/50 hover:bg-slate-800/80'}`}
                                  >
                                    <div className="flex flex-col overflow-hidden">
                                      <span className="text-[13px] font-bold text-slate-100 mono group-hover:text-blue-300 transition-colors truncate">{h.function_name || h.label}</span>
                                      <span className="text-[11px] text-slate-500 mono opacity-80 mt-1 truncate">{h.file.split('/').pop()}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleVisualizeDependencies(h);
                                        }}
                                        className="p-2 bg-slate-800 hover:bg-blue-600 text-slate-400 hover:text-white rounded-lg transition-all border border-slate-700"
                                        title="Visualize Dependencies"
                                      >
                                        {isGeneratingGraph ? <Loader2 size={14} className="animate-spin" /> : <Network size={14} />}
                                      </button>
                                      {h.start !== undefined && (
                                        <div className="text-[10px] bg-slate-800 text-blue-400 px-2.5 py-1 rounded-lg border border-slate-700 font-mono font-bold shrink-0">L{h.start}</div>
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
                  )
                ))}
              </div>
            )}
            
            {isLoading && (
              <div className="flex flex-col gap-4 animate-pulse opacity-40 shrink-0">
                <div className="h-4 bg-slate-800 rounded-full w-1/2" />
                <div className="h-32 bg-slate-800 rounded-2xl w-full" />
              </div>
            )}
          </div>

          <div className="p-4 border-t border-slate-800 bg-slate-950 shadow-[0_-10px_20px_rgba(0,0,0,0.5)] shrink-0">
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="flex items-center gap-2">
                <button 
                  type="button"
                  onClick={() => handleSaveAIConfig({ ...aiConfig, useFlash: !aiConfig.useFlash })}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-[10px] font-bold uppercase tracking-widest ${
                    aiConfig.useFlash 
                      ? "bg-blue-500/10 border-blue-500/30 text-blue-400" 
                      : "bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-700"
                  }`}
                >
                  <Sparkles size={12} className={aiConfig.useFlash ? "animate-pulse" : ""} />
                  {aiConfig.useFlash ? "Speed Mode (Flash)" : "Quality Mode (Pro)"}
                </button>
              </div>
              {isLoading && (
                <div className="text-[10px] text-slate-500 font-mono flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" />
                  Analyzing... ({loadingTime}s)
                </div>
              )}
            </div>
            <form onSubmit={handleQuery} className="relative group">
              <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask about logic implementation..."
                className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3.5 pl-5 pr-12 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-slate-600"
              />
              <button type="submit" disabled={isLoading} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-blue-600 text-white shadow-lg shadow-blue-500/20 hover:bg-blue-500 transition-all disabled:opacity-30">
                <ChevronRight size={20} />
              </button>
            </form>
          </div>
        </aside>
      </main>
      <IndexingOverlay 
        isVisible={isIndexing} 
        repoName={repo ? `${repo.owner}/${repo.name}` : url} 
        loadingTime={loadingTime} 
        progress={indexingProgress}
      />
      <SettingsModal 
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveAIConfig}
        initialConfig={aiConfig}
      />
    </div>
  );
}
