
export interface RepoFile {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  url: string;
  content?: string;
}

export interface Highlight {
  file: string;
  start: number;
  end: number;
  label: string;
  function_name?: string;
  explanation?: string;
  params?: string;
  returns?: string;
  description?: string;
  logic_source?: string;
  call_flow_markdown?: string;
  usage_examples?: UsageExample[];
}

export interface RelatedSymbol {
  symbol: string;
  file: string;
  start: number;
  end: number;
}

export interface RepoOverview {
  summary: string;
  entry_points: { path: string; purpose: string }[];
  core_modules: { folder: string; description: string }[];
  architecture_type: string;
}

export interface DependencyNode {
  id: string;
  label: string;
  file: string;
  type: 'function' | 'file' | 'class' | 'variable';
  line?: number;
}

export interface DependencyLink {
  source: string;
  target: string;
  label?: string;
}

export interface UsageExample {
  file: string;
  line: number;
  arguments: string;
  context_explanation: string;
}

export interface DependencyGraphData {
  nodes: DependencyNode[];
  links: DependencyLink[];
  usage_examples?: UsageExample[];
  call_flow_markdown?: string;
}

export interface RepoStats {
  fileCount: number;
  folderCount: number;
  languages: { name: string; count: number; color: string }[];
  totalLines: number;
}

export interface AnalysisResult {
  answer_markdown: string;
  highlights: Highlight[];
  call_tree_markdown?: string;
  related: RelatedSymbol[];
  context_bundles?: {
    title: string;
    description: string;
    files: string[];
  }[];
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  analysis?: AnalysisResult;
  sources?: { path: string; startLine: number; endLine: number }[];
}

export type AIProvider = 'gemini' | 'openai';

export interface AIConfig {
  provider: AIProvider;
  apiKey?: string;
  baseUrl?: string;
  flashModel?: string;
  proModel?: string;
  embeddingModel?: string;
  useFlash?: boolean;
}

export interface Repository {
  owner: string;
  name: string;
  branch: string;
}
