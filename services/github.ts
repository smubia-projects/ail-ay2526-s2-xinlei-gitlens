
import { RepoFile, Repository } from '../types';

export const parseRepoUrl = (url: string): Repository | null => {
  try {
    const cleanUrl = url.replace(/\/$/, '');
    const parts = cleanUrl.split('/');
    if (parts.length < 5) return null;
    
    const owner = parts[3];
    const name = parts[4];
    let branch = 'main';
    
    // Handle https://github.com/owner/repo/tree/branch
    if (parts.length >= 7 && parts[5] === 'tree') {
      branch = parts[6];
    }
    
    return { owner, name, branch };
  } catch {
    return null;
  }
};

export const fetchRepoTree = async (repo: Repository, token?: string): Promise<RepoFile[]> => {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const repoRes = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}`, { headers });
  
  if (repoRes.status === 401) {
    throw new Error('GitHub token expired or invalid. Please reconnect your GitHub account.');
  }
  
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

export const fetchFileContent = async (repo: Repository, path: string, token?: string): Promise<{ content: string; isImage: boolean; downloadUrl?: string }> => {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${path}`,
    { headers }
  );
  if (!response.ok) {
    if (response.status === 401) throw new Error('GitHub token expired or invalid. Please reconnect your GitHub account.');
    if (response.status === 403) throw new Error('API rate limit exceeded.');
    throw new Error(`Failed to fetch file content: ${response.status} ${response.statusText || ''}`);
  }
  const data = await response.json();
  
  const isImage = /\.(png|jpe?g|gif|svg|webp|ico)$/i.test(path);

  if (isImage && data.download_url) {
    return { content: '', isImage: true, downloadUrl: data.download_url };
  }

  if (!data.content) {
    if (data.type === 'dir') {
      return { content: 'This is a directory. Select a file to view its content.', isImage: false };
    }
    if (data.size > 1000000) {
      return { content: 'File is too large to display inline. Please view it directly on GitHub.', isImage: false };
    }
    return { content: 'No content available for this file.', isImage: false };
  }

  try {
    // Standard robust base64 to UTF-8 decoding for browser
    const base64 = data.content.replace(/\s/g, '');
    return { content: decodeURIComponent(escape(atob(base64))), isImage: false };
  } catch (e) {
    console.error('Base64 decoding failed', e);
    return { content: 'Error decoding file content. It might be binary or use an unsupported encoding.', isImage: false };
  }
};
