import express from "express";
import { createServer as createViteServer } from "vite";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import axios from "axios";
import path from "path";
import { GoogleGenAI } from "@google/genai";

import { RepoModel } from "./models/Repo.js";
import { SnippetModel } from "./models/Snippet.js";
import { UserModel } from "./models/User.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const JWT_SECRET = process.env.SESSION_SECRET || 'gitlens-jwt-secret';

dotenv.config();

console.log("SERVER STARTING...");
console.log("NODE_ENV:", process.env.NODE_ENV);

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

import { MongoClient } from 'mongodb';

let lastDbError: string | null = null;

async function startServer() {
  const app = express();
  const PORT = 3000;

  // MongoDB Connection (Don't block server start)
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    console.error("CRITICAL: MONGODB_URI environment variable is not set!");
  }
  
  const maskedUri = MONGODB_URI ? MONGODB_URI.replace(/:([^@]+)@/, ":****@") : "undefined";
  console.log(`Attempting to connect to MongoDB...`);
  console.log(`Source: ${process.env.MONGODB_URI ? 'Environment Variable (MONGODB_URI)' : 'None'}`);
  console.log(`URI: ${maskedUri}`);
  
  mongoose.connection.on('connected', () => {
    console.log("Mongoose connected to DB Cluster");
    lastDbError = null;
  });

  mongoose.connection.on('error', (err) => {
    console.error("Mongoose connection error event:", err);
    lastDbError = err.message;
  });

  mongoose.connection.on('disconnected', () => {
    console.log("Mongoose disconnected");
  });

  // mongoose.set('debug', true);

  console.log("Calling mongoose.connect...");
  mongoose.connect(MONGODB_URI, { 
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
  }).then(() => {
    console.log("Initial MongoDB connection established successfully");
    lastDbError = null;
  }).catch(err => {
    console.error("CRITICAL: Initial MongoDB connection failed!");
    lastDbError = err.message;
  });

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  
  // Middleware to extract user from JWT token
  app.use((req: any, res, next) => {
    const authHeader = req.headers.authorization;
    req.guestId = req.headers['x-guest-id'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        req.user = decoded.user;
        req.githubToken = decoded.githubToken;
      } catch (err) {
        console.warn("Invalid token received");
      }
    }
    next();
  });

  // Request logger
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  // Health check
  app.get("/api/health", async (req, res) => {
    let driverTest = "Not attempted";
    let indexTest = "Not attempted";
    
    if (mongoose.connection.readyState === 1) {
      try {
        const collections = await mongoose.connection.db.listCollections({ name: 'repositories' }).toArray();
        if (collections.length > 0) {
          const collection = mongoose.connection.db.collection('repositories');
          const indexes = await collection.listIndexes().toArray();
          const hasStandardIndex = indexes.some(idx => idx.name === 'vector_index');
          
          let hasSearchIndex = false;
          try {
            // Atlas Search/Vector indexes are listed via listSearchIndexes
            const searchIndexes = await (collection as any).listSearchIndexes().toArray();
            hasSearchIndex = searchIndexes.some((idx: any) => idx.name === 'vector_index');
          } catch (e) {
            // listSearchIndexes might fail if not on Atlas or older driver, ignore
          }

          const hasVectorIndex = hasStandardIndex || hasSearchIndex;
          indexTest = hasVectorIndex ? "Success (vector_index found)" : "Warning (vector_index NOT found)";
        } else {
          indexTest = "Info (repositories collection doesn't exist yet)";
        }
      } catch (err: any) {
        indexTest = `Error: ${err.message}`;
      }
    }

    if (mongoose.connection.readyState !== 1) {
      try {
        const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
        await client.connect();
        await client.db('admin').command({ ping: 1 });
        await client.close();
        driverTest = "Success (Native driver connected, Mongoose is lagging)";
      } catch (err: any) {
        driverTest = `Failed: ${err.message}`;
      }
    } else {
      driverTest = "Success (Mongoose connected)";
    }

    res.json({ 
      status: "ok", 
      message: "Server is running",
      dbState: mongoose.connection.readyState,
      dbStateName: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState],
      dbName: mongoose.connection.name,
      lastError: lastDbError,
      driverTest,
      indexTest,
      timestamp: new Date().toISOString()
    });
  });

  // Helper to mask API key
  const maskApiKey = (key?: string) => {
    if (!key) return '';
    if (key.length <= 8) return '********';
    return key.substring(0, 4) + '********' + key.substring(key.length - 4);
  };

  // AI Proxy Route
  app.post('/api/ai/proxy', async (req: any, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    
    try {
      const { prompt, model, config: requestConfig, contents } = req.body;
      const user = await UserModel.findOne({ githubId: req.user.id });
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const aiConfig = (user.aiConfig || {}) as any;
      const provider = aiConfig.provider || 'gemini';
      const apiKey = aiConfig.apiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;

      if (!apiKey) {
        return res.status(400).json({ error: 'AI API Key not configured' });
      }

      if (provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey });
        const defaultFlash = 'gemini-3-flash-preview';
        const defaultPro = 'gemini-3.1-pro-preview';
        const modelName = model || (aiConfig.useFlash 
          ? (aiConfig.flashModel || defaultFlash) 
          : (aiConfig.proModel || defaultPro));
        
        let result;
        if (contents) {
          result = await ai.models.generateContent({ 
            model: modelName,
            contents,
            config: requestConfig
          });
        } else {
          result = await ai.models.generateContent({
            model: modelName,
            contents: [{ parts: [{ text: prompt }] }],
            config: requestConfig
          });
        }
        
        res.json({ text: result.text });
      } else if (provider === 'openai') {
        const baseUrl = aiConfig.baseUrl || 'https://api.openai.com/v1';
        const defaultFlash = 'gpt-4o-mini';
        const defaultPro = 'gpt-4o';
        const chatModel = model || (aiConfig.useFlash 
          ? (aiConfig.flashModel || defaultFlash) 
          : (aiConfig.proModel || defaultPro));
        
        let messages: any[] = [];
        if (Array.isArray(contents)) {
          messages = contents.map((c: any) => {
            if (typeof c === 'string') return { role: 'user', content: c };
            return {
              role: c.role === 'model' ? 'assistant' : (c.role || 'user'),
              content: c.parts ? c.parts.map((p: any) => p.text).join('\n') : (c.text || JSON.stringify(c))
            };
          });
        } else if (typeof contents === 'string') {
          messages = [{ role: 'user', content: contents }];
        } else if (contents && contents.parts) {
          messages = [{ role: 'user', content: contents.parts.map((p: any) => p.text).join('\n') }];
        } else if (prompt) {
          messages = [{ role: 'user', content: prompt }];
        } else {
          messages = [{ role: 'user', content: JSON.stringify(contents) }];
        }

        const response = await axios.post(`${baseUrl}/chat/completions`, {
          model: chatModel,
          messages: messages,
          ...requestConfig
        }, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        });
        
        res.json({ text: response.data.choices[0].message.content });
      } else {
        res.status(400).json({ error: 'Unsupported AI provider' });
      }
    } catch (error: any) {
      console.error('AI Proxy Error:', error.response?.data || error.message);
      res.status(500).json({ error: error.message, details: error.response?.data });
    }
  });

  // AI Embedding Proxy
  app.post('/api/ai/embed', async (req: any, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    
    try {
      const { text, model } = req.body;
      const user = await UserModel.findOne({ githubId: req.user.id });
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const aiConfig = (user.aiConfig || {}) as any;
      const provider = aiConfig.provider || 'gemini';
      const apiKey = aiConfig.apiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;

      if (!apiKey) {
        return res.status(400).json({ error: 'AI API Key not configured' });
      }

      if (provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey });
        const modelName = model || aiConfig.embeddingModel || 'gemini-embedding-2-preview';
        const result = await ai.models.embedContent({
          model: modelName,
          contents: [text]
        });
        res.json({ embedding: result.embeddings[0].values });
      } else if (provider === 'openai') {
        const baseUrl = aiConfig.baseUrl || 'https://api.openai.com/v1';
        const embedModel = model || aiConfig.embeddingModel || 'text-embedding-3-small';
        
        const payload: any = {
          model: embedModel,
          input: text.length > 30000 ? text.substring(0, 30000) : text
        };

        if (embedModel.includes('text-embedding-3')) {
          payload.dimensions = 768;
        }
        
        const response = await axios.post(`${baseUrl}/embeddings`, payload, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        });
        
        let embedding = response.data.data[0].embedding;
        if (embedding.length > 768) {
          embedding = embedding.slice(0, 768);
        }
        
        res.json({ embedding });
      } else {
        res.status(400).json({ error: 'Unsupported AI provider' });
      }
    } catch (error: any) {
      console.error('AI Embedding Error:', error.response?.data || error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // User Config Routes
  app.get("/api/user/config", async (req: any, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    
    try {
      const user = await UserModel.findOne({ githubId: req.user.id });
      if (!user) return res.status(404).json({ error: "User not found" });
      
      const config = user.aiConfig ? (user.aiConfig as any).toObject() : {};
      if (config.apiKey) {
        config.apiKey = maskApiKey(config.apiKey);
      }
      
      res.json(config);
    } catch (err) {
      console.error("Failed to fetch user config:", err);
      res.status(500).json({ error: "Failed to fetch user config" });
    }
  });

  app.post("/api/user/config", async (req: any, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    
    try {
      const user = await UserModel.findOne({ githubId: req.user.id });
      if (!user) return res.status(404).json({ error: "User not found" });
      
      const newConfig = { ...req.body };
      
      // If the key is masked, don't update it
      if (newConfig.apiKey && newConfig.apiKey.includes('********')) {
        delete newConfig.apiKey;
      }
      
      user.aiConfig = {
        ...(user.aiConfig ? (user.aiConfig as any).toObject() : {}),
        ...newConfig
      };
      
      await user.save();
      
      const config = (user.aiConfig as any).toObject();
      if (config.apiKey) {
        config.apiKey = maskApiKey(config.apiKey);
      }
      
      res.json(config);
    } catch (err) {
      console.error("Failed to save user config:", err);
      res.status(500).json({ error: "Failed to save user config" });
    }
  });

  // Auth Routes
  app.get("/api/auth/github/url", (req, res) => {
    const client_id = process.env.GITHUB_CLIENT_ID;
    const app_name = process.env.GITHUB_APP_NAME || "gitlens-cursor"; // Fallback to a default or placeholder
    
    if (!client_id) {
      return res.status(500).json({ error: "GITHUB_CLIENT_ID not configured" });
    }
    
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const redirect_uri = `${baseUrl}/api/auth/github/callback`;
    
    // Standard OAuth URL
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${client_id}&redirect_uri=${encodeURIComponent(redirect_uri)}&scope=repo,user:email`;
    
    // Installation URL (The "Quick Way" to get repo access)
    const installUrl = `https://github.com/apps/${app_name}/installations/new`;
    
    res.json({ authUrl, installUrl });
  });

  app.get("/api/auth/github/callback", async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send("No code provided");
    console.log(`OAuth callback received with code: ${code.toString().substring(0, 5)}...`);

    try {
      const response = await axios.post("https://github.com/login/oauth/access_token", {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }, {
        headers: { 
          Accept: "application/json",
          "User-Agent": "GitLens-App"
        }
      });

      const { access_token, error } = response.data;
      if (error) {
        console.error("GitHub OAuth error:", error);
        throw new Error(error);
      }

      if (!access_token) {
        console.error("No access token in GitHub response:", response.data);
        throw new Error("No access token received from GitHub");
      }

      console.log("Access token received, fetching user info...");
      // Get user info
      const userRes = await axios.get("https://api.github.com/user", {
        headers: { 
          Authorization: `token ${access_token}`,
          "User-Agent": "GitLens-App"
        }
      });

      console.log(`Authenticated as GitHub user: ${userRes.data.login}`);

      const userData = {
        login: userRes.data.login,
        id: userRes.data.id,
        avatar_url: userRes.data.avatar_url
      };

      // Find or create user in MongoDB
      let user = await UserModel.findOne({ githubId: userData.id });
      if (!user) {
        user = await UserModel.create({
          githubId: userData.id,
          login: userData.login,
          avatarUrl: userData.avatar_url
        });
        console.log(`New user created: ${userData.login}`);
      } else {
        // Update login and avatar if they changed
        user.login = userData.login;
        user.avatarUrl = userData.avatar_url;
        await user.save();
        console.log(`Existing user logged in: ${userData.login}`);
      }

      // Generate JWT token
      const token = jwt.sign({ 
        user: userData, 
        githubToken: access_token 
      }, JWT_SECRET, { expiresIn: '24h' });

      res.send(`
        <html>
          <body>
            <script>
              console.log("Sending OAUTH_AUTH_SUCCESS message to opener...");
              if (window.opener) {
                window.opener.postMessage({ 
                  type: 'OAUTH_AUTH_SUCCESS',
                  token: '${token}',
                  user: ${JSON.stringify(userData)}
                }, '*');
                setTimeout(() => window.close(), 100);
              } else {
                console.warn("No window.opener found, redirecting to home...");
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. This window should close automatically.</p>
          </body>
        </html>
      `);
    } catch (err: any) {
      console.error("OAuth callback error:", err.response?.data || err.message);
      res.status(500).send(`Authentication failed: ${err.message}`);
    }
  });

  app.get("/api/auth/me", (req: any, res) => {
    console.log("Auth check request received.");
    
    if (req.user) {
      console.log(`Auth check: User ${req.user.login} is logged in.`);
      res.json({ 
        user: req.user,
        token: req.githubToken
      });
    } else {
      console.log("Auth check: No active session found.");
      res.status(401).json({ error: "Not authenticated" });
    }
  });

  app.get("/api/auth/logout", (req, res) => {
    res.json({ message: "Logged out" });
  });

  app.get("/api/github/installations", async (req: any, res) => {
    if (!req.githubToken) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const response = await axios.get("https://api.github.com/user/installations", {
        headers: { 
          Authorization: `token ${req.githubToken}`,
          "User-Agent": "GitLens-App",
          "Accept": "application/vnd.github.v3+json"
        }
      });
      res.json(response.data);
    } catch (error: any) {
      console.error("Failed to fetch installations:", error.response?.data || error.message);
      res.status(500).json({ error: "Failed to fetch installations" });
    }
  });

  app.get("/api/github/user/repos", async (req: any, res) => {
    if (!req.githubToken) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      console.log(`Fetching all repos for user with token starting with: ${req.githubToken?.substring(0, 10)}...`);
      
      let allRepos: any[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore && page <= 10) { // Limit to 10 pages (1000 repos) to avoid timeouts
        console.log(`Fetching page ${page}...`);
        const response = await axios.get("https://api.github.com/user/repos", {
          headers: { 
            Authorization: `token ${req.githubToken}`,
            "User-Agent": "GitLens-App"
          },
          params: {
            sort: 'updated',
            per_page: 100,
            page: page,
            type: 'all'
          }
        });

        // Log scopes for debugging
        if (page === 1) {
          console.log(`GitHub API Scopes: ${response.headers['x-oauth-scopes']}`);
          console.log(`GitHub API Accepted Scopes: ${response.headers['x-accepted-oauth-scopes']}`);
        }

        const repos = response.data;
        if (repos.length > 0) {
          allRepos = [...allRepos, ...repos];
          
          // Debug logging for visibility
          const privateCount = repos.filter((r: any) => r.private).length;
          const publicCount = repos.filter((r: any) => !r.private).length;
          console.log(`Page ${page}: Found ${repos.length} repos (${publicCount} public, ${privateCount} private)`);
          
          if (repos.length < 100) {
            hasMore = false;
          } else {
            page++;
          }
        } else {
          hasMore = false;
        }
      }

      console.log(`GitHub returned ${allRepos.length} repositories in total across ${page} pages.`);
      if (allRepos.length > 0) {
        console.log("First 5 repos:", allRepos.slice(0, 5).map((r: any) => r.full_name).join(", "));
      }
      res.json(allRepos);
    } catch (err: any) {
      const errorData = err.response?.data;
      const errorMessage = typeof errorData === 'object' ? JSON.stringify(errorData) : (errorData || err.message);
      console.error("Failed to fetch user repos:", errorMessage);
      res.status(500).json({ 
        error: "Failed to fetch repositories from GitHub",
        details: err.response?.data?.message || err.message
      });
    }
  });

  // API Routes
  console.log("Registering API routes...");
  
  // Get all indexed repositories
  app.get("/api/repos", async (req: any, res) => {
    console.log("GET /api/repos hit");
    try {
      if (mongoose.connection.readyState !== 1) {
        console.warn("Database not connected, state:", mongoose.connection.readyState);
        return res.status(503).json({ error: "Database not connected", state: mongoose.connection.readyState });
      }

      // Filter logic:
      // 1. Logged in: Show repos you've indexed (indexedBy contains your ID) OR repos you own (githubUserId)
      // 2. Anonymous: Show repos you've indexed (indexedBy contains your guestId)
      
      let query: any;
      const currentUserId = req.user ? String(req.user.id) : req.guestId;
      
      if (req.user) {
        query = {
          $or: [
            { indexedBy: String(req.user.id) },
            { githubUserId: req.user.id }
          ]
        };
      } else if (req.guestId) {
        query = { indexedBy: req.guestId };
      } else {
        // No identity, only show public unowned repos as a fallback
        query = { githubUserId: { $exists: false }, isPrivate: false };
      }

      const repos = await RepoModel.find(query, { 
        owner: 1, 
        name: 1, 
        branch: 1, 
        lastIndexed: 1, 
        stats: 1, 
        overview: 1,
        githubUserId: 1,
        isPrivate: 1,
        isTemporary: 1,
        expiresAt: 1
      }).sort({ lastIndexed: -1 });
      console.log(`Found ${repos.length} repos for user ${req.user?.login || 'anonymous'}. Query: ${JSON.stringify(query)}`);
      return res.json(repos);
    } catch (err: any) {
      console.error("Fetch repos error:", err);
      return res.status(500).json({ error: "Database error", message: err.message });
    }
  });

  // Vector Search for repositories
  app.post("/api/repos/search", async (req: any, res) => {
    const { vector, limit = 5 } = req.body;
    if (!vector || !Array.isArray(vector)) {
      return res.status(400).json({ error: "Vector array is required" });
    }

    try {
      // Filter logic: same as GET /api/repos
      let filter: any;
      
      if (req.user) {
        filter = {
          $or: [
            { indexedBy: String(req.user.id) },
            { githubUserId: req.user.id }
          ]
        };
      } else if (req.guestId) {
        filter = { indexedBy: req.guestId };
      } else {
        filter = { githubUserId: { $exists: false }, isPrivate: false };
      }

      const results = await RepoModel.aggregate([
        {
          $vectorSearch: {
            index: "vector_index",
            path: "embedding",
            queryVector: vector,
            numCandidates: 100,
            limit: limit,
            filter: filter
          }
        },
        {
          $project: {
            owner: 1,
            name: 1,
            branch: 1,
            overview: 1,
            stats: 1,
            isPrivate: 1,
            githubUserId: 1,
            score: { $meta: "vectorSearchScore" }
          }
        }
      ]);
      return res.json(results);
    } catch (err: any) {
      console.error("Vector search error:", err);
      return res.status(500).json({ error: "Vector search failed", message: err.message });
    }
  });

  // Get cached repository
  app.get("/api/repo", async (req: any, res) => {
    const { owner, name, branch = 'main' } = req.query;
    console.log(`GET /api/repo hit for ${owner}/${name}`);
    if (!owner || !name) {
      return res.status(400).json({ error: "Owner and name are required" });
    }

    try {
      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: "Database not connected", state: mongoose.connection.readyState });
      }
      const repo = await RepoModel.findOne({ owner, name, branch });
      if (repo) {
        // Privacy check
        if (repo.isPrivate && (!req.user || repo.githubUserId !== req.user.id)) {
          return res.status(403).json({ error: "Access denied to private repository" });
        }
        
        // Add to user's personal library if not already there
        const currentUserId = req.user ? String(req.user.id) : req.guestId;
        if (currentUserId && !repo.indexedBy.includes(currentUserId)) {
          await RepoModel.updateOne(
            { _id: repo._id },
            { $addToSet: { indexedBy: currentUserId } }
          );
        }
        
        return res.json(repo);
      }
      return res.status(404).json({ message: "Not found" });
    } catch (err: any) {
      console.error("Fetch repo error:", err);
      return res.status(500).json({ error: "Database error", message: err.message });
    }
  });

  // Save/Update repository
  app.post("/api/repo", async (req: any, res) => {
    const { owner, name, branch, files, overview, stats, highlights, embedding } = req.body;
    console.log(`POST /api/repo hit for ${owner}/${name}`);
    
    try {
      // Check for existing private repo ownership
      const existingRepo = await RepoModel.findOne({ owner, name, branch });
      if (existingRepo && existingRepo.isPrivate) {
        if (!req.user || existingRepo.githubUserId !== req.user.id) {
          return res.status(403).json({ error: "Cannot update a private repository you do not own" });
        }
      }

      const updateData: any = { 
        $set: {
          files, 
          overview, 
          stats, 
          highlights, 
          embedding,
          lastIndexed: new Date()
        },
        $addToSet: { indexedBy: req.user ? String(req.user.id) : req.guestId }
      };

      if (req.user && req.githubToken) {
        // Authenticated user: Check permissions on GitHub
        try {
          console.log(`Verifying permissions for ${req.user.login} on ${owner}/${name}...`);
          const ghRes = await axios.get(`https://api.github.com/repos/${owner}/${name}`, {
            headers: { Authorization: `token ${req.githubToken}` }
          });
          
          const permissions = ghRes.data.permissions;
          const hasWriteAccess = permissions && (permissions.push || permissions.admin);
          
          updateData.$set.isPrivate = ghRes.data.private || false;

          if (hasWriteAccess) {
            console.log(`User ${req.user.login} HAS write access. Assigning ownership.`);
            updateData.$set.githubUserId = req.user.id;
          } else {
            console.log(`User ${req.user.login} does NOT have write access. Making permanent but unowned.`);
          }
        } catch (ghErr: any) {
          console.error("GitHub permission check failed:", ghErr.message);
        }
        
        updateData.$set.isTemporary = false;
        updateData.$unset = { expiresAt: "" }; // Remove TTL
      } else {
        // Unauthenticated user: repo is temporary, expires in 24h
        // Try to check if it's private even for unauthenticated (it will fail if private, which is correct)
        try {
          const ghRes = await axios.get(`https://api.github.com/repos/${owner}/${name}`);
          updateData.$set.isPrivate = ghRes.data.private || false;
        } catch (e) {
          // If it fails, it might be private or rate limited. 
        }

        const existingRepo = await RepoModel.findOne({ owner, name, branch });
        if (!existingRepo || !existingRepo.githubUserId) {
          updateData.$set.isTemporary = true;
          updateData.$set.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        }
      }

      const updatedRepo = await RepoModel.findOneAndUpdate(
        { owner, name, branch },
        updateData,
        { upsert: true, returnDocument: 'after' }
      );
      return res.json(updatedRepo);
    } catch (err) {
      console.error("Save error:", err);
      return res.status(500).json({ error: "Failed to save repository" });
    }
  });

  // Remove repository from index/library
  app.delete("/api/repo", async (req: any, res) => {
    const { owner, name, branch = 'main' } = req.query;
    const currentUserId = req.user ? String(req.user.id) : req.guestId;

    console.log(`DELETE /api/repo hit for ${owner}/${name} (branch: ${branch}) by ${currentUserId}`);
    
    if (!owner || !name) {
      return res.status(400).json({ error: "Owner and name are required" });
    }

    if (!currentUserId) {
      return res.status(401).json({ error: "Authentication or Guest ID required" });
    }

    try {
      const query: any = { owner, name, branch };
      const repo = await RepoModel.findOne(query);
      
      if (!repo) {
        return res.status(404).json({ error: "Repository not found in index" });
      }

      // Privacy check: If it's private, only the owner can delete it
      if (repo.isPrivate && (!req.user || repo.githubUserId !== req.user.id)) {
        return res.status(403).json({ error: "Access denied to private repository" });
      }

      // If the user is the owner, they can delete the whole thing for everyone
      const isOwner = req.user && repo.githubUserId === req.user.id;

      if (isOwner) {
        console.log(`Owner ${req.user.login} deleting repository ${owner}/${name} entirely.`);
        await RepoModel.deleteOne({ _id: repo._id });
        await SnippetModel.deleteMany({ repoId: repo._id });
        return res.json({ message: "Repository and its index deleted successfully" });
      }

      // Otherwise, just remove the current user/guest from indexedBy
      console.log(`Removing user ${currentUserId} from indexedBy for ${owner}/${name}.`);
      await RepoModel.updateOne(
        { _id: repo._id },
        { $pull: { indexedBy: currentUserId } }
      );

      // Check if it's now orphaned (no indexedBy and no owner)
      const updatedRepo = await RepoModel.findById(repo._id);
      if (updatedRepo && updatedRepo.indexedBy.length === 0 && !updatedRepo.githubUserId) {
        console.log(`Repository ${owner}/${name} is now orphaned. Deleting index.`);
        await RepoModel.deleteOne({ _id: repo._id });
        await SnippetModel.deleteMany({ repoId: repo._id });
      }

      return res.json({ message: "Repository removed from your library" });
    } catch (err: any) {
      console.error("Delete error:", err);
      return res.status(500).json({ error: "Failed to remove repository", message: err.message });
    }
  });

  // Search for symbol usages across the codebase
  app.get("/api/search/usages", async (req: any, res) => {
    const { symbol, owner, name } = req.query;
    if (!symbol) return res.status(400).json({ error: "Symbol is required" });

    try {
      // If owner and name are provided, search in the SnippetModel
      if (owner && name) {
        // Privacy check
        const repo = await RepoModel.findOne({ owner, name });
        if (repo && repo.isPrivate && (!req.user || repo.githubUserId !== req.user.id)) {
          return res.status(403).json({ error: "Access denied to private repository" });
        }

        console.log(`Searching for usages of "${symbol}" in ${owner}/${name}`);
        
        // Use a regex with word boundaries to find whole-word matches
        const regex = new RegExp(`\\b${symbol}\\b`);
        
        const snippets = await SnippetModel.find({
          owner,
          name,
          content: { $regex: regex }
        }).limit(100);

        const usages: any[] = [];
        snippets.forEach(s => {
          const lines = s.content.split('\n');
          lines.forEach((line, index) => {
            if (regex.test(line)) {
              usages.push({
                file: s.path,
                line: s.startLine + index,
                context: line.trim()
              });
            }
          });
        });

        // De-duplicate usages (same file and line)
        const uniqueUsages = usages.filter((v, i, a) => 
          a.findIndex(t => t.file === v.file && t.line === v.line) === i
        );

        return res.json(uniqueUsages);
      }

      // Fallback to empty results if no owner/name (prevents searching app's own disk)
      return res.json([]);
    } catch (err: any) {
      console.error("Search error:", err);
      return res.status(500).json({ error: "Search failed", message: err.message });
    }
  });

  // Vector Search for code snippets
  app.post("/api/search/snippets", async (req: any, res) => {
    let { vector, owner, name, limit = 10 } = req.body;
    if (!vector || !Array.isArray(vector)) {
      return res.status(400).json({ error: "Vector array is required" });
    }
    if (vector.length > 768) {
      vector = vector.slice(0, 768);
    }

    try {
      // Privacy check
      const repo = await RepoModel.findOne({ owner, name });
      if (repo && repo.isPrivate && (!req.user || repo.githubUserId !== req.user.id)) {
        return res.status(403).json({ error: "Access denied to private repository" });
      }

      const results = await SnippetModel.aggregate([
        {
          $vectorSearch: {
            index: "snippet_vector_index",
            path: "embedding",
            queryVector: vector,
            numCandidates: 100,
            limit: limit,
            filter: {
              owner: owner,
              name: name
            }
          }
        },
        {
          $project: {
            path: 1,
            content: 1,
            startLine: 1,
            endLine: 1,
            score: { $meta: "vectorSearchScore" }
          }
        }
      ]);
      return res.json(results);
    } catch (err: any) {
      console.error("Snippet vector search error:", err);
      return res.status(500).json({ error: "Snippet search failed", message: err.message });
    }
  });

  // Index snippets for a repository
  app.post("/api/repo/index-snippets", async (req, res) => {
    const { owner, name, repoId, snippets } = req.body;
    
    if (!owner || !name || !repoId || !snippets || !Array.isArray(snippets)) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      // Clear existing snippets for this repo
      await SnippetModel.deleteMany({ repoId });

      // Insert new snippets in batches
      const batchSize = 50;
      console.log(`Indexing ${snippets.length} snippets in batches of ${batchSize}...`);
      for (let i = 0; i < snippets.length; i += batchSize) {
        const batch = snippets.slice(i, i + batchSize).map((s: any) => {
          let embedding = s.embedding;
          if (Array.isArray(embedding) && embedding.length > 768) {
            embedding = embedding.slice(0, 768);
          }
          return {
            ...s,
            embedding,
            repoId,
            owner,
            name
          };
        });
        console.log(`Inserting batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(snippets.length / batchSize)}...`);
        await SnippetModel.insertMany(batch);
      }

      return res.json({ message: `Successfully indexed ${snippets.length} snippets` });
    } catch (err: any) {
      console.error("Snippet indexing error:", err);
      return res.status(500).json({ error: "Snippet indexing failed", message: err.message });
    }
  });

  // API 404 Handler - MUST be before Vite middleware
  app.all(/^\/api\/.*$/, (req, res) => {
    console.warn(`API route not found: ${req.method} ${req.url}`);
    res.status(404).json({ error: "API route not found" });
  });

  // Vite middleware for development
  console.log("Checking NODE_ENV for Vite middleware...");
  if (process.env.NODE_ENV === "production") {
    console.log("Serving static files from dist...");
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    console.log("Initializing Vite middleware...");
    try {
      console.log("Creating Vite server...");
      const vite = await createViteServer({
        server: { 
          middlewareMode: true,
          hmr: false,
        },
        appType: "spa",
        root: process.cwd(),
      });
      console.log("Vite server created, attaching middleware...");
      app.use(vite.middlewares);
      console.log("Vite middleware initialized successfully");
    } catch (viteError) {
      console.error("Vite initialization failed:", viteError);
    }
  }

  console.log(`Starting Express server on port ${PORT}...`);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is listening on http://0.0.0.0:${PORT}`);
    console.log("Health check available at /api/health");
    console.log("SERVER READY");
  });
}

startServer();
