import express from "express";
import { createServer as createViteServer } from "vite";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import { RepoModel } from "./models/Repo.js";
import { SnippetModel } from "./models/Snippet.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

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
  // Using the exact URI that worked in the user's test script
  const fallbackUri = `mongodb+srv://admin:%23mpAD$82OOq8@gitlens.di1vxwl.mongodb.net/gitlens?retryWrites=true&w=majority`;
  const MONGODB_URI = process.env.MONGODB_URI || fallbackUri;
  
  const maskedUri = MONGODB_URI.replace(/:([^@]+)@/, ":****@");
  console.log(`Attempting to connect to MongoDB...`);
  console.log(`Source: ${process.env.MONGODB_URI ? 'Environment Variable (MONGODB_URI)' : 'Fallback String'}`);
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

  mongoose.set('debug', true);

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

  // API Routes
  console.log("Registering API routes...");
  
  // Get all indexed repositories
  app.get("/api/repos", async (req, res) => {
    console.log("GET /api/repos hit");
    try {
      if (mongoose.connection.readyState !== 1) {
        console.warn("Database not connected, state:", mongoose.connection.readyState);
        return res.status(503).json({ error: "Database not connected", state: mongoose.connection.readyState });
      }
      const repos = await RepoModel.find({}, { owner: 1, name: 1, branch: 1, lastIndexed: 1, stats: 1, overview: 1 }).sort({ lastIndexed: -1 });
      console.log(`Found ${repos.length} repos`);
      return res.json(repos);
    } catch (err: any) {
      console.error("Fetch repos error:", err);
      return res.status(500).json({ error: "Database error", message: err.message });
    }
  });

  // Vector Search for repositories
  app.post("/api/repos/search", async (req, res) => {
    const { vector, limit = 5 } = req.body;
    if (!vector || !Array.isArray(vector)) {
      return res.status(400).json({ error: "Vector array is required" });
    }

    try {
      const results = await RepoModel.aggregate([
        {
          $vectorSearch: {
            index: "vector_index",
            path: "embedding",
            queryVector: vector,
            numCandidates: 100,
            limit: limit
          }
        },
        {
          $project: {
            owner: 1,
            name: 1,
            branch: 1,
            overview: 1,
            stats: 1,
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
  app.get("/api/repo", async (req, res) => {
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
        return res.json(repo);
      }
      return res.status(404).json({ message: "Not found" });
    } catch (err: any) {
      console.error("Fetch repo error:", err);
      return res.status(500).json({ error: "Database error", message: err.message });
    }
  });

  // Save/Update repository
  app.post("/api/repo", async (req, res) => {
    const { owner, name, branch, files, overview, stats, highlights, embedding } = req.body;
    console.log(`POST /api/repo hit for ${owner}/${name}`);
    
    try {
      const updatedRepo = await RepoModel.findOneAndUpdate(
        { owner, name, branch },
        { 
          files, 
          overview, 
          stats, 
          highlights, 
          embedding,
          lastIndexed: new Date() 
        },
        { upsert: true, new: true }
      );
      return res.json(updatedRepo);
    } catch (err) {
      console.error("Save error:", err);
      return res.status(500).json({ error: "Failed to save repository" });
    }
  });

  // Delete/Clear cache
  app.delete("/api/repo", async (req, res) => {
    const { owner, name, branch } = req.query;
    console.log(`DELETE /api/repo hit for ${owner}/${name} (branch: ${branch})`);
    
    if (!owner || !name) {
      return res.status(400).json({ error: "Owner and name are required" });
    }

    try {
      // If branch is provided, use it. Otherwise, try to delete by owner/name (might delete multiple if branch is not unique, but our index is compound)
      const query: any = { owner, name };
      if (branch && branch !== 'undefined') {
        query.branch = branch;
      }
      
      const result = await RepoModel.deleteOne(query);
      if (result.deletedCount === 0) {
        console.warn(`No repository found to delete for ${owner}/${name} (query: ${JSON.stringify(query)})`);
        return res.status(404).json({ error: "Repository not found in index" });
      }
      console.log(`Successfully deleted ${owner}/${name} from index`);
      return res.json({ message: "Repository removed from index" });
    } catch (err: any) {
      console.error("Delete error:", err);
      return res.status(500).json({ error: "Failed to remove repository", message: err.message });
    }
  });

  // Search for symbol usages across the codebase
  app.get("/api/search/usages", async (req, res) => {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: "Symbol is required" });

    try {
      // Use grep to find usages. -r (recursive), -n (line number), -I (ignore binary), -w (whole word)
      // We exclude node_modules, .git, and other common build/dependency folders
      // Also exclude .map files which can be massive
      const command = `grep -rInw "${symbol}" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.next --exclude="*.map"`;
      
      // Increase maxBuffer to 10MB to handle large codebases
      const { stdout } = await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });
      
      const lines = stdout.split('\n').filter(line => line.trim() !== '');
      const usages = lines.map(line => {
        const [file, lineNumber, ...contextParts] = line.split(':');
        return {
          file: file.replace(/^\.\//, ''),
          line: parseInt(lineNumber),
          context: contextParts.join(':').trim()
        };
      });

      return res.json(usages);
    } catch (err: any) {
      // grep returns exit code 1 if no matches found, which exec treats as an error
      if (err.code === 1) {
        return res.json([]);
      }
      console.error("Search error:", err);
      return res.status(500).json({ error: "Search failed", message: err.message });
    }
  });

  // Vector Search for code snippets
  app.post("/api/search/snippets", async (req, res) => {
    const { vector, owner, name, limit = 10 } = req.body;
    if (!vector || !Array.isArray(vector)) {
      return res.status(400).json({ error: "Vector array is required" });
    }

    try {
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
      for (let i = 0; i < snippets.length; i += batchSize) {
        const batch = snippets.slice(i, i + batchSize).map((s: any) => ({
          ...s,
          repoId,
          owner,
          name
        }));
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
  if (process.env.NODE_ENV !== "production") {
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
  } else {
    console.log("Serving static files from dist...");
    app.use(express.static("dist"));
  }

  console.log(`Starting Express server on port ${PORT}...`);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is listening on http://0.0.0.0:${PORT}`);
    console.log("Health check available at /api/health");
    console.log("SERVER READY");
  });
}

startServer();
