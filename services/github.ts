
import { RepoFile, Repository } from '../types';

export const parseRepoUrl = (url: string): Repository | null => {
  try {
    const cleanUrl = url.replace(/\/$/, '');
    const parts = cleanUrl.split('/');
    if (parts.length < 5) return null;
    return {
      owner: parts[3],
      name: parts[4],
      branch: 'main'
    };
  } catch {
    return null;
  }
};

export const fetchRepoTree = async (repo: Repository, token?: string): Promise<RepoFile[]> => {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  const repoRes = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}`, { headers });
  
  if (repoRes.status === 403) {
    throw new Error('GitHub API rate limit exceeded. Please try again later.');
  }
  
  if (!repoRes.ok) {
    if (repoRes.status === 404) {
      throw new Error(`Repository not found. If this is a private repository, please ensure you are connected to GitHub.`);
    }
    throw new Error(`Failed to fetch repository info: ${repoRes.status} ${repoRes.statusText || ''}`);
  }

  const repoInfo = await repoRes.json();
  const branch = repoInfo.default_branch || 'main';
  
  const treeUrl = `https://api.github.com/repos/${repo.owner}/${repo.name}/git/trees/${branch}?recursive=1`;
  const response = await fetch(treeUrl, { headers });

  if (response.status === 403) {
    throw new Error('GitHub API rate limit exceeded. Large repositories often hit this limit on unauthenticated requests.');
  }

  if (!response.ok) {
    // Large repos sometimes fail recursive fetch due to size limits. Try non-recursive as fallback.
    const fallbackUrl = `https://api.github.com/repos/${repo.owner}/${repo.name}/git/trees/${branch}`;
    const fallbackResponse = await fetch(fallbackUrl, { headers });
    if (!fallbackResponse.ok) {
      throw new Error(`Failed to fetch repo tree: ${response.status} ${response.statusText || ''}`);
    }
    const fallbackData = await fallbackResponse.json();
    return (fallbackData.tree || []) as RepoFile[];
  }

  const data = await response.json();
  return (data.tree || []) as RepoFile[];
};

export const fetchFileContent = async (repo: Repository, path: string, token?: string): Promise<string> => {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  const response = await fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${path}`,
    { headers }
  );
  if (!response.ok) {
    if (response.status === 403) throw new Error('API rate limit exceeded.');
    throw new Error(`Failed to fetch file content: ${response.status} ${response.statusText || ''}`);
  }
  const data = await response.json();
  
  if (!data.content) {
    if (data.type === 'dir') {
      return 'This is a directory. Select a file to view its content.';
    }
    if (data.size > 1000000) {
      return 'File is too large to display inline. Please view it directly on GitHub.';
    }
    return 'No content available for this file.';
  }

  try {
    // Standard robust base64 to UTF-8 decoding for browser
    const base64 = data.content.replace(/\s/g, '');
    return decodeURIComponent(escape(atob(base64)));
  } catch (e) {
    console.error('Base64 decoding failed', e);
    return 'Error decoding file content. It might be binary or use an unsupported encoding.';
  }
};
