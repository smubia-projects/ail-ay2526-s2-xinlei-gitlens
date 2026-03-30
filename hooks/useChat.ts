import { useState, useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { analyzeCode, explainSelection } from '../services/gemini';
import { ChatMessage, RepoFile } from '../types';

export function useChat() {
  const {
    query, setQuery,
    messages, setMessages,
    repo, files, overview,
    attachedFiles, setAttachedFiles,
    isLoading, setIsLoading,
    setLoadingTime,
    setCurrentSources,
    setTargetLine,
    setScrollTrigger,
    setSidebarTab,
    setActiveTab,
    aiConfig,
    guestId,
    githubToken,
    jwtToken,
    selectedFile,
    setFocusedFunction,
    showFileSuggestions, setShowFileSuggestions,
    fileSuggestions, setFileSuggestions,
    suggestionIndex, setSuggestionIndex,
    isDragging, setIsDragging
  } = useAppContext();

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!messagesContainerRef.current || !scrollRef.current) return;
    
    const observer = new ResizeObserver(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
    
    observer.observe(messagesContainerRef.current);
    return () => observer.disconnect();
  }, []);

  const getJwtToken = () => {
    return jwtToken || localStorage.getItem('gitlens_token');
  };

  const runAnalysis = async (userQuery: string, history: { role: 'user' | 'assistant'; content: string }[] = [], forceFlash = false) => {
    if (!repo) return;
    
    setIsLoading(true);
    setLoadingTime(0);
    const startTime = Date.now();
    
    const timer = setInterval(() => {
      setLoadingTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    try {
      const result = await analyzeCode(
        userQuery, 
        selectedFile && selectedFile.content ? { path: selectedFile.path, content: selectedFile.content } : null,
        files.map(f => f.path),
        overview,
        forceFlash || aiConfig.useFlash,
        [], // snippets
        attachedFiles.filter((f): f is RepoFile & { content: string } => !!f.content).map(f => ({ path: f.path, content: f.content })),
        history
      );
      
      const assistantSources = result.highlights.map(h => ({
        path: h.file,
        startLine: h.start,
        endLine: h.end
      }));

      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: result.answer_markdown,
        analysis: result,
        sources: assistantSources
      }]);

      if (assistantSources.length > 0) {
        setCurrentSources(assistantSources);
        const firstSource = assistantSources[0];
        if (firstSource.path) {
          setTargetLine(firstSource.startLine);
          setScrollTrigger(prev => prev + 1);
          setSidebarTab('chat');
          setActiveTab('code');
        }
      }
    } catch (e: any) {
      console.error("Analysis failed:", e);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `**Error**: Failed to analyze code. ${e.message || 'Please try again.'}` 
      }]);
    } finally {
      clearInterval(timer);
      setIsLoading(false);
    }
  };

  const handleExplainSelection = async (selection: string) => {
    if (!selectedFile || !repo) return;
    
    const prompt = `Explain this code snippet from ${selectedFile.path}:\n\n\`\`\`\n${selection}\n\`\`\``;
    setQuery(prompt);
    
    setMessages(prev => [...prev, { 
      role: 'user', 
      content: prompt,
      sources: [{ path: selectedFile.path, startLine: 1, endLine: 1 }]
    }]);
    
    setSidebarTab('chat');
    await runAnalysis(prompt, messages, true);
  };

  const handleQuery = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim() || !repo) return;
    const userQuery = query;
    const currentMessages = messages;
    setQuery('');
    
    const textarea = document.getElementById('chat-input') as HTMLTextAreaElement;
    if (textarea) {
      textarea.style.height = 'auto';
    }

    setMessages(prev => [...prev, { 
      role: 'user', 
      content: userQuery,
      sources: attachedFiles.length > 0 ? attachedFiles.map(f => ({ path: f.path, startLine: 1, endLine: 1 })) : undefined
    }]);
    setFocusedFunction(null);
    await runAnalysis(userQuery, currentMessages);
    setAttachedFiles([]);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const val = e.target.value;
    setQuery(val);

    const lastAtPos = val.lastIndexOf('@');
    if (lastAtPos !== -1 && (lastAtPos === 0 || val[lastAtPos - 1] === ' ')) {
      const search = val.slice(lastAtPos + 1).toLowerCase();
      const filtered = files.filter(f => f.type === 'blob' && f.path.toLowerCase().includes(search)).slice(0, 10);
      if (filtered.length > 0) {
        setFileSuggestions(filtered);
        setShowFileSuggestions(true);
        setSuggestionIndex(0);
      } else {
        setShowFileSuggestions(false);
      }
    } else {
      setShowFileSuggestions(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showFileSuggestions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestionIndex(prev => (prev + 1) % fileSuggestions.length);
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestionIndex(prev => (prev - 1 + fileSuggestions.length) % fileSuggestions.length);
        return;
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = fileSuggestions[suggestionIndex];
        const lastAtPos = query.lastIndexOf('@');
        const newVal = query.slice(0, lastAtPos) + `@${selected.path.split('/').pop()} `;
        setQuery(newVal);
        
        // We need to attach the file here.
        // We can't easily call handleAttachFile from App.tsx without passing it.
        // Let's just add it to attachedFiles directly if we have the content.
        // Actually, we should just pass handleAttachFile to useChat or return the path to attach.
        // For now, let's return it or handle it in the component.
        setShowFileSuggestions(false);
        return;
      } else if (e.key === 'Escape') {
        setShowFileSuggestions(false);
        return;
      }
    }

    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleQuery();
    }
  };

  return {
    messagesContainerRef,
    scrollRef,
    runAnalysis,
    handleExplainSelection,
    handleQuery,
    handleInputChange,
    handleKeyDown
  };
}
