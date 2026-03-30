import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Repository, RepoFile, ChatMessage, Highlight, RepoOverview, DependencyGraphData, RepoStats, AIConfig } from '../types';

interface AppContextType {
  // Auth & Config
  guestId: string | null;
  setGuestId: React.Dispatch<React.SetStateAction<string | null>>;
  githubUser: any;
  setGithubUser: React.Dispatch<React.SetStateAction<any>>;
  githubToken: string | null;
  setGithubToken: React.Dispatch<React.SetStateAction<string | null>>;
  jwtToken: string | null;
  setJwtToken: React.Dispatch<React.SetStateAction<string | null>>;
  isCheckingAuth: boolean;
  setIsCheckingAuth: React.Dispatch<React.SetStateAction<boolean>>;
  aiConfig: AIConfig;
  setAiConfigState: React.Dispatch<React.SetStateAction<AIConfig>>;
  isSettingsOpen: boolean;
  setIsSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // Repo State
  url: string;
  setUrl: React.Dispatch<React.SetStateAction<string>>;
  repo: Repository | null;
  setRepo: React.Dispatch<React.SetStateAction<Repository | null>>;
  files: RepoFile[];
  setFiles: React.Dispatch<React.SetStateAction<RepoFile[]>>;
  selectedFile: { path: string; content: string; isImage?: boolean; downloadUrl?: string } | null;
  setSelectedFile: React.Dispatch<React.SetStateAction<{ path: string; content: string; isImage?: boolean; downloadUrl?: string } | null>>;
  overview: RepoOverview | null;
  setOverview: React.Dispatch<React.SetStateAction<RepoOverview | null>>;
  stats: RepoStats | null;
  setStats: React.Dispatch<React.SetStateAction<RepoStats | null>>;

  // UI State
  view: 'home' | 'repo';
  setView: React.Dispatch<React.SetStateAction<'home' | 'repo'>>;
  activeTab: 'code' | 'map' | 'dashboard' | 'logic';
  setActiveTab: React.Dispatch<React.SetStateAction<'code' | 'map' | 'dashboard' | 'logic'>>;
  sidebarTab: 'map' | 'focus' | 'chat';
  setSidebarTab: React.Dispatch<React.SetStateAction<'map' | 'focus' | 'chat'>>;
  showFilesystem: boolean;
  setShowFilesystem: React.Dispatch<React.SetStateAction<boolean>>;
  showIntelligence: boolean;
  setShowIntelligence: React.Dispatch<React.SetStateAction<boolean>>;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;

  // Chat State
  query: string;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  attachedFiles: RepoFile[];
  setAttachedFiles: React.Dispatch<React.SetStateAction<RepoFile[]>>;
  fileSuggestions: RepoFile[];
  setFileSuggestions: React.Dispatch<React.SetStateAction<RepoFile[]>>;
  showFileSuggestions: boolean;
  setShowFileSuggestions: React.Dispatch<React.SetStateAction<boolean>>;
  suggestionIndex: number;
  setSuggestionIndex: React.Dispatch<React.SetStateAction<number>>;
  isDragging: boolean;
  setIsDragging: React.Dispatch<React.SetStateAction<boolean>>;

  // Loading States
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  isIndexing: boolean;
  setIsIndexing: React.Dispatch<React.SetStateAction<boolean>>;
  loadingTime: number;
  setLoadingTime: React.Dispatch<React.SetStateAction<number>>;
  indexingProgress: { current: number; total: number; stage: string } | null;
  setIndexingProgress: React.Dispatch<React.SetStateAction<{ current: number; total: number; stage: string } | null>>;
  isGeneratingGraph: boolean;
  setIsGeneratingGraph: React.Dispatch<React.SetStateAction<boolean>>;
  isScanningFile: boolean;
  setIsScanningFile: React.Dispatch<React.SetStateAction<boolean>>;

  // Analysis & Highlights
  activeHighlights: Highlight[];
  setActiveHighlights: React.Dispatch<React.SetStateAction<Highlight[]>>;
  scrollTrigger: number;
  setScrollTrigger: React.Dispatch<React.SetStateAction<number>>;
  targetLine: number | undefined;
  setTargetLine: React.Dispatch<React.SetStateAction<number | undefined>>;
  focusedFunction: Highlight | null;
  setFocusedFunction: React.Dispatch<React.SetStateAction<Highlight | null>>;
  showHighlights: boolean;
  setShowHighlights: React.Dispatch<React.SetStateAction<boolean>>;
  dependencyData: DependencyGraphData | null;
  setDependencyData: React.Dispatch<React.SetStateAction<DependencyGraphData | null>>;
  currentSources: { path: string; startLine: number; endLine: number }[];
  setCurrentSources: React.Dispatch<React.SetStateAction<{ path: string; startLine: number; endLine: number }[]>>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [guestId, setGuestId] = useState<string | null>(null);
  const [url, setUrl] = useState('https://github.com/facebook/react');
  const [repo, setRepo] = useState<Repository | null>(null);
  const [files, setFiles] = useState<RepoFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<{ path: string; content: string; isImage?: boolean; downloadUrl?: string } | null>(null);
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingTime, setLoadingTime] = useState(0);
  const [isIndexing, setIsIndexing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [aiConfig, setAiConfigState] = useState<AIConfig>(() => {
    const saved = localStorage.getItem('gitlens_ai_config');
    return saved ? JSON.parse(saved) : { provider: 'gemini', useFlash: true };
  });
  const [jwtToken, setJwtToken] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<RepoFile[]>([]);
  const [showFileSuggestions, setShowFileSuggestions] = useState(false);
  const [fileSuggestions, setFileSuggestions] = useState<RepoFile[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
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
  const [activeTab, setActiveTab] = useState<'code' | 'map' | 'dashboard' | 'logic'>('code');
  const [sidebarTab, setSidebarTab] = useState<'map' | 'focus' | 'chat'>('map');
  const [view, setView] = useState<'home' | 'repo'>('home');
  const [showFilesystem, setShowFilesystem] = useState(true);
  const [showIntelligence, setShowIntelligence] = useState(true);
  const [stats, setStats] = useState<RepoStats | null>(null);
  const [githubUser, setGithubUser] = useState<any>(null);
  const [githubToken, setGithubToken] = useState<string | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  const value = {
    guestId, setGuestId,
    githubUser, setGithubUser,
    githubToken, setGithubToken,
    jwtToken, setJwtToken,
    isCheckingAuth, setIsCheckingAuth,
    aiConfig, setAiConfigState,
    isSettingsOpen, setIsSettingsOpen,
    url, setUrl,
    repo, setRepo,
    files, setFiles,
    selectedFile, setSelectedFile,
    overview, setOverview,
    stats, setStats,
    view, setView,
    activeTab, setActiveTab,
    sidebarTab, setSidebarTab,
    showFilesystem, setShowFilesystem,
    showIntelligence, setShowIntelligence,
    error, setError,
    query, setQuery,
    messages, setMessages,
    attachedFiles, setAttachedFiles,
    fileSuggestions, setFileSuggestions,
    showFileSuggestions, setShowFileSuggestions,
    suggestionIndex, setSuggestionIndex,
    isDragging, setIsDragging,
    isLoading, setIsLoading,
    isIndexing, setIsIndexing,
    loadingTime, setLoadingTime,
    indexingProgress, setIndexingProgress,
    isGeneratingGraph, setIsGeneratingGraph,
    isScanningFile, setIsScanningFile,
    activeHighlights, setActiveHighlights,
    scrollTrigger, setScrollTrigger,
    targetLine, setTargetLine,
    focusedFunction, setFocusedFunction,
    showHighlights, setShowHighlights,
    dependencyData, setDependencyData,
    currentSources, setCurrentSources
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
