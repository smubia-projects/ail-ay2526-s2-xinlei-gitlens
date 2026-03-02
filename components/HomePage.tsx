import React, { useEffect, useState } from 'react';
import { Github, Search, Activity, Calendar, ArrowRight, Trash2, RefreshCw, GitBranch, Sparkles, AlertTriangle } from 'lucide-react';
import { RepoStats, RepoOverview } from '../types';
import { embedText } from '../services/gemini';

interface IndexedRepo {
  owner: string;
  name: string;
  branch: string;
  lastIndexed: string;
  stats: RepoStats;
  overview: RepoOverview;
}

interface HomePageProps {
  onSelectRepo: (owner: string, name: string, branch: string) => void;
}

export const HomePage: React.FC<HomePageProps> = ({ onSelectRepo }) => {
  const [repos, setRepos] = useState<IndexedRepo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [dbError, setDbError] = useState<string | null>(null);
  const [isSemantic, setIsSemantic] = useState(false);
  const [semanticResults, setSemanticResults] = useState<any[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [deletingRepo, setDeletingRepo] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

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
      
      const res = await fetch('/api/repos');
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

  useEffect(() => {
    fetchRepos();
  }, []);

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
      const res = await fetch(url, { method: 'DELETE' });
      
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
          </div>

          <div className="flex items-center gap-4">
            {indexStatus && indexStatus.includes("Warning") && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400 text-[10px] font-bold uppercase tracking-widest animate-pulse">
                <AlertTriangle size={12} />
                Vector Index Missing
              </div>
            )}
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

        {/* Grid */}
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
                <div className="text-sm font-bold text-white uppercase tracking-widest">Index New Repository</div>
                <div className="text-xs text-slate-500 mt-1">Paste a GitHub URL to start</div>
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
              onClick={() => onSelectRepo('', '', '')}
              className="px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl transition-all shadow-lg shadow-blue-500/20 active:scale-95"
            >
              Index Repository
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
