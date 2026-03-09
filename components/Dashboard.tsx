import React, { useState, useEffect } from 'react';
import { RepoStats, RepoOverview } from '../types';
import { FileText, Folder, Code, Hash, Activity, Zap, Shield, Globe } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

interface DashboardProps {
  stats: RepoStats;
  overview: RepoOverview | null;
  repoName: string;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const Dashboard: React.FC<DashboardProps> = ({ stats, overview, repoName, onRefresh, isRefreshing }) => {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    // Small delay to ensure layout has settled
    const timer = setTimeout(() => setIsMounted(true), 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="h-full overflow-auto bg-slate-950 custom-scrollbar p-8">
      <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-600/20 rounded-2xl text-blue-400 border border-blue-500/20">
                <Activity size={24} />
              </div>
              <h1 className="text-3xl font-black text-white tracking-tighter uppercase">{repoName}</h1>
            </div>
            <p className="text-slate-400 text-sm max-w-2xl leading-relaxed">
              {overview?.summary || "Repository indexed and analyzed. Exploring the architecture and logic flow."}
            </p>
          </div>
          
          <button 
            onClick={onRefresh}
            disabled={isRefreshing}
            className={`flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold rounded-2xl transition-all shadow-lg shadow-blue-500/20 active:scale-95 ${isRefreshing ? 'animate-pulse' : ''}`}
          >
            <Zap size={18} className={isRefreshing ? 'animate-spin' : ''} />
            {isRefreshing ? 'Indexing...' : 'Refresh Index'}
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { label: 'Files', value: stats.fileCount, icon: FileText, color: 'text-blue-400', bg: 'bg-blue-500/10' },
            { label: 'Folders', value: stats.folderCount, icon: Folder, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
            { label: 'Languages', value: stats.languages.length, icon: Code, color: 'text-amber-400', bg: 'bg-amber-500/10' },
            { label: 'Total Lines', value: stats.totalLines.toLocaleString(), icon: Hash, color: 'text-rose-400', bg: 'bg-rose-500/10' },
          ].map((stat, i) => (
            <div key={i} className="bg-slate-900/50 border border-slate-800 p-6 rounded-3xl backdrop-blur-sm hover:border-slate-700 transition-all group">
              <div className={`p-2 w-fit rounded-xl ${stat.bg} ${stat.color} mb-4 group-hover:scale-110 transition-transform`}>
                <stat.icon size={20} />
              </div>
              <div className="text-2xl font-black text-white mono">{stat.value}</div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">{stat.label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Language Distribution */}
          <div className="lg:col-span-1 bg-slate-900/50 border border-slate-800 p-8 rounded-[2rem] flex flex-col items-center">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-[0.2em] mb-8 self-start">Language Mix</h3>
            <div className="w-full h-[200px] flex items-center justify-center">
              {isMounted && stats.languages.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={stats.languages}
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="count"
                    >
                      {stats.languages.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px' }}
                      itemStyle={{ color: '#fff', fontSize: '12px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-slate-500 text-xs italic">
                  {!isMounted ? 'Loading Chart...' : 'No language data available'}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4 w-full mt-4">
              {stats.languages.map((lang, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: lang.color }} />
                  <span className="text-[11px] text-slate-400 mono">{lang.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Architecture Overview */}
          <div className="lg:col-span-2 bg-slate-900/50 border border-slate-800 p-8 rounded-[2rem]">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-[0.2em] mb-6">Architecture Insights</h3>
            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-blue-500/20 text-blue-400 rounded-lg shrink-0">
                  <Zap size={18} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white mb-1">Pattern Detected</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {overview?.architecture_type || "Standard Node.js/TypeScript structure with modular directory organization."}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg shrink-0">
                  <Globe size={18} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white mb-1">Entry Points</h4>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {overview?.entry_points.map((ep, i) => (
                      <div key={i} className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-full text-[10px] text-slate-300 mono">
                        {ep.path}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Core Modules */}
        <div className="bg-slate-900/50 border border-slate-800 p-8 rounded-[2rem]">
           <h3 className="text-xs font-bold text-slate-500 uppercase tracking-[0.2em] mb-6">Core Modules</h3>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             {overview?.core_modules.map((mod, i) => (
               <div key={i} className="p-4 bg-slate-950/50 border border-slate-800 rounded-2xl hover:border-blue-500/30 transition-colors">
                 <div className="text-blue-400 font-bold text-sm mono mb-1">/{mod.folder}</div>
                 <div className="text-xs text-slate-500 leading-relaxed">{mod.description}</div>
               </div>
             ))}
           </div>
        </div>

      </div>
    </div>
  );
};
