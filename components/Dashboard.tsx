import React, { useState, useEffect } from 'react';
import { RepoStats, RepoOverview } from '../types';
import { FileText, Folder, Code, Hash, Activity, Zap, Shield, Globe } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { MagicCard } from './ui/MagicCard';

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
    <div className="h-full overflow-auto bg-black custom-scrollbar p-8">
      <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-white/10 rounded-2xl text-white border border-white/10">
                <Activity size={24} />
              </div>
              <h1 className="text-3xl font-black text-white tracking-tighter uppercase">{repoName}</h1>
            </div>
            <p className="text-neutral-400 text-sm max-w-2xl leading-relaxed">
              {overview?.summary || "Repository indexed and analyzed. Exploring the architecture and logic flow."}
            </p>
          </div>
          
          <button 
            onClick={onRefresh}
            disabled={isRefreshing}
            className={`flex items-center gap-2 px-6 py-3 bg-white text-black hover:bg-neutral-200 disabled:bg-neutral-800 disabled:text-neutral-500 font-bold rounded-2xl transition-all shadow-lg active:scale-95 ${isRefreshing ? 'animate-pulse' : ''}`}
          >
            <Zap size={18} className={isRefreshing ? 'animate-spin' : ''} />
            {isRefreshing ? 'Indexing...' : 'Refresh Index'}
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { label: 'Files', value: stats.fileCount, icon: FileText, color: 'text-white', bg: 'bg-white/10' },
            { label: 'Folders', value: stats.folderCount, icon: Folder, color: 'text-neutral-300', bg: 'bg-white/5' },
            { label: 'Languages', value: stats.languages.length, icon: Code, color: 'text-neutral-400', bg: 'bg-white/10' },
            { label: 'Total Lines', value: stats.totalLines.toLocaleString(), icon: Hash, color: 'text-neutral-500', bg: 'bg-white/5' },
          ].map((stat, i) => (
            <MagicCard key={i} className="p-6 rounded-3xl group">
              <div className={`p-2 w-fit rounded-xl ${stat.bg} ${stat.color} mb-4 group-hover:scale-110 transition-transform`}>
                <stat.icon size={20} />
              </div>
              <div className="text-2xl font-black text-white font-mono">{stat.value}</div>
              <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest mt-1">{stat.label}</div>
            </MagicCard>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Language Distribution */}
          <MagicCard className="lg:col-span-1 p-8 rounded-[2rem] flex flex-col items-center">
            <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-[0.2em] mb-8 self-start">Language Mix</h3>
            <div className="w-full h-[200px] flex items-center justify-center min-w-0 min-h-0 relative">
              {isMounted && stats.languages.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
                  <PieChart>
                    <Pie
                      data={stats.languages}
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="count"
                      isAnimationActive={false} // Disable animation to avoid initial size issues
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
                <div className="text-neutral-500 text-xs italic">
                  {!isMounted ? 'Loading Chart...' : 'No language data available'}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4 w-full mt-4">
              {stats.languages.map((lang, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: lang.color }} />
                  <span className="text-[11px] text-neutral-400 font-mono">{lang.name}</span>
                </div>
              ))}
            </div>
          </MagicCard>

          {/* Architecture Overview */}
          <MagicCard className="lg:col-span-2 p-8 rounded-[2rem]">
            <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-[0.2em] mb-6">Architecture Insights</h3>
            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-white/10 text-white rounded-lg shrink-0">
                  <Zap size={18} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white mb-1">Pattern Detected</h4>
                  <p className="text-xs text-neutral-400 leading-relaxed">
                    {overview?.architecture_type || "Standard Node.js/TypeScript structure with modular directory organization."}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="p-2 bg-white/10 text-white rounded-lg shrink-0">
                  <Globe size={18} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white mb-1">Entry Points</h4>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {(overview?.entry_points || []).map((ep, i) => (
                      <div key={i} className="px-3 py-1.5 bg-neutral-800 border border-white/10 rounded-full text-[10px] text-neutral-300 font-mono">
                        {ep.path}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </MagicCard>
        </div>

        {/* Core Modules */}
        <MagicCard className="p-8 rounded-[2rem]">
           <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-[0.2em] mb-6">Core Modules</h3>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             {(overview?.core_modules || []).map((mod, i) => (
               <div key={i} className="p-4 bg-neutral-950/50 border border-white/10 rounded-2xl hover:border-white/30 transition-colors">
                 <div className="text-white font-bold text-sm font-mono mb-1">/{mod.folder}</div>
                 <div className="text-xs text-neutral-500 leading-relaxed">{mod.description}</div>
               </div>
             ))}
           </div>
        </MagicCard>

      </div>
    </div>
  );
};
