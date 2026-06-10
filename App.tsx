
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAppContext } from './context/AppContext';
import { Github, GitBranch, Terminal, ChevronRight, Code2, Layers, Cpu, Compass, Map as MapIcon, ExternalLink, Activity, FolderOpen, Info, ArrowRightCircle, Eye, EyeOff, Network, Loader2, GitPullRequest, X, AlertTriangle, Sparkles, FileCode, Settings, Copy, Check } from 'lucide-react';
import { FileExplorer } from './components/FileExplorer';
import { CodeViewer } from './components/CodeViewer';
import { Repository, RepoFile, ChatMessage, AnalysisResult, Highlight, RepoOverview, DependencyGraphData, RepoStats, AIConfig } from './types';
import { parseRepoUrl, fetchRepoTree, fetchFileContent } from './services/github';
import { apiFetch } from './lib/api';
import { RateLimitCTA, DemoPausedNotice } from './components/RateLimitCTA';
import { analyzeCode, getRepoOverview, getFunctionFlow, explainSelection, getSymbolDependencies, analyzeFileSymbols, embedText, getUsageExamples, summarizeFile, summarizeSnippet, generateSearchQuery, setAIConfig } from './services/gemini';

import { RepoVisualizer } from './components/RepoVisualizer';
import { FlowVisualizer } from './components/FlowVisualizer';
import { Dashboard } from './components/Dashboard';
import { HomePage } from './components/HomePage';
import { IndexingOverlay } from './components/IndexingOverlay';
import { SettingsModal } from './components/SettingsModal';

import { ChatSidebar } from './components/ChatSidebar';
import { FormattedText } from './components/FormattedText';

export default function App() {
  const {
    guestId, setGuestId,
    url, setUrl,
    repo, setRepo,
    files, setFiles,
    selectedFile, setSelectedFile,
    query, setQuery,
    messages, setMessages,
    isLoading, setIsLoading,
    loadingTime, setLoadingTime,
    isIndexing, setIsIndexing,
    isSettingsOpen, setIsSettingsOpen,
    aiConfig, setAiConfigState,
    jwtToken, setJwtToken,
    attachedFiles, setAttachedFiles,
    showFileSuggestions, setShowFileSuggestions,
    fileSuggestions, setFileSuggestions,
    suggestionIndex, setSuggestionIndex,
    isDragging, setIsDragging,
    indexingProgress, setIndexingProgress,
    overview, setOverview,
    activeHighlights, setActiveHighlights,
    scrollTrigger, setScrollTrigger,
    targetLine, setTargetLine,
    focusedFunction, setFocusedFunction,
    showHighlights, setShowHighlights,
    dependencyData, setDependencyData,
    isGeneratingGraph, setIsGeneratingGraph,
    isScanningFile, setIsScanningFile,
    error, setError,
    currentSources, setCurrentSources,
    activeTab, setActiveTab,
    sidebarTab, setSidebarTab,
    view, setView,
    showFilesystem, setShowFilesystem,
    showIntelligence, setShowIntelligence,
    stats, setStats,
    githubUser, setGithubUser,
    githubToken, setGithubToken,
    isCheckingAuth, setIsCheckingAuth
  } = useAppContext();

  // Rate-limit CTA (429) and demo-paused notice (503) — fired by apiFetch
  const [rateLimitQueries, setRateLimitQueries] = useState<number | null>(null);
  const [pausedMessage, setPausedMessage] = useState<string | null>(null);

  useEffect(() => {
    const onRateLimit = (e: Event) => {
      setRateLimitQueries((e as CustomEvent).detail?.queriesUsed ?? 0);
    };
    const onPaused = (e: Event) => {
      setPausedMessage((e as CustomEvent).detail?.message || 'This demo is temporarily paused.');
    };
    window.addEventListener('gitlens:rate-limit', onRateLimit);
    window.addEventListener('gitlens:demo-paused', onPaused);
    return () => {
      window.removeEventListener('gitlens:rate-limit', onRateLimit);
      window.removeEventListener('gitlens:demo-paused', onPaused);
    };
  }, []);

  useEffect(() => {
    let gid = localStorage.getItem('gitlens_guest_id');
    if (!gid) {
      gid = 'guest_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('gitlens_guest_id', gid);
    }
    setGuestId(gid);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('ai_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.useFlash === undefined) parsed.useFlash = true;
        setAIConfig(parsed);
        setAiConfigState(parsed);
      } catch (e) {}
    }
  }, []);

  const getJwtToken = () => {
    return jwtToken || localStorage.getItem('gitlens_token');
  };

  const handleSaveAIConfig = async (config: AIConfig, tokenOverride?: string) => {
    setAiConfigState(config);
    setAIConfig(config);
    localStorage.setItem('ai_config', JSON.stringify(config));
    
    const token = tokenOverride || getJwtToken();
    if (token) {
      try {
        console.log("Saving AI config to server...");
        const res = await apiFetch('/api/user/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(config)
        });
        if (res.ok) {
          console.log("AI config saved to server successfully");
        } else {
          console.error("Failed to save AI config to server:", res.status);
        }
      } catch (e) {
        console.error("Failed to save user config to server:", e);
      }
    } else {
      console.log("No JWT token found, skipping server save for AI config");
    }
  };
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Generate or retrieve guest ID for anonymous tracking
    let gid = localStorage.getItem('gitlens_guest_id');
    if (!gid) {
      gid = 'guest_' + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('gitlens_guest_id', gid);
    }

    const token = localStorage.getItem('gitlens_token');
    if (token) {
      setJwtToken(token);
      checkAuth(token);
    } else {
      setIsCheckingAuth(false);
    }
    
    const handleMessage = (event: MessageEvent) => {
      // Validate origin to prevent cross-site scripting attacks
      if (event.origin !== window.location.origin && !event.origin.endsWith('.run.app') && !event.origin.includes('localhost')) {
        return;
      }
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
      const res = await apiFetch('/api/auth/me', {
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
        
        // Fetch user config from server
        fetchUserConfig(activeToken);
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

  const fetchUserConfig = async (token: string) => {
    try {
      console.log("Fetching user AI config from server...");
      const res = await apiFetch('/api/user/config', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const config = await res.json();
        console.log("Server AI config response:", config);
        if (config && Object.keys(config).length > 0 && config.apiKey) {
          // Server has config, update local
          console.log("Applying server AI config to local state");
          setAiConfigState(config);
          setAIConfig(config);
          localStorage.setItem('ai_config', JSON.stringify(config));
        } else {
          // Server has no config, push local if it has an API key
          console.log("Server has no AI config, checking local storage...");
          const localSaved = localStorage.getItem('ai_config');
          if (localSaved) {
            try {
              const localConfig = JSON.parse(localSaved);
              if (localConfig.apiKey) {
                console.log("Pushing local AI config to server...");
                handleSaveAIConfig(localConfig, token);
              } else {
                console.log("Local AI config has no API key, skipping push");
              }
            } catch (e) {
              console.error("Failed to parse local AI config:", e);
            }
          } else {
            console.log("No local AI config found to push");
          }
        }
      } else {
        console.error("Failed to fetch user config from server, status:", res.status);
      }
    } catch (e) {
      console.error("Failed to fetch user config:", e);
    }
  };

  const handleConnectGitHub = async () => {
    try {
      const res = await apiFetch('/api/auth/github/url');
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
      const res = await apiFetch('/api/auth/github/url');
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

      // 1. Check Cache first
      let repoId: string | null = null;
      let oldFiles: any[] = [];
      let isIncremental = false;

      try {
        console.time("fetchCache");
        const headers: Record<string, string> = {
          'X-Guest-ID': localStorage.getItem('gitlens_guest_id') || ''
        };
        const activeToken = getJwtToken();
        if (activeToken) {
          headers['Authorization'] = `Bearer ${activeToken}`;
        }
        const cacheRes = await apiFetch(`/api/repo?owner=${parsed.owner}&name=${parsed.name}&branch=${parsed.branch}`, { headers });
        const contentType = cacheRes.headers.get("content-type");
        
        if (cacheRes.ok && contentType && contentType.includes("application/json")) {
          const cachedData = await cacheRes.json();
          repoId = cachedData._id;
          oldFiles = cachedData.files || [];
          
          if (!forceRefresh) {
            console.timeEnd("fetchCache");
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
            isIncremental = true;
            console.timeEnd("fetchCache");
          }
        } else {
          console.timeEnd("fetchCache");
          if (!forceRefresh) {
            console.warn("Cache fetch returned non-JSON or error:", cacheRes.status);
          }
        }
      } catch (cacheErr) {
        console.timeEnd("fetchCache");
        console.warn("Cache fetch failed, falling back to GitHub", cacheErr);
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
          const { content } = await fetchFileContent(parsed, contextFile.path, githubToken || undefined);
          context = content;
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
            const { content } = await fetchFileContent(parsed, topEntry, githubToken || undefined);
            initialHighlights = await analyzeFileSymbols(topEntry, content);
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
        const headers: Record<string, string> = { 
          'Content-Type': 'application/json',
          'X-Guest-ID': localStorage.getItem('gitlens_guest_id') || ''
        };
        const activeToken = getJwtToken();
        if (activeToken) {
          headers['Authorization'] = `Bearer ${activeToken}`;
        }

        const saveRes = await apiFetch('/api/repo', {
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
          let codeFiles = tree.filter(f => 
            f.type === 'blob' && 
            /\.(ts|tsx|js|jsx|py|go|java|cpp|c|h|cs|rb|php|rs|swift|kt)$/i.test(f.path) &&
            !f.path.includes('node_modules') &&
            !f.path.includes('dist')
          ).slice(0, 50); // Limit to 50 files for now to avoid rate limits

          let deletedFiles: string[] = [];

          if (isIncremental) {
            const oldFileMap = new Map(oldFiles.map(f => [f.path, f.sha]));
            const newFileMap = new Map(tree.map(f => [f.path, f.sha]));
            
            // Find deleted files
            for (const path of oldFileMap.keys()) {
              if (!newFileMap.has(path)) {
                deletedFiles.push(path);
              }
            }

            // Filter codeFiles to only include modified or new files
            codeFiles = codeFiles.filter(f => {
              const oldSha = oldFileMap.get(f.path);
              return !oldSha || oldSha !== f.sha;
            });

            console.log(`Incremental sync: ${codeFiles.length} files to update, ${deletedFiles.length} files deleted.`);
          }

          setIndexingProgress({ current: 0, total: codeFiles.length, stage: 'Deep Indexing' });

          const allSnippets: any[] = [];
          const BATCH_SIZE = 5;
          let completedFiles = 0;

          for (let i = 0; i < codeFiles.slice(0, 50).length; i += BATCH_SIZE) {
            const batch = codeFiles.slice(i, i + BATCH_SIZE);
            
            const batchResults = await Promise.all(batch.map(async (file) => {
              try {
                const { content } = await fetchFileContent(parsed, file.path, githubToken || undefined);
                
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

                  chunkPromises.push((async () => {
                    const chunkPurpose = await summarizeSnippet(file.path, chunkContent);
                    const embeddingText = `File: ${file.path}\nSummary: ${fileSummary}\nPurpose: ${chunkPurpose}\n\nCode:\n${chunkContent}`;
                    const chunkEmbedding = await embedText(embeddingText);
                    
                    if (chunkEmbedding.length > 0) {
                      return {
                        path: file.path,
                        content: chunkContent,
                        purpose: chunkPurpose,
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

          if (allSnippets.length > 0 || deletedFiles.length > 0) {
            setIndexingProgress(prev => prev ? { ...prev, stage: 'Saving Index' } : null);
            const headers: Record<string, string> = { 
              'Content-Type': 'application/json',
              'X-Guest-ID': localStorage.getItem('gitlens_guest_id') || ''
            };
            const activeToken = getJwtToken();
            if (activeToken) {
              headers['Authorization'] = `Bearer ${activeToken}`;
            }

            await apiFetch('/api/repo/index-snippets', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                owner: parsed.owner,
                name: parsed.name,
                repoId,
                snippets: allSnippets,
                incremental: isIncremental,
                deletedFiles
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

  const handleSelectFile = useCallback(async (path: string, r = repo) => {
    if (!r) return;
    try {
      const { content, isImage, downloadUrl } = await fetchFileContent(r, path, githubToken || undefined);
      setSelectedFile({ path, content, isImage, downloadUrl });
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to load file content.');
    }
  }, [repo, githubToken]);

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

  const runAnalysis = async (userQuery: string, history: { role: string; content: string }[] = [], forceFlash = false) => {
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
          // Use AI to generate a better search query based on history
          const searchQuery = await generateSearchQuery(userQuery, history);
          console.log(`[AI] Generated search query: "${searchQuery}" (Original: "${userQuery}")`);
          
          const queryVector = await embedText(searchQuery);
          
          const headers: Record<string, string> = { 
            'Content-Type': 'application/json',
            'X-Guest-ID': localStorage.getItem('gitlens_guest_id') || ''
          };
          const activeToken = getJwtToken();
          if (activeToken) {
            headers['Authorization'] = `Bearer ${activeToken}`;
          }

          // Run both searches in parallel for hybrid retrieval
          const [vectorRes, keywordRes] = await Promise.all([
            queryVector.length > 0 ? apiFetch('/api/search/snippets', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                vector: queryVector,
                owner: repo.owner,
                name: repo.name,
                limit: 5
              })
            }) : Promise.resolve(null),
            apiFetch('/api/search/keywords', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                query: searchQuery,
                owner: repo.owner,
                name: repo.name,
                limit: 3
              })
            })
          ]);

          let vectorSnippets = [];
          if (vectorRes && vectorRes.ok) {
            vectorSnippets = await vectorRes.json();
          }

          let keywordSnippets = [];
          if (keywordRes && keywordRes.ok) {
            keywordSnippets = await keywordRes.json();
          }

          // Combine and deduplicate snippets by path and startLine
          const combined = [...vectorSnippets, ...keywordSnippets];
          const seen = new Set();
          snippets = combined.filter(s => {
            const key = `${s.path}:${s.startLine}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          console.log(`[AI] Found ${snippets.length} relevant snippets (Vector: ${vectorSnippets.length}, Keyword: ${keywordSnippets.length}).`);
          setCurrentSources(snippets.map((s: any) => ({ path: s.path, startLine: s.startLine, endLine: s.endLine })));
        } catch (e) {
          console.warn("Hybrid search failed", e);
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
        snippets,
        attachedFiles.map(f => ({ path: f.path, content: f.content || '' })),
        history
      );
      const analysis = { 
        answer_markdown: rawAnalysis.answer_markdown || "No explanation provided.",
        highlights: Array.isArray(rawAnalysis.highlights) ? rawAnalysis.highlights : [],
        related: Array.isArray(rawAnalysis.related) ? rawAnalysis.related : [],
        call_tree_markdown: rawAnalysis.call_tree_markdown,
        context_bundles: rawAnalysis.context_bundles
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
    } catch (err: any) {
      console.error(err);
      setMessages(prev => [...prev, { role: 'assistant', content: err.message || "Failed to explain selection." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadBundle = async (bundle: { title: string; files: string[] }) => {
    setIsLoading(true);
    try {
      const bundleFiles: RepoFile[] = [];
      for (const path of bundle.files) {
        if (attachedFiles.some(af => af.path === path)) continue;
        const { content } = await fetchFileContent(repo!, path, githubToken || undefined);
        bundleFiles.push({ path, content, type: 'blob', sha: '', url: '' });
      }
      setAttachedFiles(prev => [...prev, ...bundleFiles]);
      setError(null);
    } catch (err: any) {
      console.error("Failed to load bundle:", err);
      setError(`Failed to load context bundle: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNavigate = useCallback((path: string, line?: number, highlight?: Highlight) => {
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
  }, [files, handleSelectFile]);

  const handleCloseLogicFlow = useCallback(() => {
    setDependencyData(null);
    setActiveTab('code');
  }, []);

  const handleNavigateFromFlow = useCallback((path: string, line?: number) => {
    handleNavigate(path, line);
    setActiveTab('code');
  }, [handleNavigate]);

  const handleSelectFileFromMap = useCallback((path: string) => {
    handleSelectFile(path);
    setActiveTab('code');
  }, [handleSelectFile]);

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
      const headers: Record<string, string> = {
        'X-Guest-ID': localStorage.getItem('gitlens_guest_id') || ''
      };
      const activeToken = getJwtToken();
      if (activeToken) {
        headers['Authorization'] = `Bearer ${activeToken}`;
      }
      const searchResPromise = repo ? apiFetch(`/api/search/usages?symbol=${encodeURIComponent(symbolName)}&owner=${repo.owner}&name=${repo.name}`, { headers }) : Promise.resolve(new Response(JSON.stringify([])));

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
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to generate logic flow.");
    } finally {
      setIsGeneratingGraph(false);
    }
  };

  const handleScanFile = async () => {
    if (!selectedFile) return;
    setIsScanningFile(true);
    try {
      console.log(`[AI] Scanning file: ${selectedFile.path}`);
      const rawHighlights = await analyzeFileSymbols(selectedFile.path, selectedFile.content);
      const newHighlights = refineHighlights(rawHighlights, selectedFile.content);
      
      console.log(`[AI] New highlights for ${selectedFile.path}:`, newHighlights);
      
      // Merge with existing highlights for this file
      setActiveHighlights(prev => {
        const others = prev.filter(h => h.file !== selectedFile.path);
        const merged = [...others, ...newHighlights];
        console.log(`[AI] Total active highlights:`, merged.length);
        return merged;
      });
      // Scroll to top to show the new symbols
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      setSidebarTab('focus');
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to scan file symbols.");
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
    const targetUrl = `https://github.com/${owner}/${name}${branch ? `/tree/${branch}` : ''}`;
    handleFetchRepo(false, targetUrl);
  };

  if (isCheckingAuth) {
    return (
      <div className="h-screen w-full atmosphere flex flex-col items-center justify-center gap-4">
        <Loader2 size={48} className="text-neutral-400 animate-spin" />
        <div className="text-neutral-500 font-bold uppercase tracking-widest text-xs">Verifying Session...</div>
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
        {rateLimitQueries !== null && (
          <RateLimitCTA queriesMade={rateLimitQueries} onDismiss={() => setRateLimitQueries(null)} />
        )}
        {pausedMessage && (
          <DemoPausedNotice message={pausedMessage} onDismiss={() => setPausedMessage(null)} />
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden atmosphere text-neutral-200 selection:bg-brand-primary/30 selection:text-white">
      <header className="h-16 border-b border-white/5 bg-black/40 backdrop-blur-2xl flex items-center px-6 justify-between shrink-0 z-50 relative">
        {/* Subtle top glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-[1px] bg-gradient-to-r from-transparent via-brand-primary/50 to-transparent" />
        
        <div className="flex items-center gap-4 shrink-0">
          <button 
            onClick={() => setView('home')}
            className="group relative p-1 bg-brand-primary/20 rounded-xl border border-brand-primary/30 shadow-2xl shadow-brand-primary/10 hover:scale-105 active:scale-95 transition-all overflow-hidden"
          >
            <img 
              src="https://lh3.googleusercontent.com/d/1BsnWw-CATwkex6B7siv_WaRHFDu_M5o9" 
              alt="GitLens Logo" 
              className="h-8 w-8 object-contain"
              referrerPolicy="no-referrer"
            />
          </button>
          <div className="flex flex-col">
            <h1 className="font-bold text-base tracking-tight cursor-pointer text-white flex items-center gap-2" onClick={() => setView('home')}>
              GitLens
            </h1>
            {repo && (
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-neutral-500 uppercase tracking-widest mt-0.5">
                <GitBranch size={10} className="opacity-50" />
                <span className="max-w-[120px] truncate">{repo.owner}/{repo.name}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 max-w-xl px-12 flex gap-3">
          <div className="relative flex-1 group">
            <div className="absolute inset-0 bg-brand-primary/5 rounded-xl blur-xl opacity-0 group-focus-within:opacity-100 transition-opacity" />
            <Github className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500 group-focus-within:text-brand-primary transition-colors" size={16} />
            <input
              type="text" value={url} onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleFetchRepo()}
              placeholder="Paste GitHub URL to index..."
              className="w-full bg-neutral-900/50 border border-white/5 rounded-xl py-2.5 pl-11 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary/50 transition-all placeholder:text-neutral-600 text-white relative z-10"
            />
          </div>
          <button
            onClick={() => handleFetchRepo()} disabled={isIndexing}
            className="bg-white hover:bg-neutral-200 disabled:opacity-50 text-black px-6 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 shadow-xl shadow-white/10 shrink-0 relative z-10 active:scale-95"
          >
            {isIndexing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {isIndexing ? 'Mapping...' : 'Index'}
          </button>
        </div>

        <div className="flex items-center gap-6 shrink-0">
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="p-2.5 bg-neutral-900/50 hover:bg-neutral-800/80 text-neutral-400 hover:text-white rounded-xl border border-white/5 transition-all shadow-inner group"
            title="AI Settings"
          >
            <Settings size={18} className="group-hover:rotate-45 transition-transform duration-500" />
          </button>
          
          <div className="h-8 w-[1px] bg-white/5" />

          {githubUser ? (
            <div className="flex items-center gap-3 pl-2">
              <div className="flex flex-col items-end">
                <span className="text-xs font-bold text-white leading-none">{githubUser.login}</span>
                <button 
                  onClick={handleLogoutGitHub}
                  className="text-[9px] text-neutral-500 hover:text-red-400 font-bold uppercase tracking-widest mt-1 transition-colors"
                >
                  Disconnect
                </button>
              </div>
              <div className="relative group">
                <div className="absolute inset-0 bg-brand-primary/20 rounded-full blur-md opacity-0 group-hover:opacity-100 transition-opacity" />
                <img 
                  src={githubUser.avatar_url} 
                  alt={githubUser.login} 
                  className="h-9 w-9 rounded-full border border-white/10 shadow-xl relative z-10"
                  referrerPolicy="no-referrer"
                />
              </div>
            </div>
          ) : (
            <button 
              onClick={handleConnectGitHub}
              className="flex items-center gap-2 px-4 py-2 bg-neutral-900/50 hover:bg-neutral-800 text-neutral-300 rounded-xl border border-white/5 transition-all text-[10px] font-bold uppercase tracking-widest"
            >
              <Github size={14} />
              Connect
            </button>
          )}
        </div>
      </header>

      {isIndexing && (
        <div className="bg-neutral-400/10 border-b border-neutral-400/20 p-2 flex items-center justify-center gap-3 text-neutral-400 text-[10px] font-bold uppercase tracking-widest animate-in slide-in-from-top duration-300 relative z-40">
          <Loader2 size={14} className="animate-spin" />
          <span>
            {indexingProgress 
              ? (indexingProgress.total === 100 
                  ? `${indexingProgress.stage} (${indexingProgress.current}%)`
                  : `${indexingProgress.stage}: ${indexingProgress.current}/${indexingProgress.total} Files`)
              : 'Mapping Repository Architecture...'}
          </span>
          {indexingProgress && (
            <div className="w-32 h-1 bg-neutral-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-neutral-400 transition-all duration-300" 
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
        {showFilesystem && (
          <aside className="w-64 border-r border-white/5 bg-neutral-950 flex flex-col shrink-0 animate-in slide-in-from-left duration-300">
            <div className="p-4 border-b border-white/5 flex items-center justify-between text-[10px] font-bold text-neutral-500 uppercase tracking-[0.2em]">
              <div className="flex items-center gap-2">
                <Layers size={14} className="text-brand-primary" /> Filesystem
              </div>
              <button 
                onClick={() => setShowFilesystem(false)}
                className="p-1 hover:bg-white/5 rounded-md transition-all text-neutral-600 hover:text-neutral-300"
                title="Hide Sidebar"
              >
                <EyeOff size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <FileExplorer files={files} onSelectFile={handleSelectFile} selectedPath={selectedFile?.path || null} />
            </div>
          </aside>
        )}

        <section className="flex-1 flex flex-col min-w-0 bg-neutral-950 border-r border-white/5 relative overflow-hidden">
          <div className="h-12 border-b border-white/5 flex items-center justify-between px-4 bg-black/20 backdrop-blur-md shrink-0 z-10">
             <div className="flex items-center gap-4 h-full">
               {!showFilesystem && (
                 <button 
                   onClick={() => setShowFilesystem(true)}
                   className="p-1.5 bg-brand-primary/10 text-brand-primary border border-brand-primary/20 rounded-lg hover:bg-brand-primary/20 transition-all flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest"
                   title="Show Sidebar"
                 >
                   <FolderOpen size={14} />
                   Files
                 </button>
               )}
               <div className="flex h-full p-1 gap-1">
                 {[
                   { id: 'dashboard', label: 'Dashboard', icon: Activity },
                   { id: 'code', label: 'Code', icon: Code2 },
                   { id: 'map', label: 'Visual Map', icon: MapIcon },
                   ...(dependencyData ? [{ id: 'logic', label: 'Logic Flow', icon: Network }] : [])
                 ].map((tab) => (
                   <button 
                     key={tab.id}
                     onClick={() => setActiveTab(tab.id as any)}
                     className={`px-4 rounded-lg flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest transition-all ${
                       activeTab === tab.id 
                         ? 'bg-white/10 text-white shadow-inner' 
                         : 'text-neutral-500 hover:text-neutral-300 hover:bg-white/5'
                     }`}
                   >
                     <tab.icon size={14} /> {tab.label}
                   </button>
                 ))}
               </div>
               {selectedFile && activeTab === 'code' && (
                 <div className="flex items-center gap-2 px-3 py-1 bg-neutral-900/50 rounded-lg border border-white/5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest truncate max-w-[200px]">
                   <div className="w-1 h-1 rounded-full bg-brand-primary" />
                   {selectedFile.path.split('/').pop()}
                 </div>
               )}
             </div>
             <div className="flex items-center gap-2">
               {!showIntelligence && (
                 <button 
                   onClick={() => setShowIntelligence(true)}
                   className="p-1.5 bg-brand-primary/10 text-brand-primary border border-brand-primary/20 rounded-lg hover:bg-brand-primary/20 transition-all flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest"
                   title="Show Intelligence"
                 >
                   <Activity size={14} />
                   Intelligence
                 </button>
               )}
               {activeTab === 'code' && (
                 <button 
                  onClick={() => setShowHighlights(!showHighlights)}
                  className={`p-1.5 rounded-lg transition-all flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider border ${
                    showHighlights 
                      ? 'bg-brand-primary/10 text-brand-primary border-brand-primary/30 shadow-lg shadow-brand-primary/5' 
                      : 'text-neutral-500 border-white/5 hover:bg-white/5'
                  }`}
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
                <div className="h-full flex flex-col items-center justify-center text-neutral-700 gap-4 opacity-50 p-10">
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
                  isImage={selectedFile.isImage}
                  downloadUrl={selectedFile.downloadUrl}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-neutral-700 gap-4 opacity-50 p-10">
                  <Terminal size={64} className="animate-pulse" />
                  <div className="text-center">
                    <p className="text-lg font-medium">Editor Workspace</p>
                    <p className="text-sm">Select a file from the sidebar or index a repository</p>
                  </div>
                </div>
              )
            ) : activeTab === 'map' ? (
              <RepoVisualizer files={files} onSelectFile={handleSelectFileFromMap} />
            ) : activeTab === 'logic' && dependencyData ? (
              <FlowVisualizer 
                data={dependencyData} 
                onClose={handleCloseLogicFlow}
                onNavigate={handleNavigateFromFlow}
              />
            ) : null}
          </div>
        </section>

        {showIntelligence && (
          <aside className="w-[420px] min-w-[420px] max-w-[420px] bg-neutral-950 flex flex-col shrink-0 border-l border-white/5 z-20 relative animate-in slide-in-from-right duration-300">
            <div className="border-b border-white/5 bg-black/20 backdrop-blur-xl shrink-0">
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] font-bold text-neutral-500 uppercase tracking-[0.2em]">
                  <Activity size={14} className="text-brand-primary" /> Intelligence
                </div>
                <div className="flex items-center gap-2">
                  {isLoading && <div className="animate-spin text-brand-primary"><Loader2 size={14} /></div>}
                  <button 
                    onClick={() => setShowIntelligence(false)}
                    className="p-1 hover:bg-white/5 rounded-md transition-all text-neutral-600 hover:text-neutral-300"
                    title="Hide Sidebar"
                  >
                    <EyeOff size={14} />
                  </button>
                </div>
              </div>
              <div className="flex px-3 pb-3 gap-1">
                {[
                  { id: 'map', label: 'Map' },
                  { id: 'focus', label: 'Focus', count: activeHighlights.filter(h => selectedFile && h.file === selectedFile.path).length },
                  { id: 'chat', label: 'Chat', count: messages.length }
                ].map((tab) => (
                  <button 
                    key={tab.id}
                    onClick={() => setSidebarTab(tab.id as any)}
                    className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${
                      sidebarTab === tab.id 
                        ? 'bg-white/10 text-white border-white/10 shadow-inner' 
                        : 'text-neutral-500 border-transparent hover:text-neutral-300 hover:bg-white/5'
                    }`}
                  >
                    {tab.label} {tab.count > 0 && <span className="ml-1 opacity-50">({tab.count})</span>}
                  </button>
                ))}
              </div>
            </div>

            {sidebarTab !== 'chat' ? (
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 flex flex-col gap-6 custom-scrollbar bg-neutral-950 scroll-smooth">
                {sidebarTab === 'focus' && (
                <div className="flex flex-col gap-4 animate-in fade-in duration-300">
                  {focusedFunction ? (
                    <div className="flex flex-col gap-6">
                      <div className="flex items-center justify-between">
                        <button 
                          onClick={() => setFocusedFunction(null)}
                          className="flex items-center gap-2 text-[10px] font-bold text-neutral-400 hover:text-neutral-400 transition-colors uppercase tracking-widest"
                        >
                          <ChevronRight size={14} className="rotate-180" /> Back to list
                        </button>
                        <div className="text-[10px] mono text-neutral-500 font-bold">L{focusedFunction.start} - L{focusedFunction.end}</div>
                      </div>

                      <div className="bg-neutral-900/50 border border-white/5 rounded-3xl shadow-2xl p-6 relative overflow-hidden group">
                        <div className="absolute inset-0 bg-gradient-to-br from-brand-primary/5 to-transparent opacity-50" />
                        
                        <div className="flex items-center gap-3 text-neutral-400 mb-6 relative z-10">
                          <div className="p-2.5 bg-brand-primary/10 text-brand-primary rounded-xl border border-brand-primary/20">
                            <Cpu size={20} />
                          </div>
                          <div className="flex flex-col">
                            <span className="font-bold text-[10px] tracking-[0.2em] text-neutral-500 uppercase">Focus Detail</span>
                            <span className="text-sm font-bold text-white mono truncate">{focusedFunction.function_name || focusedFunction.label}</span>
                          </div>
                        </div>

                        <div className="space-y-4 relative z-10">
                          <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
                            <div className="text-[9px] text-neutral-500 uppercase font-bold mb-2 flex items-center gap-2 tracking-widest">
                              <Info size={12} className="text-brand-primary" /> 
                              {focusedFunction.logic_source === 'Repository Structure' ? 'Role in Module' : 'Responsibility'}
                            </div>
                            <p className="text-xs text-neutral-300 leading-relaxed font-medium">{focusedFunction.description || focusedFunction.explanation}</p>
                          </div>

                          <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
                            <div className="text-[9px] text-neutral-500 uppercase font-bold mb-2 flex items-center gap-2 tracking-widest">
                              <ArrowRightCircle size={12} className="text-brand-primary" /> 
                            {focusedFunction.logic_source === 'Repository Structure' ? 'Context' : 'Data Flow'}
                          </div>
                          <p className="text-xs text-neutral-400 leading-relaxed italic opacity-80 font-medium">{focusedFunction.logic_source || "Input/Output Signature"}</p>
                          {(focusedFunction.params || focusedFunction.returns) && (
                            <div className="mt-3 p-3 rounded-xl bg-white/5 border border-white/5 space-y-2">
                              {focusedFunction.params && (
                                <div>
                                  <div className="text-[8px] uppercase font-bold text-neutral-500 mb-1">Arguments</div>
                                  <div className="text-[10px] mono text-neutral-400 break-all leading-relaxed">{focusedFunction.params}</div>
                                </div>
                              )}
                              {focusedFunction.returns && (
                                <div>
                                  <div className="text-[8px] uppercase font-bold text-emerald-500/70 mb-1">Returns</div>
                                  <div className="text-[10px] mono text-emerald-400/80 break-all leading-relaxed">{focusedFunction.returns}</div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {focusedFunction.usage_examples && focusedFunction.usage_examples.length > 0 && (
                          <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
                            <div className="text-[9px] text-brand-primary uppercase font-bold mb-3 flex items-center gap-2 tracking-widest">
                              <Activity size={12} /> Contextual Examples
                            </div>
                            <div className="space-y-2.5">
                              {(focusedFunction.usage_examples || []).slice(0, 3).map((ex, i) => (
                                <div key={i} className="p-3 rounded-xl bg-neutral-900/50 border border-white/5 hover:border-brand-primary/30 transition-all group/ex cursor-pointer"
                                  onClick={() => handleNavigate(ex.file, ex.line)}
                                >
                                  <div className="flex items-center justify-between mb-1.5">
                                    <div className="text-[9px] font-bold text-neutral-400 mono truncate max-w-[150px] group-hover/ex:text-brand-primary transition-colors">{ex.file.split('/').pop()}</div>
                                    <div className="text-[9px] text-neutral-600 font-bold">L{ex.line}</div>
                                  </div>
                                  <div className="text-[10px] mono text-neutral-500 bg-black/40 p-2 rounded-lg border border-white/5 mb-2 break-all group-hover/ex:text-neutral-300 transition-colors">
                                    {ex.arguments}
                                  </div>
                                  <p className="text-[10px] text-neutral-600 leading-relaxed italic group-hover/ex:text-neutral-500 transition-colors">{ex.context_explanation}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="pt-2">
                          <button 
                            onClick={() => handleVisualizeDependencies(focusedFunction)}
                            disabled={isGeneratingGraph}
                            className="w-full flex items-center justify-center gap-3 py-3.5 rounded-2xl border border-white/5 bg-white text-black hover:bg-neutral-200 text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-50 shadow-xl shadow-white/5"
                          >
                            {isGeneratingGraph ? <Loader2 size={16} className="animate-spin" /> : <Network size={16} />}
                            {isGeneratingGraph ? 'Tracing...' : 'Generate Logic Flow'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {(() => {
                      const filtered = selectedFile ? activeHighlights.filter(h => h.file === selectedFile.path) : [];
                      if (selectedFile) {
                        console.log(`[FOCUS] Rendering for ${selectedFile.path}. Found ${filtered.length} symbols. Total active: ${activeHighlights.length}`);
                      }
                      return filtered.length > 0 ? (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between px-2 mb-1">
                            <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-[0.2em] flex items-center gap-2">
                              <Sparkles size={12} /> Identified Focus
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-2">
                            {filtered.map((h, idx) => (
                              <div key={idx} onClick={() => handleNavigate(h.file, h.start, h)}
                                className={`flex items-center justify-between p-4 border rounded-2xl transition-all text-left group shadow-sm cursor-pointer ${focusedFunction === h ? 'bg-neutral-400/10 border-neutral-400 shadow-neutral-400/10' : 'bg-neutral-900 border border-neutral-800 hover:border-neutral-400/50 hover:bg-neutral-800/80'}`}
                              >
                                <div className="flex flex-col overflow-hidden">
                                  <span className="text-[13px] font-bold text-neutral-100 mono group-hover:text-neutral-400 transition-colors truncate">{h.function_name || h.label}</span>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-[10px] bg-neutral-800 text-neutral-400 px-1.5 py-0.5 rounded border border-neutral-700 font-mono font-bold">L{h.start}</span>
                                    {h.params && <span className="text-[9px] text-neutral-500 truncate max-w-[150px] italic">({h.params})</span>}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleVisualizeDependencies(h);
                                    }}
                                    className="p-2 bg-neutral-800 hover:bg-neutral-400 text-neutral-400 hover:text-white rounded-lg transition-all border border-neutral-700 shadow-inner"
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
                        <div className="h-64 flex flex-col items-center justify-center text-neutral-700 gap-4 opacity-50">
                          <Code2 size={48} />
                          <div className="text-center">
                            <p className="text-sm font-medium">No symbols identified</p>
                            <p className="text-[11px]">Click "Scan Symbols" in the editor to analyze this file</p>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {sidebarTab === 'map' && overview && (
              <div className="bg-neutral-900/40 backdrop-blur-sm rounded-2xl border border-neutral-800 p-6 space-y-6 animate-in fade-in duration-300 shadow-2xl overflow-hidden shrink-0">
                <div className="flex items-center gap-3 text-neutral-400">
                  <div className="p-2 bg-neutral-400/10 rounded-xl border border-neutral-400/20"><MapIcon size={20} /></div>
                  <div className="flex flex-col">
                    <span className="font-bold text-sm tracking-tight text-white">Repository Map</span>
                    <span className="text-[10px] text-neutral-500 uppercase font-mono tracking-widest">{overview.architecture_type}</span>
                  </div>
                </div>
                <div className="border-l-4 border-neutral-400/20 pl-4 py-1">
                  <FormattedText text={overview.summary} />
                </div>
                <div className="space-y-3">
                  <div className="text-[10px] font-bold text-neutral-600 uppercase pl-1 tracking-[0.2em]">Entry Points</div>
                  <div className="grid grid-cols-1 gap-2">
                    {(overview.entry_points || []).map((ep, i) => (
                      <button key={i} onClick={() => handleNavigate(ep.path)}
                        className="w-full flex items-start gap-4 p-3 rounded-xl bg-neutral-950/80 border border-neutral-800 hover:border-neutral-400/50 hover:bg-neutral-900 transition-all text-left group shadow-sm"
                      >
                        <ExternalLink size={14} className="mt-0.5 text-neutral-600 group-hover:text-neutral-400 transition-colors" />
                        <div className="flex-1 overflow-hidden">
                          <div className="text-[12px] font-bold text-neutral-100 mono group-hover:text-neutral-400 transition-colors truncate">{ep.path.split('/').pop()}</div>
                          <div className="text-[11px] text-neutral-500 leading-tight mt-1">{ep.purpose}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="text-[10px] font-bold text-neutral-600 uppercase pl-1 tracking-[0.2em]">Core Modules</div>
                  <div className="grid grid-cols-1 gap-2">
                    {(overview.core_modules || []).map((cm, i) => (
                      <button key={i} onClick={() => handleModuleClick(cm.folder, cm.description)}
                        className="w-full p-3.5 rounded-xl bg-neutral-950/80 border border-neutral-800 hover:border-neutral-400/50 hover:bg-neutral-900 transition-all text-left group shadow-sm"
                      >
                        <div className="text-[12px] font-bold text-neutral-400 mono flex items-center gap-2 group-hover:translate-x-1 transition-transform">
                          <FolderOpen size={14} className="text-neutral-400" /> {cm.folder}
                        </div>
                        <div className="text-[11px] text-neutral-500 mt-2 leading-relaxed">{cm.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
              </div>
            ) : (
              <ChatSidebar 
                runAnalysis={runAnalysis}
                handleNavigate={handleNavigate}
                handleSelectFile={handleSelectFile}
                handleVisualizeDependencies={handleVisualizeDependencies}
                handleLoadBundle={handleLoadBundle}
                handleSaveAIConfig={handleSaveAIConfig}
              />
            )}
          </aside>
        )}
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
      {rateLimitQueries !== null && (
        <RateLimitCTA queriesMade={rateLimitQueries} onDismiss={() => setRateLimitQueries(null)} />
      )}
      {pausedMessage && (
        <DemoPausedNotice message={pausedMessage} onDismiss={() => setPausedMessage(null)} />
      )}
    </div>
  );
}
