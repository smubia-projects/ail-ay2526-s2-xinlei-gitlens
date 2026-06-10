import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import axios from "axios";
import { GoogleGenAI } from "@google/genai";

import * as db from "./lib/db.js";
import { createRateLimiter } from "./rateLimitEngine.js";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const JWT_SECRET = process.env.SESSION_SECRET;
if (!JWT_SECRET) {
  if (IS_PRODUCTION) {
    console.error("CRITICAL: SESSION_SECRET environment variable is not set!");
    process.exit(1);
  }
  console.warn("SESSION_SECRET not set — using an insecure dev-only secret.");
}
const ACTIVE_JWT_SECRET = JWT_SECRET || "gitlens-dev-secret";

console.log("SERVER STARTING...");
console.log("NODE_ENV:", process.env.NODE_ENV);

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

if (!process.env.DATABASE_URL) {
  console.error("CRITICAL: DATABASE_URL environment variable is not set!");
}

const app = express();
app.set("trust proxy", 1); // Behind Cloud Run's proxy
const PORT = parseInt(process.env.PORT || "3000", 10);

// CORS — origins come from the environment; no hardcoded production URLs.
const corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(cors(corsOrigins.length > 0 ? { origin: corsOrigins } : {}));

app.use(express.json({ limit: "50mb" }));

// Rate limiting (shared engine) — LLM routes only.
const limiter = createRateLimiter({
  project: "ail-ay2526-s2-xinlei-gitlens",
  buckets: {
    chat: Number(process.env.RATE_LIMIT_CHAT_MAX || 5),
    embed: Number(process.env.RATE_LIMIT_EMBED_MAX || 300),
  },
  redisUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_URL,
  redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_TOKEN,
  defaultWindow: Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 432000),
});

// Middleware to extract user from JWT token
app.use((req: any, res, next) => {
  const authHeader = req.headers.authorization;
  req.guestId = req.headers["x-guest-id"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, ACTIVE_JWT_SECRET) as any;
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

// ---------------------------------------------------------------------------
// User helpers (Postgres)
// ---------------------------------------------------------------------------

async function findUserByGithubId(githubId: number): Promise<any | null> {
  const res = await db.query(`SELECT * FROM users WHERE github_id = $1`, [githubId]);
  return res.rows[0] || null;
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

let lastDbError: string | null = null;

app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    lastDbError = null;
    const ext = await db.query(`SELECT 1 FROM pg_extension WHERE extname = 'vector'`);
    const indexTest =
      ext.rows.length > 0
        ? "Success (pgvector enabled)"
        : "Warning (pgvector extension NOT enabled)";
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      dbState: 1,
      dbStateName: "connected",
      lastError: lastDbError,
      indexTest,
      database: { status: "connected" },
      environment: process.env.NODE_ENV || "development",
    });
  } catch (err: any) {
    lastDbError = err.message;
    res.status(503).json({
      status: "error",
      message: "Health check failed",
      dbState: 0,
      dbStateName: "disconnected",
      lastError: lastDbError,
      error: err.message,
    });
  }
});

// Helper to mask API key
const maskApiKey = (key?: string) => {
  if (!key) return "";
  if (key.length <= 8) return "********";
  return key.substring(0, 4) + "********" + key.substring(key.length - 4);
};

// ---------------------------------------------------------------------------
// AI proxy
// ---------------------------------------------------------------------------

// Shared OpenAI-compatible chat call (used for user-supplied OpenAI configs and
// for the server-side OpenRouter fallback).
async function chatCompletions(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt?: string;
  contents?: any;
  requestConfig?: any;
  extraHeaders?: Record<string, string>;
}): Promise<string> {
  const { baseUrl, apiKey, model, prompt, contents, requestConfig, extraHeaders } = opts;

  const messages = Array.isArray(contents)
    ? contents.map((c: any) => ({
        role: c.role === "model" ? "assistant" : c.role || "user",
        content: c.parts ? c.parts.map((p: any) => p.text).join("\n") : c.text || JSON.stringify(c),
      }))
    : [{ role: "user", content: prompt || contents }];

  let sysContent =
    typeof requestConfig?.systemInstruction === "string"
      ? requestConfig.systemInstruction
      : requestConfig?.systemInstruction?.parts
        ? requestConfig.systemInstruction.parts.map((p: any) => p.text).join("\n")
        : requestConfig?.systemInstruction
          ? JSON.stringify(requestConfig.systemInstruction)
          : undefined;

  if (requestConfig?.responseMimeType === "application/json") {
    if (!sysContent) sysContent = "";
    if (!sysContent.toLowerCase().includes("json")) {
      sysContent += "\n\nIMPORTANT: You must return the response in valid JSON format.";
    }
    if (requestConfig?.responseSchema) {
      sysContent += `\n\nYour JSON response MUST strictly adhere to the following JSON Schema:\n${JSON.stringify(requestConfig.responseSchema, null, 2)}`;
    }
  }

  if (sysContent) {
    messages.unshift({ role: "system", content: sysContent });
  }

  const body: any = { model, messages };
  if (requestConfig?.responseMimeType === "application/json") {
    body.response_format = { type: "json_object" };
  }
  if (requestConfig?.temperature !== undefined) body.temperature = requestConfig.temperature;
  if (requestConfig?.maxOutputTokens !== undefined) body.max_tokens = requestConfig.maxOutputTokens;

  const response = await axios.post(`${baseUrl.replace(/\/$/, "")}/chat/completions`, body, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(extraHeaders || {}),
    },
  });

  return response.data.choices[0].message.content;
}

// AI Proxy Route
app.post("/api/ai/proxy", limiter("chat"), async (req: any, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { prompt, model, config: requestConfig, contents } = req.body;
    const user = await findUserByGithubId(req.user.id);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const aiConfig = (user.ai_config || {}) as any;
    const userApiKey = aiConfig.apiKey;

    if (userApiKey) {
      // User brings their own key — honor their provider choice.
      const provider = aiConfig.provider || "gemini";

      if (provider === "gemini") {
        const ai = new GoogleGenAI({ apiKey: userApiKey });
        const defaultFlash = "gemini-3-flash-preview";
        const defaultPro = "gemini-3.1-pro-preview";
        const modelName =
          model ||
          (aiConfig.useFlash
            ? aiConfig.flashModel || defaultFlash
            : aiConfig.proModel || defaultPro);

        let result;
        if (contents) {
          result = await ai.models.generateContent({ model: modelName, contents });
        } else {
          result = await ai.models.generateContent({
            model: modelName,
            contents: [{ parts: [{ text: prompt }] }],
          });
        }

        return res.json({ text: result.text });
      }

      if (provider === "openai") {
        const text = await chatCompletions({
          baseUrl: aiConfig.baseUrl || "https://api.openai.com/v1",
          apiKey: userApiKey,
          model:
            model ||
            (aiConfig.useFlash
              ? aiConfig.flashModel || "gpt-4o-mini"
              : aiConfig.proModel || "gpt-4o"),
          prompt,
          contents,
          requestConfig,
        });
        return res.json({ text });
      }

      return res.status(400).json({ error: "Unsupported AI provider" });
    }

    // Server-side fallback: all chat inference goes through OpenRouter.
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterKey) {
      return res.status(400).json({ error: "AI API Key not configured" });
    }

    const flashModel = process.env.OPENROUTER_FLASH_MODEL || "google/gemini-2.5-flash";
    const proModel = process.env.OPENROUTER_PRO_MODEL || "google/gemini-2.5-pro";
    const text = await chatCompletions({
      baseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      apiKey: openRouterKey,
      model: model || (aiConfig.useFlash === false ? proModel : flashModel),
      prompt,
      contents,
      requestConfig,
    });
    return res.json({ text });
  } catch (error: any) {
    console.error("AI Proxy Error:", error.response?.data || error.message);
    res.status(500).json({ error: error.message, details: error.response?.data });
  }
});

// AI Embedding Proxy
// Embeddings stay on Gemini direct (OpenRouter does not serve embeddings).
// All embeddings are forced to 768 dimensions to match the vector(768) columns.
const EMBEDDING_DIMENSIONS = 768;

app.post("/api/ai/embed", limiter("embed"), async (req: any, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { text, model } = req.body;
    const user = await findUserByGithubId(req.user.id);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const aiConfig = (user.ai_config || {}) as any;
    const provider = aiConfig.apiKey ? aiConfig.provider || "gemini" : "gemini";
    const apiKey = aiConfig.apiKey || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(400).json({ error: "AI API Key not configured" });
    }

    if (provider === "gemini") {
      const ai = new GoogleGenAI({ apiKey });
      const modelName = model || aiConfig.embeddingModel || "gemini-embedding-2-preview";
      const result = await ai.models.embedContent({
        model: modelName,
        contents: [text],
        config: { outputDimensionality: EMBEDDING_DIMENSIONS },
      });
      res.json({ embedding: result.embeddings[0].values });
    } else if (provider === "openai") {
      const baseUrl = aiConfig.baseUrl || "https://api.openai.com/v1";
      const embedModel = model || aiConfig.embeddingModel || "text-embedding-3-small";

      const payload: any = {
        model: embedModel,
        input: text,
      };

      if (embedModel.includes("text-embedding-3")) {
        payload.dimensions = EMBEDDING_DIMENSIONS;
      }

      const response = await axios.post(`${baseUrl}/embeddings`, payload, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });

      res.json({ embedding: response.data.data[0].embedding });
    } else {
      res.status(400).json({ error: "Unsupported AI provider" });
    }
  } catch (error: any) {
    console.error("AI Embedding Error:", error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// User config routes
// ---------------------------------------------------------------------------

app.get("/api/user/config", async (req: any, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const user = await findUserByGithubId(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const config = { ...(user.ai_config || {}) };
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
    const user = await findUserByGithubId(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const newConfig = { ...req.body };

    // If the key is masked, don't update it
    if (newConfig.apiKey && newConfig.apiKey.includes("********")) {
      delete newConfig.apiKey;
    }

    const merged = { ...(user.ai_config || {}), ...newConfig };
    await db.query(`UPDATE users SET ai_config = $1, updated_at = now() WHERE github_id = $2`, [
      JSON.stringify(merged),
      req.user.id,
    ]);

    const config = { ...merged };
    if (config.apiKey) {
      config.apiKey = maskApiKey(config.apiKey);
    }

    res.json(config);
  } catch (err) {
    console.error("Failed to save user config:", err);
    res.status(500).json({ error: "Failed to save user config" });
  }
});

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------

app.get("/api/auth/github/url", (req, res) => {
  const client_id = process.env.GITHUB_CLIENT_ID;
  const app_name = process.env.GITHUB_APP_NAME || "gitlens-cursor"; // Fallback to a default or placeholder

  if (!client_id) {
    return res.status(500).json({ error: "GITHUB_CLIENT_ID not configured" });
  }

  const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
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

  const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
  const redirect_uri = `${baseUrl}/api/auth/github/callback`;

  try {
    const response = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri,
      },
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "GitLens-App",
        },
      }
    );

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
        Authorization: `Bearer ${access_token}`,
        "User-Agent": "GitLens-App",
      },
    });

    console.log(`Authenticated as GitHub user: ${userRes.data.login}`);

    const userData = {
      login: userRes.data.login,
      id: userRes.data.id,
      avatar_url: userRes.data.avatar_url,
    };

    // Find or create user
    const existing = await findUserByGithubId(userData.id);
    if (!existing) {
      await db.query(
        `INSERT INTO users (github_id, login, avatar_url) VALUES ($1, $2, $3)`,
        [userData.id, userData.login, userData.avatar_url]
      );
      console.log(`New user created: ${userData.login}`);
    } else {
      await db.query(
        `UPDATE users SET login = $1, avatar_url = $2, updated_at = now() WHERE github_id = $3`,
        [userData.login, userData.avatar_url, userData.id]
      );
      console.log(`Existing user logged in: ${userData.login}`);
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        user: userData,
        githubToken: access_token,
      },
      ACTIVE_JWT_SECRET,
      { expiresIn: "24h" }
    );

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

app.get("/api/auth/me", async (req: any, res) => {
  console.log("Auth check request received.");

  if (req.user && req.githubToken) {
    try {
      // Verify the token is still valid with GitHub
      await axios.get("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${req.githubToken}`,
          "User-Agent": "GitLens-App",
        },
      });

      console.log(`Auth check: User ${req.user.login} is logged in and token is valid.`);
      res.json({
        user: req.user,
        token: req.githubToken,
      });
    } catch (err: any) {
      if (err.response && err.response.status === 401) {
        console.log("Auth check: GitHub token is expired or invalid.");
        res.status(401).json({ error: "GitHub token expired" });
      } else {
        console.error("Auth check: Error verifying token with GitHub:", err.message);
        // Other errors (e.g., rate limit), assume token is still good
        res.json({
          user: req.user,
          token: req.githubToken,
        });
      }
    }
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
        Authorization: `Bearer ${req.githubToken}`,
        "User-Agent": "GitLens-App",
        Accept: "application/vnd.github.v3+json",
      },
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
    console.log(
      `Fetching all repos for user with token starting with: ${req.githubToken?.substring(0, 10)}...`
    );

    let allRepos: any[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 10) {
      // Limit to 10 pages (1000 repos) to avoid timeouts
      console.log(`Fetching page ${page}...`);
      const response = await axios.get("https://api.github.com/user/repos", {
        headers: {
          Authorization: `Bearer ${req.githubToken}`,
          "User-Agent": "GitLens-App",
        },
        params: {
          sort: "updated",
          per_page: 100,
          page: page,
          type: "all",
        },
      });

      // Log scopes for debugging
      if (page === 1) {
        console.log(`GitHub API Scopes: ${response.headers["x-oauth-scopes"]}`);
        console.log(`GitHub API Accepted Scopes: ${response.headers["x-accepted-oauth-scopes"]}`);
      }

      const repos = response.data;
      if (repos.length > 0) {
        allRepos = [...allRepos, ...repos];

        const privateCount = repos.filter((r: any) => r.private).length;
        const publicCount = repos.filter((r: any) => !r.private).length;
        console.log(
          `Page ${page}: Found ${repos.length} repos (${publicCount} public, ${privateCount} private)`
        );

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
    const errorMessage =
      typeof errorData === "object" ? JSON.stringify(errorData) : errorData || err.message;
    console.error("Failed to fetch user repos:", errorMessage);
    res.status(err.response?.status || 500).json({
      error: "Failed to fetch repositories from GitHub",
      details: err.response?.data?.message || err.message,
    });
  }
});

// ---------------------------------------------------------------------------
// Repository routes
// ---------------------------------------------------------------------------

console.log("Registering API routes...");

// Privacy/library filter shared by /api/repos and /api/repos/search:
// 1. Logged in: repos you've indexed (indexed_by contains your ID) OR repos you own
// 2. Anonymous: repos you've indexed (indexed_by contains your guest id)
// 3. No identity: public unowned repos only
function repoVisibilityFilter(req: any, params: any[]): string {
  if (req.user) {
    params.push(String(req.user.id), req.user.id);
    return `($${params.length - 1} = ANY(indexed_by) OR github_user_id = $${params.length})`;
  }
  if (req.guestId) {
    params.push(req.guestId);
    return `$${params.length} = ANY(indexed_by)`;
  }
  return `(github_user_id IS NULL AND is_private = false)`;
}

// Get all indexed repositories
app.get("/api/repos", async (req: any, res) => {
  console.log("GET /api/repos hit");
  try {
    await db.deleteExpiredRepos().catch(() => []);

    const params: any[] = [];
    const where = repoVisibilityFilter(req, params);
    const result = await db.query(
      `SELECT id, owner, name, branch, last_indexed, stats, overview,
              github_user_id, is_private, is_temporary, expires_at, indexed_by
       FROM repos WHERE ${where} ORDER BY last_indexed DESC`,
      params
    );
    const repos = result.rows.map(db.repoToJson);
    console.log(`Found ${repos.length} repos for user ${req.user?.login || "anonymous"}.`);
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
    // pgvector: similarity + visibility filter in one statement.
    const params: any[] = [];
    const where = repoVisibilityFilter(req, params);
    params.push(db.toVectorLiteral(vector));
    const vecParam = `$${params.length}::vector`;
    params.push(limit);
    const result = await db.query(
      `SELECT id, owner, name, branch, overview, stats, is_private, github_user_id, indexed_by,
              1 - (embedding <=> ${vecParam}) AS score
       FROM repos
       WHERE ${where} AND embedding IS NOT NULL
       ORDER BY embedding <=> ${vecParam}
       LIMIT $${params.length}`,
      params
    );

    return res.json(result.rows.map(db.repoToJson));
  } catch (err: any) {
    console.error("Vector search error:", err);
    return res.status(500).json({ error: "Vector search failed", message: err.message });
  }
});

// Get cached repository
app.get("/api/repo", async (req: any, res) => {
  const { owner, name, branch = "main" } = req.query;
  console.log(`GET /api/repo hit for ${owner}/${name}`);
  if (!owner || !name) {
    return res.status(400).json({ error: "Owner and name are required" });
  }

  try {
    await db.deleteExpiredRepos().catch(() => []);

    const result = await db.query(
      `SELECT * FROM repos WHERE owner = $1 AND name = $2 AND branch = $3`,
      [owner, name, branch]
    );
    const repo = result.rows[0];
    if (repo) {
      // Privacy check
      if (repo.is_private && (!req.user || Number(repo.github_user_id) !== req.user.id)) {
        return res.status(403).json({ error: "Access denied to private repository" });
      }

      // Add to user's personal library if not already there
      const currentUserId = req.user ? String(req.user.id) : req.guestId;
      if (currentUserId && !(repo.indexed_by || []).includes(currentUserId)) {
        await db.query(
          `UPDATE repos SET indexed_by = array_append(indexed_by, $1) WHERE id = $2`,
          [currentUserId, repo.id]
        );
      }

      const filesRes = await db.query(
        `SELECT path, type, sha, url, content FROM files WHERE repo_id = $1`,
        [repo.id]
      );

      const repoObj = db.repoToJson(repo);
      repoObj.files = filesRes.rows;

      return res.json(repoObj);
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
    const existingRes = await db.query(
      `SELECT * FROM repos WHERE owner = $1 AND name = $2 AND branch = $3`,
      [owner, name, branch]
    );
    const existingRepo = existingRes.rows[0];
    if (existingRepo && existingRepo.is_private) {
      if (!req.user || Number(existingRepo.github_user_id) !== req.user.id) {
        return res.status(403).json({ error: "Cannot update a private repository you do not own" });
      }
    }

    const indexerId = req.user ? String(req.user.id) : req.guestId || null;

    let isPrivate: boolean | null = null;
    let githubUserId: number | null = null;
    let isTemporary: boolean | null = null;
    let clearExpiry = false;
    let expiresAt: Date | null = null;

    if (req.user && req.githubToken) {
      // Authenticated user: Check permissions on GitHub
      try {
        console.log(`Verifying permissions for ${req.user.login} on ${owner}/${name}...`);
        const ghRes = await axios.get(`https://api.github.com/repos/${owner}/${name}`, {
          headers: { Authorization: `Bearer ${req.githubToken}` },
        });

        const permissions = ghRes.data.permissions;
        const hasWriteAccess = permissions && (permissions.push || permissions.admin);

        isPrivate = ghRes.data.private || false;

        if (hasWriteAccess) {
          console.log(`User ${req.user.login} HAS write access. Assigning ownership.`);
          githubUserId = req.user.id;
        } else {
          console.log(
            `User ${req.user.login} does NOT have write access. Making permanent but unowned.`
          );
        }
      } catch (ghErr: any) {
        console.error("GitHub permission check failed:", ghErr.message);
      }

      isTemporary = false;
      clearExpiry = true;
    } else {
      // Unauthenticated user: repo is temporary, expires in 24h
      try {
        const ghRes = await axios.get(`https://api.github.com/repos/${owner}/${name}`);
        isPrivate = ghRes.data.private || false;
      } catch (e) {
        // If it fails, it might be private or rate limited.
      }

      if (!existingRepo || !existingRepo.github_user_id) {
        isTemporary = true;
        expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      }
    }

    const upsertRes = await db.query(
      `INSERT INTO repos (owner, name, branch, overview, stats, highlights, last_indexed,
                          github_user_id, is_private, is_temporary, indexed_by, expires_at, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, now(),
               $7, COALESCE($8, false), COALESCE($9, false),
               CASE WHEN $10::text IS NULL THEN '{}'::text[] ELSE ARRAY[$10::text] END, $11, $13::vector)
       ON CONFLICT (owner, name, branch) DO UPDATE SET
         overview = EXCLUDED.overview,
         stats = EXCLUDED.stats,
         highlights = EXCLUDED.highlights,
         last_indexed = now(),
         github_user_id = COALESCE($7, repos.github_user_id),
         is_private = COALESCE($8, repos.is_private),
         is_temporary = COALESCE($9, repos.is_temporary),
         indexed_by = CASE
           WHEN $10::text IS NULL OR $10 = ANY(repos.indexed_by) THEN repos.indexed_by
           ELSE array_append(repos.indexed_by, $10::text)
         END,
         expires_at = CASE WHEN $12 THEN NULL ELSE COALESCE($11, repos.expires_at) END,
         embedding = COALESCE($13::vector, repos.embedding)
       RETURNING *`,
      [
        owner,
        name,
        branch,
        JSON.stringify(overview ?? null),
        JSON.stringify(stats ?? null),
        JSON.stringify(highlights ?? []),
        githubUserId,
        isPrivate,
        isTemporary,
        indexerId,
        expiresAt,
        clearExpiry,
        db.toVectorLiteral(embedding),
      ]
    );
    const updatedRepo = upsertRes.rows[0];

    if (updatedRepo && files && Array.isArray(files)) {
      // Remove files that are no longer in the repo
      const currentPaths = files.map((f: any) => f.path);
      await db.query(`DELETE FROM files WHERE repo_id = $1 AND NOT (path = ANY($2))`, [
        updatedRepo.id,
        currentPaths,
      ]);

      // Upsert in batches via UNNEST to stay well under parameter limits
      const BATCH_SIZE = 500;
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        await db.query(
          `INSERT INTO files (repo_id, path, type, sha, url, content)
           SELECT $1::int, * FROM UNNEST($2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
           ON CONFLICT (repo_id, path) DO UPDATE SET
             type = EXCLUDED.type, sha = EXCLUDED.sha, url = EXCLUDED.url, content = EXCLUDED.content`,
          [
            updatedRepo.id,
            batch.map((f: any) => f.path),
            batch.map((f: any) => f.type ?? null),
            batch.map((f: any) => f.sha ?? null),
            batch.map((f: any) => f.url ?? null),
            batch.map((f: any) => f.content ?? null),
          ]
        );
      }
    }

    return res.json(db.repoToJson(updatedRepo));
  } catch (err) {
    console.error("Save error:", err);
    return res.status(500).json({ error: "Failed to save repository" });
  }
});

// Remove repository from index/library
app.delete("/api/repo", async (req: any, res) => {
  const { owner, name, branch = "main" } = req.query;
  const currentUserId = req.user ? String(req.user.id) : req.guestId;

  console.log(`DELETE /api/repo hit for ${owner}/${name} (branch: ${branch}) by ${currentUserId}`);

  if (!owner || !name) {
    return res.status(400).json({ error: "Owner and name are required" });
  }

  if (!currentUserId) {
    return res.status(401).json({ error: "Authentication or Guest ID required" });
  }

  try {
    const result = await db.query(
      `SELECT * FROM repos WHERE owner = $1 AND name = $2 AND branch = $3`,
      [owner, name, branch]
    );
    const repo = result.rows[0];

    if (!repo) {
      return res.status(404).json({ error: "Repository not found in index" });
    }

    // Privacy check: If it's private, only the owner can delete it
    if (repo.is_private && (!req.user || Number(repo.github_user_id) !== req.user.id)) {
      return res.status(403).json({ error: "Access denied to private repository" });
    }

    // If the user is the owner, they can delete the whole thing for everyone
    const isOwner = req.user && Number(repo.github_user_id) === req.user.id;

    if (isOwner) {
      console.log(`Owner ${req.user.login} deleting repository ${owner}/${name} entirely.`);
      // files/snippets (and their embeddings) cascade with the row
      await db.query(`DELETE FROM repos WHERE id = $1`, [repo.id]);
      return res.json({ message: "Repository and its index deleted successfully" });
    }

    // Otherwise, just remove the current user/guest from indexed_by
    console.log(`Removing user ${currentUserId} from indexedBy for ${owner}/${name}.`);
    const updated = await db.query(
      `UPDATE repos SET indexed_by = array_remove(indexed_by, $1) WHERE id = $2
       RETURNING indexed_by, github_user_id`,
      [currentUserId, repo.id]
    );

    // Check if it's now orphaned (no indexedBy and no owner)
    const row = updated.rows[0];
    if (row && (row.indexed_by || []).length === 0 && row.github_user_id == null) {
      console.log(`Repository ${owner}/${name} is now orphaned. Deleting index.`);
      await db.query(`DELETE FROM repos WHERE id = $1`, [repo.id]);
    }

    return res.json({ message: "Repository removed from your library" });
  } catch (err: any) {
    console.error("Delete error:", err);
    return res.status(500).json({ error: "Failed to remove repository", message: err.message });
  }
});

// ---------------------------------------------------------------------------
// Search routes
// ---------------------------------------------------------------------------

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Search for symbol usages across the codebase
app.get("/api/search/usages", async (req: any, res) => {
  const { symbol, owner, name } = req.query;
  if (!symbol) return res.status(400).json({ error: "Symbol is required" });

  try {
    if (owner && name) {
      // Privacy check
      const repoRes = await db.query(`SELECT * FROM repos WHERE owner = $1 AND name = $2`, [
        owner,
        name,
      ]);
      const repo = repoRes.rows[0];
      if (repo && repo.is_private && (!req.user || Number(repo.github_user_id) !== req.user.id)) {
        return res.status(403).json({ error: "Access denied to private repository" });
      }

      console.log(`Searching for usages of "${symbol}" in ${owner}/${name}`);

      // Whole-word match: \m / \M are Postgres regex word boundaries
      const pgRegex = `\\m${escapeRegex(String(symbol))}\\M`;
      const snippetsRes = await db.query(
        `SELECT path, content, start_line FROM snippets
         WHERE owner = $1 AND name = $2 AND content ~ $3 LIMIT 100`,
        [owner, name, pgRegex]
      );

      const jsRegex = new RegExp(`\\b${escapeRegex(String(symbol))}\\b`);
      const usages: any[] = [];
      snippetsRes.rows.forEach((s: any) => {
        const lines = s.content.split("\n");
        lines.forEach((line: string, index: number) => {
          if (jsRegex.test(line)) {
            usages.push({
              file: s.path,
              line: s.start_line + index,
              context: line.trim(),
            });
          }
        });
      });

      // De-duplicate usages (same file and line)
      const uniqueUsages = usages.filter(
        (v, i, a) => a.findIndex((t) => t.file === v.file && t.line === v.line) === i
      );

      return res.json(uniqueUsages);
    }

    // Fallback to empty results if no owner/name
    return res.json([]);
  } catch (err: any) {
    console.error("Search error:", err);
    return res.status(500).json({ error: "Search failed", message: err.message });
  }
});

// Vector Search for code snippets
app.post("/api/search/snippets", async (req: any, res) => {
  const { vector, owner, name, limit = 10 } = req.body;
  if (!vector || !Array.isArray(vector)) {
    return res.status(400).json({ error: "Vector array is required" });
  }

  try {
    // Privacy check + resolve repo id
    const repoRes = await db.query(`SELECT * FROM repos WHERE owner = $1 AND name = $2`, [
      owner,
      name,
    ]);
    const repo = repoRes.rows[0];
    if (!repo) return res.json([]);
    if (repo.is_private && (!req.user || Number(repo.github_user_id) !== req.user.id)) {
      return res.status(403).json({ error: "Access denied to private repository" });
    }

    const result = await db.query(
      `SELECT id, path, content, purpose, start_line, end_line,
              1 - (embedding <=> $2::vector) AS score
       FROM snippets
       WHERE repo_id = $1 AND embedding IS NOT NULL
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      [repo.id, db.toVectorLiteral(vector), limit]
    );

    return res.json(result.rows.map(db.snippetToJson));
  } catch (err: any) {
    console.error("Snippet vector search error:", err);
    return res.status(500).json({ error: "Snippet search failed", message: err.message });
  }
});

// Keyword search for snippets
app.post("/api/search/keywords", async (req, res) => {
  const { query, owner, name, limit = 5 } = req.body;

  if (!query || !owner || !name) {
    return res.status(400).json({ error: "Query, owner, and name are required" });
  }

  try {
    // Privacy check
    const repoRes = await db.query(`SELECT * FROM repos WHERE owner = $1 AND name = $2`, [
      owner,
      name,
    ]);
    const repo = repoRes.rows[0];
    if (
      repo &&
      repo.is_private &&
      (!(req as any).user || Number(repo.github_user_id) !== (req as any).user.id)
    ) {
      return res.status(403).json({ error: "Access denied to private repository" });
    }

    const pattern = `%${String(query).replace(/[%_\\]/g, "\\$&")}%`;
    const result = await db.query(
      `SELECT id, path, content, purpose, start_line, end_line FROM snippets
       WHERE owner = $1 AND name = $2
         AND (content ILIKE $3 OR purpose ILIKE $3 OR path ILIKE $3)
       LIMIT $4`,
      [owner, name, pattern, limit]
    );

    return res.json(result.rows.map(db.snippetToJson));
  } catch (err: any) {
    console.error("Keyword search error:", err);
    return res.status(500).json({ error: "Keyword search failed", message: err.message });
  }
});

// Index snippets for a repository
app.post("/api/repo/index-snippets", async (req, res) => {
  const { owner, name, repoId, snippets, incremental, deletedFiles } = req.body;

  if (!owner || !name || !repoId || !snippets || !Array.isArray(snippets)) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const repoIdNum = Number(repoId);
  if (!Number.isFinite(repoIdNum)) {
    return res.status(400).json({ error: "Invalid repoId" });
  }

  try {
    if (incremental) {
      // Only delete snippets for files that were modified or deleted
      const updatedPaths = [...new Set(snippets.map((s: any) => s.path))];
      const pathsToRemove = [...updatedPaths, ...(deletedFiles || [])];

      if (pathsToRemove.length > 0) {
        await db.query(`DELETE FROM snippets WHERE repo_id = $1 AND path = ANY($2)`, [
          repoIdNum,
          pathsToRemove,
        ]);
      }
    } else {
      // Full reindex
      await db.query(`DELETE FROM snippets WHERE repo_id = $1`, [repoIdNum]);
    }

    // Insert rows (embeddings included) in batches
    const batchSize = 50;
    console.log(`Indexing ${snippets.length} snippets in batches of ${batchSize}...`);
    for (let i = 0; i < snippets.length; i += batchSize) {
      const batch = snippets.slice(i, i + batchSize);
      await db.query(
        `INSERT INTO snippets (repo_id, owner, name, path, content, purpose, start_line, end_line, embedding)
         SELECT $1::int, $2::text, $3::text, * FROM UNNEST($4::text[], $5::text[], $6::text[], $7::int[], $8::int[], $9::vector[])`,
        [
          repoIdNum,
          owner,
          name,
          batch.map((s: any) => s.path),
          batch.map((s: any) => s.content),
          batch.map((s: any) => s.purpose ?? null),
          batch.map((s: any) => s.startLine),
          batch.map((s: any) => s.endLine),
          batch.map((s: any) => db.toVectorLiteral(s.embedding)),
        ]
      );
      console.log(`Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(snippets.length / batchSize)}`);
    }

    return res.json({ message: `Successfully indexed ${snippets.length} snippets` });
  } catch (err: any) {
    console.error("Snippet indexing error:", err);
    return res.status(500).json({ error: "Snippet indexing failed", message: err.message });
  }
});

// Root banner — this service is API-only; the UI lives on Vercel.
app.get("/", (req, res) => {
  res.json({ service: "ail-ay2526-s2-xinlei-gitlens", status: "api-only" });
});

// API 404 Handler
app.all(/^\/api(\/.*)?$/, (req, res) => {
  console.warn(`API route not found: ${req.method} ${req.url}`);
  res.status(404).json({ error: "API route not found", path: req.url });
});

async function startServer() {
  // Dev only: Vite middleware so `npm run dev` serves the SPA from one origin.
  // In production the backend is API-only — the frontend is a separate Vercel deploy.
  if (!IS_PRODUCTION) {
    console.log("Initializing Vite middleware...");
    try {
      const viteModuleName = "vite";
      const { createServer: createViteServer } = await import(viteModuleName);
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: false,
        },
        appType: "spa",
        root: process.cwd(),
      });
      app.use(vite.middlewares);
      console.log("Vite middleware initialized successfully");
    } catch (viteError) {
      console.error("Vite initialization failed:", viteError);
    }
  }

  // Global error handler (MUST BE LAST)
  app.use((err: any, req: any, res: any, next: any) => {
    console.error(`UNHANDLED ERROR on ${req.method} ${req.url}:`, err);
    if (res.headersSent) return next(err);

    res.status(500).json({
      error: "Internal Server Error",
      message: err.message,
      path: req.url,
      stack: !IS_PRODUCTION ? err.stack : undefined,
    });
  });

  // Warm up the schema; failures surface via /api/health rather than crashing boot.
  db.ensureSchema().catch((err) => {
    console.error("Database schema init failed (will retry on first query):", err.message);
  });

  console.log(`Starting Express server on port ${PORT}...`);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is listening on http://0.0.0.0:${PORT}`);
    console.log("Health check available at /api/health");
    console.log("SERVER READY");
  });
}

startServer();

export default app;
