
import { Type } from "@google/genai";
import { AnalysisResult, RepoOverview, AIConfig } from "../types.js";

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
};

const getJwtToken = () => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('gitlens_token');
  }
  return null;
};

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
  const defaultFlash = 'gpt-4o-mini';
  const defaultPro = 'gpt-4o';
  const model = params.model || (currentConfig.useFlash 
    ? (currentConfig.flashModel || defaultFlash) 
    : (currentConfig.proModel || defaultPro));

  const messages = [];
  let systemInstruction = params.config?.systemInstruction || "";
  
  // OpenAI JSON mode requires "json" to be in the prompt
  if (params.config?.responseMimeType === 'application/json') {
    if (!systemInstruction.toLowerCase().includes('json')) {
      systemInstruction += "\n\nIMPORTANT: You must return the response in valid JSON format.";
    }
    if (params.config?.responseSchema) {
      systemInstruction += `\n\nYour JSON response MUST strictly adhere to the following JSON Schema:\n${JSON.stringify(params.config.responseSchema, null, 2)}`;
    }
  }

  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }

  if (typeof params.contents === 'string') {
    messages.push({ role: 'user', content: params.contents });
  } else if (params.contents?.parts) {
    const content = params.contents.parts.map((p: any) => p.text).join('\n');
    messages.push({ role: 'user', content });
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
    console.error(`[AI] OpenAI API error (${response.status}):`, err);
    throw new Error(err.error?.message || `OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const text = Array.isArray(data?.choices) && data.choices.length > 0 
    ? data.choices[0].message?.content || "" 
    : "";
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[AI] OpenAI response from ${model}:`, text);
  }
  return { text };
}

async function callGemini(params: any, maxRetries = 3): Promise<any> {
  const token = getJwtToken();
  
  if (token) {
    console.log(`[AI] Calling Backend Proxy API - Provider: ${currentConfig.provider}`);
    const response = await fetch('/api/ai/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        prompt: typeof params.contents === 'string' ? params.contents : undefined,
        contents: params.contents?.parts ? [params.contents] : params.contents,
        model: params.model,
        config: params.config
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || `Proxy error: ${response.status}`);
    }

    return await response.json();
  }

  // Fallback to client-side if no token (anonymous user with local key)
  if (currentConfig.provider === 'openai') {
    console.log(`[AI] Calling OpenAI SDK API (${currentConfig.baseUrl || 'https://api.openai.com/v1'})`);
    return callOpenAI(params);
  }

  // For Gemini client-side, we need the SDK which we removed from imports to keep bundle small/secure
  // But if we really need it for anonymous users, we'd have to dynamic import it or keep it.
  // Given the security concern, let's assume logged in is the primary use case.
  throw new Error("Please login with GitHub to use AI features securely.");
}

/**
 * Robustly extracts JSON from a string, handling markdown blocks, preamble text, and truncated JSON.
 */
const extractJson = (text: string): any => {
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

  const tryParse = (str: string) => {
    try {
      return JSON.parse(str);
    } catch (e) {
      return JSON.parse(repairJson(str));
    }
  };

  try {
    // Try direct parse first
    return tryParse(text.trim());
  } catch (e) {
    // Try to find JSON block in markdown
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        return tryParse(jsonMatch[1].trim());
      } catch (e2) {
        // Fall through
      }
    }

    // Try to find the first '{' and last '}'
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return tryParse(text.substring(firstBrace, lastBrace + 1));
      } catch (e3) {
        // Fall through
      }
    }

    // Try to find the first '[' and last ']'
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
      try {
        return tryParse(text.substring(firstBracket, lastBracket + 1));
      } catch (e4) {
        // Fall through
      }
    }

    throw new Error("Could not extract valid JSON from response");
  }
};

export const getRepoOverview = async (fileList: string[], context?: string): Promise<RepoOverview> => {
  console.time("getRepoOverview");
  const model = currentConfig.flashModel || "gemini-3-flash-preview";
  try {
    const response = await callGemini({
      model: model,
      contents: `Analyze the following file list and project context to provide a high-level structural overview of the repository:
      
      FILE LIST:
      ${fileList.slice(0, 1000).join("\n")}
      
      PROJECT CONTEXT (e.g. package.json or README):
      ${context || "N/A"}`,
      config: {
        systemInstruction: "You are a lead architect. Your goal is to map out a repository structure for a new developer. Identify the tech stack, core business logic location, and entry points. CRITICAL: DO NOT hallucinate or guess file paths, routes, or function names. ONLY use the exact file paths provided in the FILE LIST. If you are unsure about a route or file, state that you cannot find it in the provided context rather than guessing based on standard patterns (e.g., do not guess 'routes/postRoutes.js' if it's not in the file list).",
        responseMimeType: "application/json",
        responseSchema: OVERVIEW_SCHEMA,
      },
    });
    
    try {
      const parsed = extractJson(response.text || '{}');
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
    } catch (parseError) {
      console.error("Failed to parse repo overview JSON", parseError);
      return {
        summary: "Failed to generate repository overview due to a parsing error.",
        entry_points: [],
        core_modules: [],
        architecture_type: "Unknown"
      };
    }
  } catch (err) {
    console.error("Failed to get repo overview", err);
    return {
      summary: "Failed to generate repository overview.",
      entry_points: [],
      core_modules: [],
      architecture_type: "Unknown"
    };
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
  snippets: any[] = [],
  attachedFiles: { path: string; content: string }[] = [],
  messages: { role: string; content: string }[] = []
): Promise<AnalysisResult> => {
  console.time("analyzeCode");
  const model = useFlash 
    ? (currentConfig.flashModel || "gemini-3-flash-preview") 
    : (currentConfig.proModel || "gemini-3.1-pro-preview");
  
  try {
    const contentWithLines = currentFile?.content
      ? currentFile.content.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n')
      : 'N/A';

    const snippetsContext = snippets.length > 0 
      ? snippets.map(s => `FILE: ${s.path} (Lines ${s.startLine}-${s.endLine}):\n${s.content}`).join('\n\n---\n\n')
      : 'N/A';

    const attachedContext = attachedFiles.length > 0
      ? attachedFiles.map(f => `FILE: ${f.path}\n\n${f.content.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n')}`).join('\n\n---\n\n')
      : 'N/A';

    const historyContext = messages.length > 0
      ? messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')
      : 'No previous history.';

    const systemInstruction = `
      You are an expert code architect analyzing a repository.
      
      CRITICAL RULES:
      1. DO NOT assume everything is in the current file.
      2. USE THE 'ATTACHED FILES', 'RELEVANT CODE SNIPPETS' and 'FILES IN REPO' list to identify where specific logic is actually implemented.
      3. PRIORITIZE ATTACHED FILES if the user specifically mentions them or if they are highly relevant to the query.
      4. PRIORITIZE CODE FILES (e.g., .ts, .tsx, .js, .py, .go) in the 'highlights' array.
      5. If the user asks about an endpoint or logic that's not in the current file, check the provided snippets and file list.
      6. If you don't have the content for a file but know it's relevant, include it in 'highlights' with start=1 and end=1.
      7. If you ARE analyzing the current file content, a provided snippet, or an attached file, you MUST provide EXACT line numbers for the 'start' and 'end' properties.
      8. Provide the 'highlights' and 'related' arrays pointing to these files so the user can navigate to them.
      9. BE CONCISE. Limit 'highlights' to the top 5 most relevant items. Limit 'related' to the top 5 items.
      10. If the user query is a simple greeting (e.g., "hi", "hello"), provide a brief, friendly response and ask how you can help. Do not generate extensive highlights for greetings.
      11. IMPORTANT: Line numbers (start/end) MUST be realistic integers. Do NOT use placeholder large numbers. If unknown, use 1.
      12. KEEP IT SHORT: The 'answer_markdown' should be concise (max 300 words).
      13. DO NOT HALLUCINATE OR GUESS file paths, routes, or function names in 'answer_markdown', 'call_tree_markdown', 'highlights', or 'related'. ONLY use the exact file paths provided in 'FILES IN REPO', 'ATTACHED FILES', or 'RELEVANT CODE SNIPPETS'. If you are unsure about a route or file, state that you cannot find it in the provided context rather than guessing based on standard patterns (e.g., do not guess 'routes/postRoutes.js' if it's not in the file list).
      14. VERIFY FILE PATHS: Before outputting any file path in your response, check if it exists in the 'FILES IN REPO' list. If it does not exist, DO NOT output it. Use the exact names from the list (e.g., use 'controllers/upload-controller.js' instead of guessing 'controllers/postController.js').
      15. PENALTY FOR HALLUCINATION: Hallucinating file paths that do not exist in the provided context is a critical failure. Stick strictly to the provided facts.
      16. RELEVANCE CHECK: Before using a code snippet, verify it actually relates to the user's question. If the user asks about 'posts' but the snippets are about 'votes', do not force a connection. Use the 'FILES IN REPO' list to find more relevant files if the snippets are off-target.
      17. ANSWER THE LAST QUESTION: Your primary task is to answer the most recent question from the user. Use the chat history ONLY for context (e.g., to resolve pronouns like 'it' or 'that'). Do not repeat information from previous turns unless it is directly relevant to the new question. If the user switches topics (e.g., from 'voting' to 'posts'), focus entirely on the new topic.
      18. IF NO SNIPPETS ARE PROVIDED: If 'RELEVANT CODE SNIPPETS' is 'N/A' and the information is not in the 'CURRENT OPEN FILE' or 'ATTACHED FILES', state that you do not have enough information to answer specifically about the code logic, but you can see the files exist in the 'FILES IN REPO' list. DO NOT guess the implementation details.
    `;

    const response = await callGemini({
      model: model,
      contents: {
        parts: [
          { text: `REPO OVERVIEW: ${overview ? JSON.stringify(overview) : 'N/A'}` },
          { text: `CHAT HISTORY:\n\n${historyContext}` },
          { text: `CURRENT OPEN FILE (${currentFile?.path || 'None'}): \n\n${contentWithLines}` },
          { text: `ATTACHED FILES (SPECIFICALLY SELECTED BY USER):\n\n${attachedContext}` },
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
      let result: AnalysisResult = extractJson(jsonStr);

      // Sanitize line numbers to prevent overflows or hallucinations
      const sanitizeLine = (n: any) => {
        const num = Number(n);
        if (isNaN(num) || num < 1 || num > 1000000) return 1;
        return Math.floor(num);
      };

      const normalizePath = (p: string) => p.replace(/^\/+/, '').toLowerCase();
      const validFiles = new Set([
        ...fileList.map(normalizePath),
        ...attachedFiles.map(f => normalizePath(f.path)),
        ...snippets.map(s => normalizePath(s.path))
      ]);

      if (Array.isArray(result.highlights)) {
        result.highlights = result.highlights.map(h => ({
          ...h,
          file: typeof h.file === 'string' ? h.file : 'unknown',
          function_name: typeof h.function_name === 'string' && h.function_name !== 'N/A' && h.function_name.trim() !== '' ? h.function_name : undefined,
          start: sanitizeLine(h.start),
          end: sanitizeLine(h.end),
          usage_examples: Array.isArray(h.usage_examples) ? h.usage_examples.map(ex => ({
            ...ex,
            file: typeof ex.file === 'string' ? ex.file : 'unknown',
            line: sanitizeLine(ex.line)
          })) : []
        })).filter(h => validFiles.has(normalizePath(h.file)) || h.file === 'unknown');
      } else {
        result.highlights = [];
      }

      if (Array.isArray(result.related)) {
        result.related = result.related.map(r => ({
          ...r,
          file: typeof r.file === 'string' ? r.file : 'unknown',
          start: sanitizeLine(r.start),
          end: sanitizeLine(r.end)
        })).filter(r => validFiles.has(normalizePath(r.file)) || r.file === 'unknown');
      } else {
        result.related = [];
      }

      return {
        answer_markdown: typeof result.answer_markdown === 'string' ? result.answer_markdown : (result.answer_markdown ? JSON.stringify(result.answer_markdown) : "No explanation available."),
        highlights: result.highlights || [],
        related: result.related || [],
        call_tree_markdown: typeof result.call_tree_markdown === 'string' ? result.call_tree_markdown : ""
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
      
      CRITICAL: ONLY trace DIRECT function calls and dependencies within the provided file content. DO NOT infer dependencies based on props passed to components or indirect calls through parent components. If a function is called via a prop, note that it is an indirect dependency via the parent, do not list it as a direct call from this component.
      CRITICAL: DO NOT hallucinate or guess file paths, routes, or function names. ONLY use the exact names provided in the code. If you are unsure about a route or file, state that you cannot find it in the provided context rather than guessing based on standard patterns (e.g., do not guess 'routes/postRoutes.js' if it's not in the file list).
      
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
      systemInstruction: "You are a code dependency analyzer. Return a JSON object representing a node-link graph of dependencies. CRITICAL: DO NOT hallucinate or guess file paths, routes, or function names. ONLY use the exact file paths provided in the FILE LIST. If you are unsure about a route or file, state that you cannot find it in the provided context rather than guessing based on standard patterns (e.g., do not guess 'routes/postRoutes.js' if it's not in the file list).",
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
  try {
    const data = extractJson(jsonStr);
    return {
      nodes: Array.isArray(data?.nodes) ? data.nodes : [],
      links: Array.isArray(data?.links) ? data.links : []
    };
  } catch (e) {
    console.error("Failed to parse symbol dependencies JSON", e);
    return { nodes: [], links: [] };
  }
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
      systemInstruction: "You are a code symbol extractor. Your goal is to identify the 'meat' of the file while skipping boilerplate and configuration. Return a JSON object with a 'symbols' array. CRITICAL: DO NOT hallucinate or guess file paths, routes, or function names. ONLY use the exact names provided in the code. If you are unsure about a route or file, state that you cannot find it in the provided context rather than guessing based on standard patterns (e.g., do not guess 'routes/postRoutes.js' if it's not in the file list).",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          symbols: {
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
        required: ["symbols"]
      }
    },
  });

  const jsonStr = response.text?.trim() || '{"symbols": []}';
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[AI] analyzeFileSymbols raw response for ${filename}:`, jsonStr);
  }
  try {
    const data = extractJson(jsonStr);
    const rawSymbols = Array.isArray(data) ? data : (data.symbols || []);
    
    // Map hallucinated property names to our expected schema
    const symbols = rawSymbols.map((s: any) => {
      const start = s.start || (Array.isArray(s.lineRange) ? s.lineRange[0] : (s.range?.start || 1));
      const end = s.end || (Array.isArray(s.lineRange) ? s.lineRange[1] : (s.range?.end || start));
      
      // Normalize path: ensure it matches the input filename if it's just a filename or similar
      let symbolFile = s.file || filename;
      if (symbolFile && !symbolFile.includes('/') && filename.includes('/')) {
        // If AI returned just "App.tsx" but filename is "src/App.tsx", use filename
        if (filename.endsWith(symbolFile)) {
          symbolFile = filename;
        }
      }

      return {
        file: symbolFile,
        start: typeof start === 'number' ? start : parseInt(String(start)) || 1,
        end: typeof end === 'number' ? end : parseInt(String(end)) || 1,
        label: s.label || s.name || s.function_name || "Unknown Symbol",
        function_name: s.function_name || s.name || s.label,
        explanation: s.explanation || s.description || "No explanation provided.",
        params: s.params || s.parameters,
        returns: s.returns || s.returnType
      };
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[AI] analyzeFileSymbols parsed and mapped ${symbols.length} symbols:`, symbols);
    }
    return symbols;
  } catch (e) {
    console.error("Failed to parse symbols JSON", e);
    return [];
  }
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
      systemInstruction: "You are a code usage analyzer. Return a JSON object with an 'examples' array. CRITICAL: DO NOT hallucinate or guess file paths, routes, or function names. ONLY use the exact names provided in the code.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          examples: {
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
        required: ["examples"]
      }
    },
  });

  const jsonStr = response.text?.trim() || '{"examples": []}';
  try {
    const data = extractJson(jsonStr);
    return Array.isArray(data) ? data : (data.examples || []);
  } catch (e) {
    console.error("Failed to parse usage examples JSON", e);
    return [];
  }
};
export const summarizeFile = async (path: string, content: string): Promise<string> => {
  const model = currentConfig.flashModel || "gemini-3-flash-preview";
  try {
    const response = await callGemini({
      model: model,
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
  const token = getJwtToken();

  if (token) {
    console.log(`[AI] Calling Backend Proxy for Embedding`);
    try {
      const response = await fetch('/api/ai/embed', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ text })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || `Proxy error: ${response.status}`);
      }

      const data = await response.json();
      return data.embedding || [];
    } catch (err) {
      console.error("Proxy Embedding failed:", err);
      return [];
    }
  }

  if (currentConfig.provider === 'openai') {
    console.log(`[AI] Calling OpenAI SDK API for Embedding (${currentConfig.baseUrl || 'https://api.openai.com/v1'}) - Model: ${currentConfig.embeddingModel || 'text-embedding-3-small'}`);
    try {
      const baseUrl = (currentConfig.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
      const apiKey = currentConfig.apiKey;
      const model = currentConfig.embeddingModel || 'text-embedding-3-small';

      const payload: any = {
        input: text,
        model
      };
      
      if (model.includes('text-embedding-3')) {
        payload.dimensions = 768;
      }

      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || `OpenAI Embedding error: ${response.status}`);
      }

      const data = await response.json();
      return Array.isArray(data?.data) && data.data.length > 0 ? data.data[0].embedding : [];
    } catch (err) {
      console.error("OpenAI Embedding failed:", err);
      return [];
    }
  }

  console.error("Embedding requires login or local OpenAI config.");
  return [];
};
