import React, { useEffect, useState } from 'react';
import { Github, Search, Activity, Calendar, ArrowRight, Trash2, RefreshCw, GitBranch, Sparkles, AlertTriangle, Clock, ShieldCheck, Settings, Loader2, Plus, Folder, Link } from 'lucide-react';
import { RepoStats, RepoOverview, AIConfig } from '../types';
import { embedText, setAIConfig } from '../services/gemini';
import { parseRepoUrl } from '../services/github';
import { SettingsModal } from './SettingsModal';
import { AnimatedShinyText } from './ui/AnimatedShinyText';
import { MagicCard } from './ui/MagicCard';

interface IndexedRepo {
  owner: string;
  name: string;
  branch: string;
  lastIndexed: string;
  stats: RepoStats;
  overview: RepoOverview;
  githubUserId?: number;
  isPrivate?: boolean;
  isTemporary?: boolean;
  expiresAt?: string;
}

interface HomePageProps {
  onSelectRepo: (owner: string, name: string, branch: string) => void;
  githubUser: any;
  jwtToken: string | null;
  onConnectGitHub: () => void;
  onLogoutGitHub: () => void;
  onOpenSettings: () => void;
  onInstallGitHub: () => void;
}

export const HomePage: React.FC<HomePageProps> = ({ onSelectRepo, githubUser, jwtToken, onConnectGitHub, onLogoutGitHub, onOpenSettings, onInstallGitHub }) => {
  console.log("HomePage Render - githubUser:", githubUser?.login || "null");
  const [repos, setRepos] = useState<IndexedRepo[]>([]);
  const [userRepos, setUserRepos] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingUserRepos, setIsLoadingUserRepos] = useState(false);
  const [userReposError, setUserReposError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dbError, setDbError] = useState<string | null>(null);
  const [isSemantic, setIsSemantic] = useState(false);
  const [semanticResults, setSemanticResults] = useState<any[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [deletingRepo, setDeletingRepo] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'indexed' | 'github'>('indexed');
  const [indexStatus, setIndexStatus] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);

  const fetchRepos = async (retryCount = 0) => {
    setIsLoading(true);
    setDbError(null);
    try {
      // Health check first
      const healthRes = await fetch('/api/health');
      const healthData = await healthRes.json();
      
      setIndexStatus(healthData.indexTest);
      
      if (healthData.dbState !== 1) {
        setDbError(healthData.lastError || `Database state: ${healthData.dbStateName}`);
      }
      
      const headers: Record<string, string> = {
        'X-Guest-ID': localStorage.getItem('gitlens_guest_id') || ''
      };
      if (jwtToken) {
        headers['Authorization'] = `Bearer ${jwtToken}`;
      }
      
      const res = await fetch('/api/repos', { headers });
      const contentType = res.headers.get("content-type");
      
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setRepos(data);
      } else {
        const errorText = await res.text();
        if (res.status === 503) {
           try {
             const errJson = JSON.parse(errorText);
             setDbError(errJson.error + (errJson.message ? `: ${errJson.message}` : ''));
           } catch (e) {
             setDbError(`HTTP ${res.status}: ${errorText.substring(0, 50)}`);
           }
        }
      }
    } catch (err: any) {
      console.error("Network error fetching repos:", err);
      if (retryCount < 2) {
        console.log(`Retrying fetchRepos... (${retryCount + 1}/2)`);
        setTimeout(() => fetchRepos(retryCount + 1), 2000);
      } else {
        setDbError(`Network error: ${err.message}. Please check if the server is running.`);
      }
    } finally {
      if (retryCount === 0 || retryCount === 2) setIsLoading(false);
    }
  };

  const fetchUserRepos = async () => {
    if (!githubUser || !jwtToken) return;
    setIsLoadingUserRepos(true);
    setUserReposError(null);
    try {
      const res = await fetch('/api/github/user/repos', {
        headers: {
          'Authorization': `Bearer ${jwtToken}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setUserRepos(data);
      } else if (res.status === 401) {
        console.warn("GitHub token expired or invalid, logging out...");
        onLogoutGitHub();
      } else {
        const errData = await res.json();
        setUserReposError(errData.details || errData.error || `Error ${res.status}`);
      }
    } catch (err: any) {
      console.error("Failed to fetch user repos", err);
      setUserReposError(err.message || "Network error fetching user repositories");
    } finally {
      setIsLoadingUserRepos(false);
    }
  };

  useEffect(() => {
    fetchRepos();
  }, []);

  useEffect(() => {
    if (githubUser) {
      fetchUserRepos();
    } else {
      setUserRepos([]);
    }
  }, [githubUser]);

  const handleDelete = async (e: React.MouseEvent, owner: string, name: string, branch: string) => {
    e.stopPropagation();
    const repoId = `${owner}/${name}/${branch}`;
    console.log("Delete clicked for:", repoId);
    
    if (confirmDelete !== repoId) {
      setConfirmDelete(repoId);
      // Auto-cancel after 5 seconds
      setTimeout(() => setConfirmDelete(prev => prev === repoId ? null : prev), 5000);
      return;
    }

    setConfirmDelete(null);
    setDeletingRepo(repoId);
    
    try {
      const url = `/api/repo?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}&branch=${encodeURIComponent(branch)}`;
      const headers: Record<string, string> = {
        'X-Guest-ID': localStorage.getItem('gitlens_guest_id') || ''
      };
      if (jwtToken) {
        headers['Authorization'] = `Bearer ${jwtToken}`;
      }
      
      const res = await fetch(url, { 
        method: 'DELETE',
        headers
      });
      
      if (res.ok) {
        setRepos(prev => prev.filter(r => !(r.owner === owner && r.name === name && r.branch === branch)));
        if (semanticResults) {
          setSemanticResults(prev => prev ? prev.filter(r => !(r.owner === owner && r.name === name && r.branch === branch)) : null);
        }
      } else {
        const err = await res.json();
        setDbError(`Delete failed: ${err.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      console.error("Delete failed", err);
      setDbError(`Network error: ${err.message}`);
    } finally {
      setDeletingRepo(null);
    }
  };

  const handlePublicUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setUrlError(null);
    const parsed = parseRepoUrl(publicUrl);
    if (!parsed) {
      setUrlError('Invalid GitHub URL. Format: https://github.com/owner/repo');
      return;
    }
    onSelectRepo(parsed.owner, parsed.name, parsed.branch);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setSemanticResults(null);
      return;
    }

    if (isSemantic) {
      setIsSearching(true);
      try {
        const vector = await embedText(searchQuery);
        const headers: Record<string, string> = { 
          'Content-Type': 'application/json',
          'X-Guest-ID': localStorage.getItem('gitlens_guest_id') || ''
        };
        if (jwtToken) {
          headers['Authorization'] = `Bearer ${jwtToken}`;
        }
        const res = await fetch('/api/repos/search', {
          method: 'POST',
          headers,
          body: JSON.stringify({ vector, limit: 6 })
        });
        if (res.ok) {
          const data = await res.json();
          setSemanticResults(data);
        }
      } catch (err) {
        console.error("Semantic search failed", err);
      } finally {
        setIsSearching(false);
      }
    }
  };

  const displayRepos = semanticResults || repos.filter(r => 
    r.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    r.owner.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="relative min-h-screen atmosphere text-neutral-200 p-8 overflow-hidden">
      <div className="relative z-10 max-w-6xl mx-auto space-y-12">
        
        {/* Hero Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-12 border-b border-white/5 pb-16 pt-8">
          <div className="space-y-6 flex-1">
            <div className="flex items-center gap-3">
              <div className="p-1 bg-brand-primary/20 rounded-xl border border-brand-primary/30 overflow-hidden">
                <img 
                  src="https://chatgpt.com/backend-api/estuary/public_content/enc/eyJpZCI6Im1fNjljNDE3YzcxMDk4ODE5MWJlNmM2YmIzMDVjMTc5MWM6ZmlsZV8wMDAwMDAwMDI2Yjg3MWZhOWMzMDRmZjBkMTc3NDkzZiIsInRzIjoiMjA1MzciLCJwIjoicHlpIiwiY2lkIjoiMSIsInNpZyI6ImM3MzUyODUyNThmMDIxMWVjNzFjNWMwYzkxYTNiNjYxYzkxN2Y3MDY2YjYwMmU2MjY4MjI4MzJlYmE0MWZlZTMiLCJ2IjoiMCIsImdpem1vX2lkIjpudWxsLCJjcyI6bnVsbCwiY2RuIjpudWxsLCJjcCI6bnVsbCwibWEiOm51bGx9" 
                  alt="GitLens Logo" 
                  className="h-8 w-8 object-contain"
                  referrerPolicy="no-referrer"
                />
              </div>
              <AnimatedShinyText className="text-[10px] font-black uppercase tracking-[0.4em] m-0 text-neutral-500">
                GitLens • v1.0
              </AnimatedShinyText>
            </div>
            <h1 className="text-7xl font-black text-white tracking-tighter uppercase leading-[0.9] text-gradient">
              Codebase <br /> <span className="text-white/40">Intelligence</span>
            </h1>
            <p className="text-neutral-500 max-w-lg text-lg leading-relaxed font-medium">
              Your personal library of analyzed codebases. Instant access to architecture, logic flows, and deep semantic insights powered by Gemini.
            </p>
            
            <div className="pt-6 flex flex-wrap gap-4">
              {githubUser ? (
                <>
                  <div className="flex items-center gap-5 p-2 pr-6 bg-neutral-900/50 backdrop-blur-xl border border-white/5 rounded-full w-fit group hover:border-white/10 transition-all">
                    <img 
                      src={githubUser.avatar_url} 
                      alt={githubUser.login} 
                      className="h-12 w-12 rounded-full border border-white/10 shadow-2xl group-hover:scale-105 transition-transform"
                      referrerPolicy="no-referrer"
                    />
                    <div className="flex flex-col">
                      <div className="text-[9px] font-bold text-neutral-600 uppercase tracking-widest">Authenticated</div>
                      <div className="text-base font-bold text-white leading-tight">{githubUser.login}</div>
                    </div>
                    <div className="h-8 w-[1px] bg-white/5 mx-2" />
                    <button 
                      onClick={onLogoutGitHub}
                      className="text-[10px] text-neutral-500 hover:text-red-400 font-bold uppercase tracking-widest transition-colors"
                    >
                      Disconnect
                    </button>
                  </div>

                  <button 
                    onClick={() => setActiveTab('github')}
                    className="flex items-center gap-4 px-6 py-3 bg-neutral-900/50 border border-white/10 hover:border-white/20 text-white rounded-full transition-all group active:scale-95 glass"
                  >
                    <Link size={18} className="text-brand-primary" />
                    <div className="text-left">
                      <div className="text-[10px] font-black uppercase tracking-widest">Index Public Repo</div>
                    </div>
                    <ArrowRight size={14} className="ml-2 group-hover:translate-x-1 transition-transform" />
                  </button>
                </>
              ) : (
                <div className="flex flex-wrap gap-4">
                  <button 
                    onClick={onConnectGitHub}
                    className="flex items-center gap-4 px-8 py-5 bg-white hover:bg-neutral-200 text-black rounded-2xl transition-all shadow-[0_0_30px_rgba(255,255,255,0.1)] group active:scale-95"
                  >
                    <Github size={20} />
                    <div className="text-left">
                      <div className="text-xs font-black uppercase tracking-widest">Connect GitHub</div>
                      <div className="text-[10px] opacity-60">Unlock private repository indexing</div>
                    </div>
                    <ArrowRight size={16} className="ml-2 group-hover:translate-x-1 transition-transform" />
                  </button>
                  
                  <button 
                    onClick={() => setActiveTab('github')}
                    className="flex items-center gap-4 px-8 py-5 bg-neutral-900/50 border border-white/10 hover:border-white/20 text-white rounded-2xl transition-all group active:scale-95 glass"
                  >
                    <Link size={20} className="text-brand-primary" />
                    <div className="text-left">
                      <div className="text-xs font-black uppercase tracking-widest">Index Public Repo</div>
                      <div className="text-[10px] opacity-60">Analyze any public GitHub URL</div>
                    </div>
                    <ArrowRight size={16} className="ml-2 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-6 w-full md:w-auto">
            <div className="flex items-center justify-end gap-3">
              {indexStatus && indexStatus.includes("Warning") && (
                <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/5 border border-amber-500/10 rounded-full text-amber-500/80 text-[9px] font-bold uppercase tracking-widest">
                  <AlertTriangle size={12} />
                  Vector Index Optimization Required
                </div>
              )}
              <button 
                onClick={onOpenSettings}
                className="p-4 bg-neutral-900/50 border border-white/5 rounded-2xl text-neutral-500 hover:text-white hover:border-white/20 transition-all glass hover:brand-glow"
                title="AI Settings"
              >
                <Settings size={20} />
              </button>
              <button 
                onClick={() => fetchRepos()}
                className="p-4 bg-neutral-900/50 border border-white/5 rounded-2xl text-neutral-500 hover:text-white hover:border-white/20 transition-all glass"
                title="Refresh Index"
              >
                <RefreshCw size={20} className={isLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            <form onSubmit={handleSearch} className="relative flex items-center gap-3">
              <div className="relative w-full md:w-[440px] group">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-neutral-600 group-focus-within:text-brand-primary transition-colors" size={20} />
                <input 
                  type="text" 
                  placeholder={isSemantic ? "Search by concept (e.g. 'auth flow', 'database logic')..." : "Filter indexed repositories..."}
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (!e.target.value) setSemanticResults(null);
                  }}
                  className="w-full bg-neutral-900/50 border border-white/5 rounded-2xl py-5 pl-14 pr-6 focus:outline-none focus:border-brand-primary/50 focus:ring-4 focus:ring-brand-primary/10 transition-all text-white placeholder:text-neutral-700 text-sm font-medium glass"
                />
                {isSearching && (
                  <div className="absolute right-5 top-1/2 -translate-y-1/2">
                    <Loader2 size={18} className="animate-spin text-brand-primary" />
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsSemantic(!isSemantic);
                  setSemanticResults(null);
                }}
                className={`p-5 rounded-2xl border transition-all flex items-center gap-3 font-bold text-[10px] uppercase tracking-[0.2em] glass ${
                  isSemantic 
                    ? "bg-brand-primary/10 border-brand-primary/50 text-brand-primary shadow-lg shadow-brand-primary/10" 
                    : "text-neutral-500 hover:border-white/20"
                }`}
              >
                <Sparkles size={18} className={isSemantic ? "animate-pulse" : ""} />
                <span className="hidden lg:inline">Semantic</span>
              </button>
            </form>
          </div>
        </div>

        {dbError && (
          <div className="bg-red-500/5 border border-red-500/10 p-8 rounded-[2.5rem] flex flex-col gap-6 animate-in fade-in slide-in-from-top-4 glass">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-red-500/10 rounded-2xl border border-red-500/20">
                <AlertTriangle size={24} className="text-red-500" />
              </div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.3em] text-red-500/60 mb-1">System Alert</div>
                <h3 className="text-xl font-black text-white uppercase tracking-tighter">Database Connection Issue</h3>
              </div>
            </div>
            <p className="text-neutral-400 text-sm font-mono bg-black/40 p-5 rounded-2xl border border-white/5 leading-relaxed">
              {dbError}
            </p>
            <div className="flex gap-4">
              <button 
                onClick={() => fetchRepos()}
                className="bg-white hover:bg-neutral-200 text-black px-8 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
              >
                Retry Connection
              </button>
              <a 
                href="https://cloud.mongodb.com" 
                target="_blank" 
                rel="noreferrer"
                className="bg-neutral-900 border border-white/5 hover:border-white/20 text-neutral-400 hover:text-white px-8 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all glass"
              >
                Check Atlas Status
              </a>
            </div>
          </div>
        )}

        {/* Tabs Section */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex p-1.5 bg-neutral-900/80 border border-white/5 rounded-2xl glass">
            <button 
              onClick={() => setActiveTab('indexed')}
              className={`px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all ${
                activeTab === 'indexed' 
                  ? 'bg-white text-black shadow-xl scale-100' 
                  : 'text-neutral-500 hover:text-white'
              }`}
            >
              Analyzed
            </button>
            <button 
              onClick={() => setActiveTab('github')}
              className={`px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all ${
                activeTab === 'github' 
                  ? 'bg-white text-black shadow-xl scale-100' 
                  : 'text-neutral-500 hover:text-white'
              }`}
            >
              Index New
            </button>
          </div>
          
          <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-neutral-600">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-brand-primary animate-pulse" />
              {displayRepos.length} Analyzed
            </div>
            <div className="h-4 w-[1px] bg-white/5" />
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-neutral-700" />
              {userRepos.length} Available
            </div>
          </div>
        </div>

        {/* Grid */}
        {activeTab === 'indexed' ? (
          <>
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-[400px] bg-neutral-900/20 rounded-[2.5rem] border border-white/5 animate-pulse glass" />
                ))}
              </div>
            ) : displayRepos.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {/* Add New Project Card */}
                <MagicCard 
                  onClick={() => setActiveTab('github')}
                  className="flex flex-col items-center justify-center p-12 border-dashed border-2 border-white/5 hover:border-brand-primary/30 group cursor-pointer min-h-[320px] bg-neutral-900/20 transition-all glass"
                >
                  <div className="p-6 bg-neutral-900 border border-white/5 rounded-[2.5rem] group-hover:scale-110 group-hover:brand-glow transition-all duration-500">
                    <Plus size={40} className="text-neutral-600 group-hover:text-brand-primary transition-colors" />
                  </div>
                  <div className="mt-8 text-center">
                    <h3 className="text-lg font-black text-white uppercase tracking-tighter">Index New Repository</h3>
                    <p className="text-neutral-500 text-xs mt-2 font-medium">Connect GitHub or enter a public URL to analyze</p>
                  </div>
                </MagicCard>

                {displayRepos.map((repo, i) => {
                  const repoId = `${repo.owner}/${repo.name}/${repo.branch}`;
                  const isDeleting = deletingRepo === repoId;
                  const isConfirming = confirmDelete === repoId;

                  return (
                    <MagicCard 
                      key={i}
                      onClick={() => !isDeleting && !isConfirming && onSelectRepo(repo.owner, repo.name, repo.branch)}
                      className={`group relative border rounded-[2.5rem] transition-all cursor-pointer flex flex-col justify-between h-[400px] overflow-hidden glass ${
                        isDeleting ? 'opacity-50 grayscale pointer-events-none' : 
                        isConfirming ? 'border-red-500/50 bg-red-500/5' : 'border-white/5 hover:border-white/10'
                      }`}
                    >
                      <div className="p-8 flex flex-col h-full">
                        <div className="flex justify-between items-start mb-8">
                          <div className={`p-4 rounded-2xl border transition-all duration-500 ${
                            isConfirming ? 'bg-red-500/20 text-red-400 border-red-500/30' : 
                            repo.isTemporary ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' : 
                            'bg-brand-primary/10 border-brand-primary/20 text-brand-primary'
                          }`}>
                            {isDeleting ? <RefreshCw size={24} className="animate-spin" /> : <Folder size={24} />}
                          </div>
                          <div className="flex gap-2">
                            {repo.isPrivate && (
                              <div className="px-3 py-1 bg-neutral-900 border border-white/5 rounded-full text-[9px] font-black uppercase tracking-widest text-neutral-500">
                                Private
                              </div>
                            )}
                            {repo.isTemporary && (
                              <div className="px-3 py-1 bg-amber-500/10 border border-amber-500/20 rounded-full text-[9px] font-black uppercase tracking-widest text-amber-500">
                                Temp
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex-1 space-y-3">
                          <div className="text-[10px] font-bold text-neutral-600 uppercase tracking-widest">{repo.owner}</div>
                          <h3 className="text-2xl font-black text-white tracking-tighter uppercase group-hover:text-brand-primary transition-colors truncate">
                            {repo.name}
                          </h3>
                          <div className="flex items-center gap-2 text-neutral-500 font-bold text-[10px] uppercase tracking-widest">
                            <GitBranch size={12} />
                            {repo.branch}
                          </div>
                          
                          <div className="grid grid-cols-3 gap-4 pt-6">
                            <div className="space-y-1">
                              <div className="text-lg font-bold text-white mono leading-none">{repo.stats.fileCount}</div>
                              <div className="text-[8px] font-bold text-neutral-600 uppercase tracking-widest">Files</div>
                            </div>
                            <div className="space-y-1">
                              <div className="text-lg font-bold text-white mono leading-none">{repo.stats.languages.length}</div>
                              <div className="text-[8px] font-bold text-neutral-600 uppercase tracking-widest">Langs</div>
                            </div>
                            <div className="space-y-1">
                              <div className="text-lg font-bold text-white mono leading-none">{Math.round(repo.stats.totalLines / 1000)}k</div>
                              <div className="text-[8px] font-bold text-neutral-600 uppercase tracking-widest">Lines</div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-8 flex items-center gap-3">
                          <button 
                            className="flex-1 bg-white hover:bg-neutral-200 text-black py-4 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all active:scale-95"
                          >
                            Launch Inspector
                          </button>
                          
                          <button 
                            onClick={(e) => handleDelete(e, repo.owner, repo.name, repo.branch)}
                            className={`p-4 rounded-xl transition-all z-50 ${
                              isConfirming ? 'bg-red-500 text-white scale-110 shadow-lg shadow-red-500/30' : 'bg-neutral-900/50 text-neutral-600 hover:text-red-500 hover:border-red-500/30 border border-white/5 opacity-0 group-hover:opacity-100'
                            }`}
                          >
                            <Trash2 size={20} />
                          </button>
                        </div>
                      </div>

                      {isConfirming && (
                        <div className="absolute inset-x-0 bottom-0 bg-red-500 text-white text-[10px] font-black uppercase tracking-widest py-2 text-center animate-in slide-in-from-bottom-full">
                          Click again to confirm delete
                        </div>
                      )}
                    </MagicCard>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-32 space-y-8 glass rounded-[3rem] border border-white/5">
                <div className="p-10 bg-neutral-900 border border-white/5 rounded-full text-neutral-700 shadow-2xl">
                  <Github size={64} />
                </div>
                <div className="text-center space-y-3">
                  <h3 className="text-3xl font-black text-white uppercase tracking-tighter">No repositories indexed</h3>
                  <p className="text-neutral-500 max-w-xs mx-auto font-medium">Start by indexing your first project from GitHub to unlock deep analysis.</p>
                </div>
                <button 
                  onClick={() => githubUser ? setActiveTab('github') : onConnectGitHub()}
                  className="px-10 py-5 bg-white hover:bg-neutral-200 text-black font-black rounded-2xl transition-all shadow-xl active:scale-95 uppercase text-[10px] tracking-widest"
                >
                  {githubUser ? 'Index Repository' : 'Connect GitHub'}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-10">
            {/* Public URL Indexing Section */}
            <div className="bg-neutral-900/40 border border-white/5 p-8 rounded-[2.5rem] glass">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-brand-primary/10 rounded-xl border border-brand-primary/20">
                      <Link size={18} className="text-brand-primary" />
                    </div>
                    <h3 className="text-xl font-black text-white uppercase tracking-tighter">Index Public Repository</h3>
                  </div>
                  <p className="text-neutral-500 text-[10px] font-bold uppercase tracking-widest">Enter a GitHub URL to analyze any public codebase</p>
                </div>
                
                <form onSubmit={handlePublicUrlSubmit} className="flex-1 max-w-xl w-full">
                  <div className="relative group">
                    <input 
                      type="text" 
                      placeholder="https://github.com/owner/repository"
                      value={publicUrl}
                      onChange={(e) => setPublicUrl(e.target.value)}
                      className={`w-full bg-black/40 border ${urlError ? 'border-red-500/50' : 'border-white/10'} rounded-2xl py-4 pl-6 pr-32 focus:outline-none focus:border-brand-primary/50 transition-all text-white placeholder:text-neutral-700 text-sm font-medium`}
                    />
                    <button 
                      type="submit"
                      className="absolute right-2 top-2 bottom-2 px-6 bg-white hover:bg-neutral-200 text-black rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
                    >
                      Index Now
                    </button>
                  </div>
                  {urlError && <p className="text-red-500 text-[10px] font-bold uppercase tracking-widest mt-2 ml-2">{urlError}</p>}
                </form>
              </div>
            </div>

            <div className="flex items-center justify-between border-b border-white/5 pb-6">
              <div>
                <h3 className="text-xl font-black text-white uppercase tracking-tighter">
                  {githubUser ? 'Your GitHub Repositories' : 'Connect GitHub for Private Repos'}
                </h3>
                <p className="text-neutral-500 text-[10px] font-bold uppercase tracking-widest mt-1">
                  {githubUser ? 'Select a repository from your account' : 'Unlock access to your private and organization projects'}
                </p>
              </div>
              {githubUser && (
                <button 
                  onClick={fetchUserRepos}
                  disabled={isLoadingUserRepos}
                  className="flex items-center gap-3 px-6 py-3 bg-neutral-900/50 border border-white/5 rounded-xl text-[10px] font-black text-neutral-400 hover:text-white hover:border-white/20 uppercase tracking-widest transition-all disabled:opacity-50 glass"
                >
                  <RefreshCw size={14} className={isLoadingUserRepos ? 'animate-spin' : ''} />
                  Refresh List
                </button>
              )}
            </div>

            {!githubUser && (
              <div className="flex flex-col items-center justify-center py-20 bg-neutral-900/20 rounded-[2.5rem] border border-white/5 border-dashed">
                <Github size={48} className="text-neutral-700 mb-6" />
                <h4 className="text-lg font-black text-white uppercase tracking-tighter mb-2">Private Repositories</h4>
                <p className="text-neutral-500 text-xs mb-8 text-center max-w-xs">Connect your GitHub account to index and analyze your private and organization codebases.</p>
                <button 
                  onClick={onConnectGitHub}
                  className="px-8 py-4 bg-white hover:bg-neutral-200 text-black font-black rounded-xl transition-all active:scale-95 uppercase text-[10px] tracking-widest"
                >
                  Connect GitHub
                </button>
              </div>
            )}

            {userReposError && (
              <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-[2rem] flex flex-col gap-3 animate-in fade-in slide-in-from-top-4">
                <div className="flex items-center gap-3 text-red-400 font-bold uppercase tracking-widest text-xs">
                  <AlertTriangle size={16} /> Failed to load GitHub repositories
                </div>
                <p className="text-neutral-300 text-sm font-mono bg-neutral-950/50 p-4 rounded-xl border border-red-500/10">
                  {userReposError}
                </p>
                <button 
                  onClick={fetchUserRepos}
                  className="bg-red-500/20 hover:bg-red-500/30 text-red-400 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all w-fit"
                >
                  Try Again
                </button>
              </div>
            )}

            {isLoadingUserRepos ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <div key={i} className="h-44 bg-neutral-900/40 rounded-2xl border border-white/5 animate-pulse relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent" />
                  </div>
                ))}
              </div>
            ) : userRepos.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {userRepos.map((repo, i) => {
                  const isIndexed = repos.some(r => r.owner === repo.owner.login && r.name === repo.name);
                  
                  return (
                    <div 
                      key={i}
                      onClick={() => onSelectRepo(repo.owner.login, repo.name, repo.default_branch)}
                      className="group relative bg-neutral-900/40 border border-white/5 p-5 rounded-2xl hover:bg-neutral-900/60 hover:border-brand-primary/30 transition-all cursor-pointer flex flex-col justify-between h-48 overflow-hidden"
                    >
                      {/* Subtle hover glow */}
                      <div className="absolute -right-8 -top-8 w-24 h-24 bg-brand-primary/5 rounded-full blur-3xl group-hover:bg-brand-primary/10 transition-all duration-500" />
                      
                      <div className="space-y-3 relative z-10">
                        <div className="flex items-center justify-between">
                          <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest flex items-center gap-1.5">
                            <Github size={10} className="opacity-50" />
                            {repo.owner.login}
                          </div>
                          {repo.private && (
                            <div className="px-2 py-0.5 bg-amber-500/10 text-amber-500 text-[8px] font-bold uppercase tracking-widest rounded-full border border-amber-500/20">
                              Private
                            </div>
                          )}
                        </div>
                        
                        <div>
                          <h3 className="text-lg font-bold text-white group-hover:text-brand-primary transition-colors truncate mb-1">
                            {repo.name}
                          </h3>
                          <p className="text-neutral-500 text-xs line-clamp-2 leading-relaxed h-8 font-medium">
                            {repo.description || 'No description provided.'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-4 relative z-10 pt-4 border-t border-white/5">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1 text-[10px] font-bold text-neutral-500 uppercase tracking-widest">
                            <GitBranch size={12} className="opacity-50" />
                            {repo.default_branch}
                          </div>
                          {isIndexed && (
                            <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-500 uppercase tracking-widest">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              Indexed
                            </div>
                          )}
                        </div>
                        
                        <div className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-1.5 ${
                          isIndexed 
                            ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 group-hover:bg-emerald-500/20" 
                            : "bg-white text-black shadow-lg shadow-white/10 group-hover:bg-neutral-200"
                        }`}>
                          {isIndexed ? 'Open' : 'Index'}
                          <ArrowRight size={10} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-24 glass rounded-3xl border border-white/5">
                <div className="p-6 bg-neutral-950/50 rounded-full border border-white/5 text-neutral-700 mb-6">
                  <Github size={48} className="opacity-20" />
                </div>
                <div className="text-center space-y-6 max-w-sm px-6">
                  <div className="space-y-2">
                    <h3 className="text-xl font-bold text-white">No Repositories Found</h3>
                    <p className="text-neutral-500 text-sm leading-relaxed">
                      You are connected to GitHub, but we don't have access to any repositories. 
                      Grant access to your account or organization to get started.
                    </p>
                  </div>
                  
                  <button 
                    onClick={onInstallGitHub}
                    className="inline-flex items-center gap-2 px-8 py-4 bg-white hover:bg-neutral-200 text-black rounded-2xl font-bold uppercase tracking-widest text-xs transition-all shadow-xl shadow-white/10 group w-full justify-center"
                  >
                    <Sparkles size={16} className="group-hover:rotate-12 transition-transform" />
                    Grant Repository Access
                  </button>

                  <p className="text-[10px] text-neutral-600 leading-relaxed italic">
                    You can choose "All repositories" or just specific ones in the GitHub installation screen.
                  </p>
                </div>
              </div>
            )}
            
            {userRepos.length > 0 && (
              <div className="mt-12 p-6 glass rounded-2xl border border-white/5 flex items-start gap-4">
                <div className="p-3 bg-brand-primary/10 text-brand-primary rounded-xl shrink-0">
                  <Github size={20} />
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-bold text-white uppercase tracking-widest">Missing a repository?</div>
                  <p className="text-xs text-neutral-500 leading-relaxed max-w-2xl">
                    If you don't see a private or organization repository, you may need to grant access. 
                    Go to your <a href="https://github.com/settings/applications" target="_blank" rel="noopener noreferrer" className="text-brand-primary hover:underline font-bold">GitHub Settings</a>, 
                    find this application, and ensure "Organization access" is granted.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
