import React, { useEffect, useState } from 'react';
import { Github, Search, Activity, Calendar, ArrowRight, Trash2, RefreshCw, GitBranch, Sparkles, AlertTriangle, Clock, ShieldCheck, Settings } from 'lucide-react';
import { RepoStats, RepoOverview, AIConfig } from '../types';
import { embedText, setAIConfig } from '../services/gemini';
import { SettingsModal } from './SettingsModal';

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
      
      const headers: Record<string, string> = {};
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
      setActiveTab('indexed');
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
      const headers: Record<string, string> = {};
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
        const res = await fetch('/api/repos/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
    <div className="min-h-screen bg-slate-950 text-slate-200 p-8">
      <div className="max-w-6xl mx-auto space-y-12">
        
        {/* Hero Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 border-b border-slate-800 pb-12">
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-blue-400">
              <Activity size={32} className="animate-pulse" />
              <span className="text-sm font-black uppercase tracking-[0.3em]">GitLens Cursor</span>
            </div>
            <h1 className="text-6xl font-black text-white tracking-tighter uppercase leading-none">
              Indexed <br /> <span className="text-blue-500">Repositories</span>
            </h1>
            <p className="text-slate-400 max-w-md text-lg leading-relaxed">
              Your personal library of analyzed codebases. Instant access to architecture, logic flows, and deep insights.
            </p>
            
            <div className="pt-4">
              {githubUser ? (
                <div className="flex items-center gap-4 p-4 bg-slate-900 border border-slate-800 rounded-[2rem] w-fit">
                  <img 
                    src={githubUser.avatar_url} 
                    alt={githubUser.login} 
                    className="h-12 w-12 rounded-full border-2 border-blue-500/50 shadow-lg shadow-blue-500/10"
                    referrerPolicy="no-referrer"
                  />
                  <div>
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Connected as</div>
                    <div className="text-lg font-black text-white leading-tight">{githubUser.login}</div>
                    <button 
                      onClick={onLogoutGitHub}
                      className="flex items-center gap-1 text-[10px] text-red-500 hover:text-red-400 font-bold uppercase tracking-widest mt-1 transition-colors group/logout"
                    >
                      Logout
                      <ArrowRight size={10} className="group-hover/logout:translate-x-0.5 transition-transform" />
                    </button>
                  </div>
                </div>
              ) : (
                <button 
                  onClick={onConnectGitHub}
                  className="flex items-center gap-3 px-6 py-4 bg-slate-900 hover:bg-slate-800 text-white rounded-[2rem] border border-slate-800 hover:border-blue-500/30 transition-all shadow-xl group"
                >
                  <div className="p-2 bg-slate-800 rounded-xl group-hover:text-blue-400 transition-colors">
                    <Github size={20} />
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-bold uppercase tracking-widest">Connect GitHub</div>
                    <div className="text-[10px] text-slate-500">Access your private repositories</div>
                  </div>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            {indexStatus && indexStatus.includes("Warning") && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400 text-[10px] font-bold uppercase tracking-widest animate-pulse">
                <AlertTriangle size={12} />
                Vector Index Missing
              </div>
            )}
            <button 
              onClick={onOpenSettings}
              className="p-3 bg-slate-900 border border-slate-800 rounded-2xl text-slate-400 hover:text-blue-400 hover:border-blue-500/30 transition-all"
              title="AI Settings"
            >
              <Settings size={20} />
            </button>
            <button 
              onClick={() => fetchRepos()}
              className="p-3 bg-slate-900 border border-slate-800 rounded-2xl text-slate-400 hover:text-blue-400 hover:border-blue-500/30 transition-all"
              title="Refresh Index"
            >
              <RefreshCw size={20} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <form onSubmit={handleSearch} className="relative flex items-center gap-2">
              <div className="relative w-full md:w-96">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
                <input 
                  type="text" 
                  placeholder={isSemantic ? "Describe what you're looking for..." : "Search your index..."}
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (!e.target.value) setSemanticResults(null);
                  }}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-white placeholder:text-slate-600"
                />
                {isSearching && (
                  <div className="absolute right-4 top-1/2 -translate-y-1/2">
                    <RefreshCw size={16} className="animate-spin text-blue-500" />
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsSemantic(!isSemantic);
                  setSemanticResults(null);
                }}
                className={`p-4 rounded-2xl border transition-all flex items-center gap-2 font-bold text-xs uppercase tracking-widest ${
                  isSemantic 
                    ? "bg-blue-500/20 border-blue-500/50 text-blue-400 shadow-lg shadow-blue-500/10" 
                    : "bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-700"
                }`}
              >
                <Sparkles size={16} className={isSemantic ? "animate-pulse" : ""} />
                <span className="hidden md:inline">Semantic</span>
              </button>
            </form>
          </div>
        </div>

        {dbError && (
          <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-[2rem] flex flex-col gap-3 animate-in fade-in slide-in-from-top-4">
            <div className="flex items-center gap-3 text-red-400 font-bold uppercase tracking-widest text-xs">
              <RefreshCw size={16} className="animate-spin" /> Database Connection Issue
            </div>
            <p className="text-slate-300 text-sm font-mono bg-slate-950/50 p-4 rounded-xl border border-red-500/10">
              {dbError}
            </p>
            <div className="flex gap-4">
              <button 
                onClick={() => fetchRepos()}
                className="bg-red-500/20 hover:bg-red-500/30 text-red-400 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all"
              >
                Retry Connection
              </button>
              <a 
                href="https://cloud.mongodb.com" 
                target="_blank" 
                rel="noreferrer"
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all"
              >
                Check Atlas Status
              </a>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-8 border-b border-slate-800">
          <button 
            onClick={() => setActiveTab('indexed')}
            className={`pb-4 text-sm font-bold uppercase tracking-[0.2em] transition-all relative ${
              activeTab === 'indexed' ? 'text-blue-500' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Indexed Repositories
            {activeTab === 'indexed' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 animate-in fade-in slide-in-from-left-2" />}
          </button>
          {githubUser && (
            <button 
              onClick={() => setActiveTab('github')}
              className={`pb-4 text-sm font-bold uppercase tracking-[0.2em] transition-all relative ${
                activeTab === 'github' ? 'text-blue-500' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              My GitHub Repos
              {activeTab === 'github' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 animate-in fade-in slide-in-from-left-2" />}
            </button>
          )}
        </div>

        {/* Grid */}
        {activeTab === 'indexed' ? (
          <>
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-64 bg-slate-900/50 rounded-[2rem] border border-slate-800 animate-pulse" />
                ))}
              </div>
            ) : displayRepos.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {displayRepos.map((repo, i) => {
                  const repoId = `${repo.owner}/${repo.name}/${repo.branch}`;
                  const isDeleting = deletingRepo === repoId;
                  const isConfirming = confirmDelete === repoId;

                  return (
                    <div 
                      key={i}
                      onClick={() => !isDeleting && !isConfirming && onSelectRepo(repo.owner, repo.name, repo.branch)}
                      className={`group relative bg-slate-900/40 border p-8 rounded-[2.5rem] transition-all cursor-pointer flex flex-col justify-between h-80 overflow-hidden ${
                        isDeleting ? 'opacity-50 grayscale pointer-events-none' : 
                        isConfirming ? 'border-red-500/50 bg-red-500/5' : 'border-slate-800 hover:bg-slate-900 hover:border-blue-500/30'
                      }`}
                    >
                      {/* Background Accent */}
                      <div className="absolute -right-10 -top-10 w-40 h-40 bg-blue-500/5 rounded-full blur-3xl group-hover:bg-blue-500/10 transition-colors" />
                      
                      {repo.score && (
                        <div className="absolute top-4 right-4 bg-blue-500/10 text-blue-400 px-2 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest border border-blue-500/20">
                          Match: {Math.round(repo.score * 100)}%
                        </div>
                      )}

                      {repo.isTemporary && (
                        <div className="absolute top-4 left-4 bg-amber-500/10 text-amber-400 px-2 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest border border-amber-500/20 flex items-center gap-1">
                          <Clock size={10} />
                          Temporary
                        </div>
                      )}

                      {repo.isPrivate && (
                        <div className={`absolute top-4 ${repo.githubUserId === githubUser?.id ? 'left-20' : 'left-4'} bg-red-500/10 text-red-400 px-2 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest border border-red-500/20 flex items-center gap-1`}>
                          <ShieldCheck size={10} />
                          Private
                        </div>
                      )}

                      {repo.githubUserId && repo.githubUserId === githubUser?.id && (
                        <div className="absolute top-4 left-4 bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest border border-emerald-500/20 flex items-center gap-1">
                          <ShieldCheck size={10} />
                          Owned
                        </div>
                      )}
                      
                      <div className="relative space-y-4">
                        <div className="flex items-start justify-between">
                          <div className={`p-3 rounded-2xl transition-all ${
                            isConfirming ? 'bg-red-500/20 text-red-400' : 'bg-slate-800 text-slate-400 group-hover:text-blue-400 group-hover:bg-blue-500/10'
                          }`}>
                            {isDeleting ? <RefreshCw size={24} className="animate-spin" /> : <Github size={24} />}
                          </div>
                          <button 
                            onClick={(e) => handleDelete(e, repo.owner, repo.name, repo.branch)}
                            className={`p-3 rounded-2xl transition-all z-50 ${
                              isConfirming ? 'bg-red-500 text-white scale-110 shadow-lg shadow-red-500/30' : 'bg-slate-800/50 text-slate-500 hover:text-red-400 hover:bg-red-500/10'
                            }`}
                            title={isConfirming ? "Click again to confirm" : "Delete from index"}
                          >
                            {isConfirming ? <Trash2 size={24} /> : <Trash2 size={20} />}
                          </button>
                        </div>
                        
                        <div>
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{repo.owner}</div>
                          <h2 className={`text-2xl font-black tracking-tight uppercase transition-colors truncate ${
                            isConfirming ? 'text-red-400' : 'text-white group-hover:text-blue-400'
                          }`}>
                            {repo.name}
                          </h2>
                          <div className="flex items-center gap-1.5 mt-2 text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                            <GitBranch size={12} />
                            {repo.branch}
                          </div>
                        </div>
                      </div>

                      {isConfirming && (
                        <div className="absolute inset-x-0 bottom-0 bg-red-500 text-white text-[10px] font-black uppercase tracking-widest py-2 text-center animate-in slide-in-from-bottom-full">
                          Click trash again to confirm delete
                        </div>
                      )}

                      <div className={`relative space-y-6 transition-opacity ${isConfirming ? 'opacity-20' : 'opacity-100'}`}>
                        <div className="grid grid-cols-3 gap-4 border-t border-slate-800/50 pt-6">
                          <div className="space-y-1">
                            <div className="text-lg font-bold text-white mono leading-none">{repo.stats.fileCount}</div>
                            <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Files</div>
                          </div>
                          <div className="space-y-1">
                            <div className="text-lg font-bold text-white mono leading-none">{repo.stats.languages.length}</div>
                            <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Langs</div>
                          </div>
                          <div className="space-y-1">
                            <div className="text-lg font-bold text-white mono leading-none">{Math.round(repo.stats.totalLines / 1000)}k</div>
                            <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Lines</div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                          <div className="flex items-center gap-2">
                            <Calendar size={12} />
                            {new Date(repo.lastIndexed).toLocaleDateString()}
                          </div>
                          {repo.isTemporary && repo.expiresAt && (
                            <div className="flex items-center gap-1 text-amber-500/70">
                              <Clock size={10} />
                              Expires {new Date(repo.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                          <div className="flex items-center gap-1 text-blue-500 group-hover:translate-x-1 transition-transform">
                            Open <ArrowRight size={12} />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                
                {/* Add New Project Card */}
                <div 
                  onClick={() => onSelectRepo('', '', '')}
                  className="group border-2 border-dashed border-slate-800 p-8 rounded-[2.5rem] hover:border-blue-500/50 hover:bg-blue-500/5 transition-all cursor-pointer flex flex-col items-center justify-center gap-4 h-80"
                >
                  <div className="p-4 bg-slate-900 rounded-full text-slate-500 group-hover:text-blue-400 group-hover:scale-110 transition-all">
                    <Github size={32} />
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-bold text-white uppercase tracking-widest">
                      {githubUser ? 'Index New Repository' : 'Connect GitHub First'}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {githubUser ? 'Paste a GitHub URL to start' : 'Required to access private repos'}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 space-y-6">
                <div className="p-8 bg-slate-900 rounded-full text-slate-700">
                  <Github size={64} />
                </div>
                <div className="text-center space-y-2">
                  <h3 className="text-2xl font-bold text-white">No repositories indexed yet</h3>
                  <p className="text-slate-500">Start by indexing your first project from GitHub.</p>
                </div>
                <button 
                  onClick={() => githubUser ? onSelectRepo('', '', '') : onConnectGitHub()}
                  className="px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl transition-all shadow-lg shadow-blue-500/20 active:scale-95"
                >
                  {githubUser ? 'Index Repository' : 'Connect GitHub'}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Available Repositories</h3>
              <button 
                onClick={fetchUserRepos}
                disabled={isLoadingUserRepos}
                className="flex items-center gap-2 text-[10px] font-bold text-blue-500 hover:text-blue-400 uppercase tracking-widest transition-colors disabled:opacity-50"
              >
                <RefreshCw size={12} className={isLoadingUserRepos ? 'animate-spin' : ''} />
                Refresh List
              </button>
            </div>

            {userReposError && (
              <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-[2rem] flex flex-col gap-3 animate-in fade-in slide-in-from-top-4">
                <div className="flex items-center gap-3 text-red-400 font-bold uppercase tracking-widest text-xs">
                  <AlertTriangle size={16} /> Failed to load GitHub repositories
                </div>
                <p className="text-slate-300 text-sm font-mono bg-slate-950/50 p-4 rounded-xl border border-red-500/10">
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <div key={i} className="h-40 bg-slate-900/50 rounded-3xl border border-slate-800 animate-pulse" />
                ))}
              </div>
            ) : userRepos.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {userRepos.map((repo, i) => {
                  const isIndexed = repos.some(r => r.owner === repo.owner.login && r.name === repo.name);
                  
                  return (
                    <div 
                      key={i}
                      onClick={() => onSelectRepo(repo.owner.login, repo.name, repo.default_branch)}
                      className="group bg-slate-900/40 border border-slate-800 p-6 rounded-3xl hover:bg-slate-900 hover:border-blue-500/30 transition-all cursor-pointer flex flex-col justify-between h-44 relative overflow-hidden"
                    >
                      <div className="absolute -right-4 -top-4 w-20 h-20 bg-blue-500/5 rounded-full blur-2xl group-hover:bg-blue-500/10 transition-colors" />
                      
                      <div className="space-y-2 relative">
                        <div className="flex items-center justify-between">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{repo.owner.login}</div>
                          {repo.private && (
                            <div className="px-2 py-0.5 bg-amber-500/10 text-amber-500 text-[8px] font-bold uppercase tracking-widest rounded-full border border-amber-500/20">
                              Private
                            </div>
                          )}
                        </div>
                        <h3 className="text-xl font-black text-white group-hover:text-blue-400 transition-colors truncate">
                          {repo.name}
                        </h3>
                        <p className="text-slate-500 text-xs line-clamp-2 leading-relaxed h-8">
                          {repo.description || 'No description provided.'}
                        </p>
                      </div>

                        <div className="flex items-center justify-between mt-4 relative">
                          <div className="flex items-center gap-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                            <div className="flex items-center gap-1">
                              <GitBranch size={12} />
                              {repo.default_branch}
                            </div>
                            {isIndexed ? (
                              <div className="flex items-center gap-1 text-emerald-500">
                                <Activity size={12} />
                                Indexed
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 text-blue-500">
                                <Sparkles size={12} />
                                Ready to Index
                              </div>
                            )}
                          </div>
                          <div className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2 ${
                            isIndexed 
                              ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 group-hover:bg-emerald-500/20" 
                              : "bg-blue-500 text-white shadow-lg shadow-blue-500/20 group-hover:bg-blue-400"
                          }`}>
                            {isIndexed ? 'Open' : 'Index Repo'}
                            <ArrowRight size={12} />
                          </div>
                        </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 space-y-6">
                <div className="p-6 bg-slate-900/50 rounded-full border border-slate-800 text-slate-700">
                  <Github size={64} />
                </div>
                <div className="text-center space-y-4 max-w-md">
                  <div className="space-y-2">
                    <h3 className="text-xl font-bold text-white">No Repositories Found</h3>
                    <p className="text-slate-500 text-sm leading-relaxed">
                      You are connected to GitHub, but the app hasn't been granted access to any repositories yet. 
                      You need to <strong>Install</strong> the app on your account or organization.
                    </p>
                  </div>
                  
                  <button 
                    onClick={onInstallGitHub}
                    className="inline-flex items-center gap-2 px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold uppercase tracking-widest text-xs transition-all shadow-xl shadow-blue-500/20 group"
                  >
                    <Sparkles size={16} className="group-hover:rotate-12 transition-transform" />
                    Grant Repository Access
                  </button>

                  <p className="text-[10px] text-slate-600 leading-relaxed">
                    Clicking above will open GitHub where you can select which repositories this app can see. 
                    You can choose "All repositories" or just specific ones.
                  </p>
                </div>
              </div>
            )}
            
            {userRepos.length > 0 && (
              <div className="mt-8 p-4 bg-slate-900/30 border border-slate-800/50 rounded-2xl flex items-start gap-3">
                <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg shrink-0">
                  <AlertTriangle size={16} />
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Missing a repository?</div>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    If you don't see a private or organization repository, you may need to grant access. 
                    Go to your <a href="https://github.com/settings/applications" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">GitHub Settings</a>, 
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
