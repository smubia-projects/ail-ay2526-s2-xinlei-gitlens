
import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult, RepoOverview } from "../types.js";

let aiInstance: GoogleGenAI | null = null;

function getAI() {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey) {
      console.warn("GEMINI_API_KEY is not set. API calls will fail.");
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
          start: { type: Type.NUMBER, description: "Line number where the logic starts. Use 1 if unknown." },
          end: { type: Type.NUMBER, description: "Line number where the logic ends. Use 1 if unknown." },
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
          start: { type: Type.NUMBER },
          end: { type: Type.NUMBER },
        },
        required: ["symbol", "file", "start", "end"],
      },
    },
  },
  required: ["answer_markdown", "highlights", "related"],
};

async function callGemini(params: any, maxRetries = 3): Promise<any> {
  let retryCount = 0;
  while (retryCount < maxRetries) {
    try {
      return await getAI().models.generateContent(params);
    } catch (err: any) {
      const isUnavailable = err.message?.includes("503") || err.message?.includes("UNAVAILABLE") || err.status === 503;
      if (isUnavailable && retryCount < maxRetries - 1) {
        retryCount++;
        const delay = Math.pow(2, retryCount) * 1000;
        console.warn(`Gemini API unavailable (503). Retrying in ${delay}ms... (Attempt ${retryCount}/${maxRetries})`);
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
    return JSON.parse(jsonStr) as RepoOverview;
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
    `;

    const response = await callGemini({
      model: model,
      contents: {
        parts: [
          { text: `REPO OVERVIEW: ${overview ? JSON.stringify(overview) : 'N/A'}` },
          { text: `CURRENT OPEN FILE (${currentFile?.path || 'None'}): \n\n${contentWithLines}` },
          { text: `RELEVANT CODE SNIPPETS (FROM SEMANTIC SEARCH):\n\n${snippetsContext}` },
          { text: `FILES IN REPO (TOTAL ${fileList.length}): ${fileList.slice(0, 1000).join(", ")}` },
          { text: `USER QUESTION: ${query}` }
        ]
      },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: ANALYSIS_SCHEMA,
      },
    });

    const jsonStr = response.text?.trim() || '{}';
    console.timeEnd("analyzeCode");
    return JSON.parse(jsonStr) as AnalysisResult;
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
      Your goal is to provide a highly structured, step-by-step visual trace of the function.
      
      FORMAT RULES:
      1. Use a "Step-by-Step" approach.
      2. For each step, identify:
         - **Action**: What is happening (e.g., "Input Validation", "API Call").
         - **Logic**: A brief description of the code logic.
         - **Data**: What data is being transformed or passed.
      3. Use visual indicators like [STEP 1], [STEP 2], etc.
      4. If there are external dependencies, highlight them clearly.
      5. End with a "Summary of Responsibility".
      
      Avoid long paragraphs. Use bullet points and bold text for readability.`,
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
    contents: `Analyze this file and identify all major functions, classes, or exported variables. 
    For each, provide:
    1. The name
    2. Start and end line numbers
    3. A concise one-sentence explanation of what it does.
    
    FILE (${filename}):
    \n\n${content}`,
    config: {
      systemInstruction: "Return a JSON array of highlights.",
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
export const embedText = async (text: string): Promise<number[]> => {
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const response = await getAI().models.embedContent({
        model: "gemini-embedding-001",
        contents: [{ parts: [{ text }] }],
      });
      return response.embeddings[0].values;
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
