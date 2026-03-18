
import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult, RepoOverview, AIConfig } from "../types.js";

let aiInstance: GoogleGenAI | null = null;
const getInitialConfig = (): AIConfig => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('ai_config');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
  }
  return { provider: 'gemini' };
};

let currentConfig: AIConfig = getInitialConfig();

export const setAIConfig = (config: AIConfig) => {
  currentConfig = config;
  aiInstance = null;
};

function getAI() {
  if (!aiInstance) {
    const apiKey = currentConfig.apiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey && currentConfig.provider === 'gemini') {
      console.warn("GEMINI_API_KEY is not set. API calls will fail.");
    } else if (apiKey?.startsWith("MapAPI")) {
      console.warn("The GEMINI_API_KEY appears to be a Google Maps API key. Please use a Gemini API key from https://aistudio.google.com/app/apikey");
    }
    aiInstance = new GoogleGenAI({ apiKey: apiKey || "" });
  }
  return aiInstance;
}

const OVERVIEW_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING, description: "A 2-sentence summary of the repo purpose." },
    entry_points: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          path: { type: Type.STRING },
          purpose: { type: Type.STRING }
        },
        required: ["path", "purpose"]
      }
    },
    core_modules: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          folder: { type: Type.STRING },
          description: { type: Type.STRING }
        },
        required: ["folder", "description"]
      }
    },
    architecture_type: { type: Type.STRING, description: "e.g. Clean Architecture, MVC, Layered, etc." }
  },
  required: ["summary", "entry_points", "core_modules", "architecture_type"]
};

const ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    answer_markdown: {
      type: Type.STRING,
      description: "Detailed explanation of the logic. Use standard Markdown for formatting.",
    },
    highlights: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          file: { type: Type.STRING },
          start: { type: Type.INTEGER, description: "Line number where the logic starts. Use 1 if unknown." },
          end: { type: Type.INTEGER, description: "Line number where the logic ends. Use 1 if unknown." },
          label: { type: Type.STRING },
          function_name: { type: Type.STRING },
          params: { type: Type.STRING, description: "Comma separated parameters with types if possible." },
          returns: { type: Type.STRING },
          description: { type: Type.STRING, description: "Detailed explanation of what this specific function/logic block does." },
          logic_source: { type: Type.STRING, description: "Explanation of where the inputs come from and what triggers this logic." }
        },
        required: ["file", "label", "description", "logic_source"],
      },
    },
    call_tree_markdown: {
      type: Type.STRING,
      description: "A nested markdown list representing the function call hierarchy. Format: - func()\n  - subFunc().",
    },
    related: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          symbol: { type: Type.STRING },
          file: { type: Type.STRING },
          start: { type: Type.INTEGER },
          end: { type: Type.INTEGER },
        },
        required: ["symbol", "file", "start", "end"],
      },
    },
  },
  required: ["answer_markdown", "highlights", "related"],
};

async function callOpenAI(params: any): Promise<any> {
  const baseUrl = (currentConfig.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const apiKey = currentConfig.apiKey;
  const model = currentConfig.chatModel || params.model || 'gpt-4o';

  const messages = [];
  if (params.config?.systemInstruction) {
    messages.push({ role: 'system', content: params.config.systemInstruction });
  }

  if (typeof params.contents === 'string') {
    messages.push({ role: 'user', content: params.contents });
  } else if (params.contents?.parts) {
    const content = params.contents.parts.map((p: any) => p.text).join('\n');
    messages.push({ role: 'user', content });
  } else if (Array.isArray(params.contents)) {
    // Handle chat history or multiple parts if needed
    // For now, simple mapping
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: params.config?.responseMimeType === 'application/json' ? { type: 'json_object' } : undefined
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || `OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return {
    text: data.choices[0].message.content
  };
}

async function callGemini(params: any, maxRetries = 3): Promise<any> {
  if (currentConfig.provider === 'openai') {
    console.log(`[AI] Calling OpenAI SDK API (${currentConfig.baseUrl || 'https://api.openai.com/v1'}) - Model: ${currentConfig.chatModel || params.model || 'gpt-4o'}`);
    return callOpenAI(params);
  }

  const isFlash = currentConfig.useFlash || params.model?.includes('flash');
  const model = isFlash ? "gemini-3-flash-preview" : "gemini-3.1-pro-preview";
  
  // Override model if not explicitly forced by the specific call logic
  if (!params.model || params.model.startsWith('gemini')) {
    params.model = model;
  }

  console.log(`[AI] Calling Gemini Native API - Model: ${params.model}`);
  
  let retryCount = 0;
  while (retryCount < maxRetries) {
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Gemini API request timed out")), 45000)
      );
      const contentPromise = getAI().models.generateContent(params);
      return await Promise.race([contentPromise, timeoutPromise]);
    } catch (err: any) {
      const isUnavailable = err.message?.includes("503") || err.message?.includes("UNAVAILABLE") || err.status === 503 || err.message?.includes("timed out");
      if (isUnavailable && retryCount < maxRetries - 1) {
        retryCount++;
        const delay = Math.pow(2, retryCount) * 1000;
        console.warn(`Gemini API issue. Retrying in ${delay}ms... (Attempt ${retryCount}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
}

export const getRepoOverview = async (fileList: string[], context?: string): Promise<RepoOverview> => {
  console.time("getRepoOverview");
  try {
    const response = await callGemini({
      model: "gemini-3-flash-preview",
      contents: `Analyze the following file list and project context to provide a high-level structural overview of the repository:
      
      FILE LIST:
      ${fileList.slice(0, 1000).join("\n")}
      
      PROJECT CONTEXT (e.g. package.json or README):
      ${context || "N/A"}`,
      config: {
        systemInstruction: "You are a lead architect. Your goal is to map out a repository structure for a new developer. Identify the tech stack, core business logic location, and entry points.",
        responseMimeType: "application/json",
        responseSchema: OVERVIEW_SCHEMA,
      },
    });
    const jsonStr = response.text?.trim() || '{}';
    const parsed = JSON.parse(jsonStr);
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : "No summary available.",
      entry_points: Array.isArray(parsed.entry_points) ? parsed.entry_points.map((ep: any) => ({
        path: typeof ep.path === 'string' ? ep.path : 'unknown',
        purpose: typeof ep.purpose === 'string' ? ep.purpose : 'No purpose provided.'
      })) : [],
      core_modules: Array.isArray(parsed.core_modules) ? parsed.core_modules.map((cm: any) => ({
        folder: typeof cm.folder === 'string' ? cm.folder : 'unknown',
        description: typeof cm.description === 'string' ? cm.description : 'No description available.'
      })) : [],
      architecture_type: typeof parsed.architecture_type === 'string' ? parsed.architecture_type : "Unknown"
    } as RepoOverview;
  } finally {
    console.timeEnd("getRepoOverview");
  }
};

export const analyzeCode = async (
  query: string,
  currentFile: { path: string; content: string } | null,
  fileList: string[],
  overview: RepoOverview | null,
  useFlash: boolean = false,
  snippets: any[] = []
): Promise<AnalysisResult> => {
  console.time("analyzeCode");
  const model = useFlash ? "gemini-3-flash-preview" : "gemini-3.1-pro-preview";
  
  try {
    const contentWithLines = currentFile?.content
      ? currentFile.content.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n')
      : 'N/A';

    const snippetsContext = snippets.length > 0 
      ? snippets.map(s => `FILE: ${s.path} (Lines ${s.startLine}-${s.endLine}):\n${s.content}`).join('\n\n---\n\n')
      : 'N/A';

    const systemInstruction = `
      You are an expert code architect analyzing a repository.
      
      CRITICAL RULES:
      1. DO NOT assume everything is in the current file.
      2. USE THE 'RELEVANT CODE SNIPPETS' and 'FILES IN REPO' list to identify where specific logic is actually implemented.
      3. PRIORITIZE CODE FILES (e.g., .ts, .tsx, .js, .py, .go) in the 'highlights' array.
      4. If the user asks about an endpoint or logic that's not in the current file, check the provided snippets and file list.
      5. If you don't have the content for a file but know it's relevant, include it in 'highlights' with start=1 and end=1.
      6. If you ARE analyzing the current file content or a provided snippet, you MUST provide EXACT line numbers for the 'start' and 'end' properties.
      7. Provide the 'highlights' and 'related' arrays pointing to these files so the user can navigate to them.
      8. BE CONCISE. Limit 'highlights' to the top 5 most relevant items. Limit 'related' to the top 5 items.
      9. If the user query is a simple greeting (e.g., "hi", "hello"), provide a brief, friendly response and ask how you can help. Do not generate extensive highlights for greetings.
      10. IMPORTANT: Line numbers (start/end) MUST be realistic integers. Do NOT use placeholder large numbers. If unknown, use 1.
      11. KEEP IT SHORT: The 'answer_markdown' should be concise (max 300 words).
    `;

    const response = await callGemini({
      model: model,
      contents: {
        parts: [
          { text: `REPO OVERVIEW: ${overview ? JSON.stringify(overview) : 'N/A'}` },
          { text: `CURRENT OPEN FILE (${currentFile?.path || 'None'}): \n\n${contentWithLines}` },
          { text: `RELEVANT CODE SNIPPETS (FROM SEMANTIC SEARCH):\n\n${snippetsContext}` },
          { text: `FILES IN REPO (TOTAL ${fileList.length}): ${fileList.slice(0, 500).join(", ")}${fileList.length > 500 ? '... (truncated)' : ''}` },
          { text: `USER QUESTION: ${query}` }
        ]
      },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: ANALYSIS_SCHEMA,
        maxOutputTokens: 4096,
      },
    });

    let jsonStr = response.text?.trim() || '{}';
    
    // Aggressively truncate any numeric strings that are too long to be real line numbers
    // This prevents token limit issues and parsing errors from hallucinations
    jsonStr = jsonStr.replace(/:\s*(\d{10,})/g, ': 1');

    console.timeEnd("analyzeCode");
    try {
      // Handle potential markdown code blocks in response
      let cleanJson = jsonStr.replace(/^```json\n?/, '').replace(/\n?```$/, '');
      
      // Attempt to repair truncated JSON if necessary
      const repairJson = (json: string) => {
        let stack: string[] = [];
        let inString = false;
        let escaped = false;
        for (let i = 0; i < json.length; i++) {
          const char = json[i];
          if (escaped) { escaped = false; continue; }
          if (char === '\\') { escaped = true; continue; }
          if (char === '"') { inString = !inString; continue; }
          if (!inString) {
            if (char === '{' || char === '[') stack.push(char === '{' ? '}' : ']');
            else if (char === '}' || char === ']') {
              if (stack.length > 0 && stack[stack.length - 1] === char) stack.pop();
            }
          }
        }
        let repaired = json;
        if (inString) repaired += '"';
        while (stack.length > 0) repaired += stack.pop();
        return repaired;
      };

      let result: AnalysisResult;
      try {
        result = JSON.parse(cleanJson) as AnalysisResult;
      } catch (firstError) {
        cleanJson = repairJson(cleanJson);
        result = JSON.parse(cleanJson) as AnalysisResult;
      }

      // Sanitize line numbers to prevent overflows or hallucinations
      const sanitizeLine = (n: any) => {
        const num = Number(n);
        if (isNaN(num) || num < 1 || num > 1000000) return 1;
        return Math.floor(num);
      };

      if (result.highlights) {
        result.highlights = result.highlights.map(h => ({
          ...h,
          file: typeof h.file === 'string' ? h.file : 'unknown',
          start: sanitizeLine(h.start),
          end: sanitizeLine(h.end),
          usage_examples: Array.isArray(h.usage_examples) ? h.usage_examples.map(ex => ({
            ...ex,
            file: typeof ex.file === 'string' ? ex.file : 'unknown',
            line: sanitizeLine(ex.line)
          })) : []
        }));
      }

      if (result.related) {
        result.related = result.related.map(r => ({
          ...r,
          file: typeof r.file === 'string' ? r.file : 'unknown',
          start: sanitizeLine(r.start),
          end: sanitizeLine(r.end)
        }));
      }

      return {
        answer_markdown: result.answer_markdown || "No explanation available.",
        highlights: result.highlights || [],
        related: result.related || [],
        call_tree_markdown: result.call_tree_markdown || ""
      };
    } catch (e) {
      console.error("Failed to parse Gemini response as JSON:", jsonStr);
      // If parsing fails, don't just dump the raw JSON into the answer
      const fallbackMessage = "I encountered an error parsing the analysis. This can happen if the response was too complex or contained invalid data. Please try asking a more specific question.";
      
      return {
        answer_markdown: jsonStr.length > 500 ? fallbackMessage : (jsonStr || fallbackMessage),
        highlights: [],
        related: [],
        call_tree_markdown: ""
      };
    }
  } catch (err: any) {
    console.timeEnd("analyzeCode");
    throw err;
  }
};

export const explainSelection = async (selection: string, filePath: string, fullContent: string): Promise<string> => {
  const response = await callGemini({
    model: "gemini-3-flash-preview",
    contents: `The user selected this code in "${filePath}":\n\n\`\`\`\n${selection}\n\`\`\`\n\nExplain this selection deeply within the context of the file: \n\n${fullContent.slice(0, 8000)}`,
    config: {
      systemInstruction: "You are a senior engineer. Provide a high-quality, professional technical explanation of the selected code.",
    },
  });
  return response.text || "I couldn't analyze that selection.";
};

export const getFunctionFlow = async (functionName: string, fileContent: string): Promise<string> => {
  const response = await callGemini({
    model: "gemini-3-flash-preview",
    contents: `Trace the data flow and call hierarchy for "${functionName}" in this code:\n\n${fileContent}`,
    config: {
      systemInstruction: `You are a code flow analyzer. 
      Your goal is to provide a highly structured, visual trace of the function.
      
      FORMAT RULES:
      1. START with a Mermaid "graph TD" block for high-level flow.
      2. FOLLOW with a "Step-by-Step Breakdown" section header.
      3. Use a Markdown LIST (using -) for each step ([STEP 1], [STEP 2], etc.).
      4. Inside each step list item, use these EXACT bullet points (DO NOT add colons after the bold text, the UI handles it):
         - **Action** description...
         - **Logic** description...
         - **Data** description with variables in \`name | type\` format.
      5. DO NOT put code symbols on their own lines; keep them inline.
      6. Keep descriptions under 2 sentences per bullet.
      7. End with a "Summary of Responsibility".
      
      EXAMPLE:
      \`\`\`mermaid
      graph TD
        A[Start] --> B[End]
      \`\`\`
      
      Step-by-Step Breakdown
      - [STEP 1] Initialization
        - **Action** Extracts session data.
        - **Logic** Uses \`req.session\`.
        - **Data** \`sessionUser | Object\``,
    },
  });
  return response.text || "No flow data available.";
};

export const getSymbolDependencies = async (
  symbolName: string,
  filePath: string,
  fileList: string[],
  overview: RepoOverview | null
): Promise<any> => {
  const response = await callGemini({
    model: "gemini-3-flash-preview",
    contents: `Analyze the dependencies for the symbol "${symbolName}" in file "${filePath}". 
    Identify what other functions/files it calls and what (if identifiable from the file list) might call it.
    
    FILES IN REPO: ${fileList.slice(0, 500).join(", ")}
    REPO OVERVIEW: ${JSON.stringify(overview)}`,
    config: {
      systemInstruction: "You are a code dependency analyzer. Return a JSON object representing a node-link graph of dependencies.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          nodes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                label: { type: Type.STRING },
                file: { type: Type.STRING },
                type: { type: Type.STRING, enum: ["function", "file", "class", "variable"] },
                line: { type: Type.NUMBER }
              },
              required: ["id", "label", "file", "type"]
            }
          },
          links: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                source: { type: Type.STRING },
                target: { type: Type.STRING },
                label: { type: Type.STRING }
              },
              required: ["source", "target"]
            }
          }
        },
        required: ["nodes", "links"]
      }
    },
  });

  const jsonStr = response.text?.trim() || '{"nodes":[], "links":[]}';
  return JSON.parse(jsonStr);
};

export const analyzeFileSymbols = async (
  filename: string,
  content: string
): Promise<any[]> => {
  const response = await callGemini({
    model: "gemini-3-flash-preview",
    contents: `Analyze this file and identify all major functions, classes, or exported variables that contain business logic. 
    
    CRITICAL RULES:
    1. IGNORE framework configuration constants (e.g., in Next.js: 'dynamic', 'revalidate', 'fetchCache', 'runtime', 'preferredRegion').
    2. IGNORE simple type definitions or interfaces unless they are exceptionally complex.
    3. FOCUS on functions that perform actions, API handlers (GET, POST, etc.), and core logic blocks.
    4. For each symbol, provide the name, line range, and a technical explanation.
    
    FILE (${filename}):
    \n\n${content}`,
    config: {
      systemInstruction: "You are a code symbol extractor. Your goal is to identify the 'meat' of the file while skipping boilerplate and configuration.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            file: { type: Type.STRING },
            start: { type: Type.INTEGER },
            end: { type: Type.INTEGER },
            label: { type: Type.STRING },
            function_name: { type: Type.STRING },
            explanation: { type: Type.STRING },
            params: { type: Type.STRING },
            returns: { type: Type.STRING }
          },
          required: ["file", "start", "end", "label", "explanation"]
        }
      }
    },
  });

  const jsonStr = response.text?.trim() || "[]";
  return JSON.parse(jsonStr);
};

export const getUsageExamples = async (
  symbolName: string,
  usages: { file: string; line: number; context: string }[]
): Promise<any[]> => {
  if (usages.length === 0) return [];

  const response = await callGemini({
    model: "gemini-3-flash-preview",
    contents: `Analyze these code snippets where the symbol "${symbolName}" is used.
    For each snippet, extract:
    1. The specific arguments/parameters passed to it.
    2. A one-sentence explanation of what it's doing in this context.
    
    USAGES:
    ${usages.slice(0, 10).map(u => `File: ${u.file}, Line: ${u.line}, Context: ${u.context}`).join("\n")}`,
    config: {
      systemInstruction: "You are a code usage analyzer. Return a JSON array of examples.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            file: { type: Type.STRING },
            line: { type: Type.NUMBER },
            arguments: { type: Type.STRING, description: "The actual values or variables passed to the function call." },
            context_explanation: { type: Type.STRING }
          },
          required: ["file", "line", "arguments", "context_explanation"]
        }
      }
    },
  });

  const jsonStr = response.text?.trim() || "[]";
  return JSON.parse(jsonStr);
};
export const summarizeFile = async (path: string, content: string): Promise<string> => {
  try {
    const response = await callGemini({
      model: "gemini-3-flash-preview",
      contents: `Provide a concise 1-sentence summary of the purpose and main responsibility of this file: ${path}\n\nCONTENT:\n${content.slice(0, 10000)}`,
      config: {
        systemInstruction: "You are a technical architect. Summarize the file's primary role in the system.",
      },
    });
    return response.text?.trim() || "No summary available.";
  } catch (err) {
    console.warn(`Failed to summarize ${path}`, err);
    return "Code file.";
  }
};

export const embedText = async (text: string): Promise<number[]> => {
  if (currentConfig.provider === 'openai') {
    console.log(`[AI] Calling OpenAI SDK API for Embedding (${currentConfig.baseUrl || 'https://api.openai.com/v1'}) - Model: ${currentConfig.embeddingModel || 'text-embedding-3-small'}`);
    try {
      const baseUrl = (currentConfig.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
      const apiKey = currentConfig.apiKey;
      const model = currentConfig.embeddingModel || 'text-embedding-3-small';

      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          input: text,
          model
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || `OpenAI Embedding error: ${response.status}`);
      }

      const data = await response.json();
      return data.data[0].embedding;
    } catch (err) {
      console.error("OpenAI Embedding failed:", err);
      return [];
    }
  }

  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      console.log(`[AI] Calling Gemini Native API for Embedding`);
      const response = await getAI().models.embedContent({
        model: "gemini-embedding-2-preview",
        contents: [{ parts: [{ text }] }],
        config: { outputDimensionality: 768 }
      });
      const values = response.embeddings[0].values;
      if (values.length !== 768) {
        console.warn(`Embedding dimension mismatch: expected 768, got ${values.length}`);
      }
      return values;
    } catch (err: any) {
      const isUnavailable = err.message?.includes("503") || err.message?.includes("UNAVAILABLE") || err.status === 503;
      if (isUnavailable && retryCount < maxRetries - 1) {
        retryCount++;
        const delay = Math.pow(2, retryCount) * 1000;
        console.warn(`Embedding API unavailable (503). Retrying in ${delay}ms... (Attempt ${retryCount}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      console.error("Embedding failed:", err);
      return [];
    }
  }
  return [];
};
