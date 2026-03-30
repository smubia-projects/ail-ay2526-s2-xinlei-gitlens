# GitLens AI Code Visualizer

An advanced, AI-powered repository explorer and code analysis tool designed to help developers understand complex codebases instantly.

## 🚀 Overview

GitLens AI Code Visualizer combines high-performance repository exploration with state-of-the-art Large Language Models. By leveraging **Gemini 3.1 Pro/Flash**, **OpenAI**, and **MongoDB Atlas Vector Search**, it provides a "RAG-first" (Retrieval-Augmented Generation) experience that allows you to chat with your code, visualize dependencies, and trace function flows in real-time.

## ✨ Features

### 🔍 AI-Powered Exploration
- **Private Repository Support**: Full GitHub OAuth flow for secure access to private repositories.
- **Semantic Search (RAG)**: Automatically chunks and embeds code. Relevant snippets are retrieved using MongoDB Atlas Vector Search to provide the AI with precise context.
- **Multi-Model Support**: Choose between Gemini (Pro/Flash) and OpenAI models for your analysis.
- **Deep Code Analysis**: Uses advanced reasoning models for complex logic explanation and high-speed models for quick interactions.
- **Symbol Analysis**: Automatically identifies functions, classes, and variables with line-accurate explanations and parameter details.

### 💬 Interactive Chat
- **Multi-line Input**: Advanced chat interface supporting multi-line queries (use `Enter` for new lines, `Ctrl+Enter` to send).
- **File Mentions**: Type `@` in the chat to quickly search and attach specific files to your context.
- **Drag & Drop**: Easily attach files to the chat by dragging them from the file explorer.
- **Source Navigation**: Click on AI-retrieved context citations to jump directly to the relevant line in the code viewer.

### 📊 Visualization & Tracing
- **Dependency Graphs**: Interactive D3.js visualizations showing how files and symbols relate to each other.
- **Function Flow Tracing**: Step-by-step visual tracing of data flow and call hierarchies for any function.

## 🛠️ Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Framer Motion, Lucide Icons.
- **Backend**: Express.js, MongoDB Atlas (Vector Search), Vite.
- **AI/ML**: Google Gemini API, OpenAI API.
- **Visualization**: D3.js, Recharts.

## 📁 Project Structure

- `/App.tsx`: Main application entry point and state container.
- `/server.ts`: Express backend handling GitHub OAuth, MongoDB connections, and AI proxying.
- `/components/`: UI components (`CodeViewer`, `FileExplorer`, `FlowVisualizer`, `Dashboard`, etc.).
- `/services/`: API integration layers (`gemini.ts`, `github.ts`).

## 🎯 Areas for Improvement (Roadmap)

While fully functional, the project has several areas targeted for architectural and UX improvements:

1. **State Management Refactoring**: `App.tsx` is currently a monolith handling all application state. Moving to a global state manager (like Zustand or React Context) will vastly improve maintainability.
2. **Component Extraction**: The main layout, chat sidebar, and file explorer should be extracted from `App.tsx` into modular components.
3. **Security Enhancements**: User API keys stored in MongoDB should be encrypted at rest.
4. **Type Safety**: Replace remaining `any` types in the AI proxy and service layers with strict TypeScript interfaces.
5. **AST-Aware Chunking**: Move from fixed-size chunking to Abstract Syntax Tree (AST) aware chunking for superior semantic retrieval.
6. **Granular Indexing Progress**: Improve the "Mapping..." UI to show granular progress (e.g., "Chunking...", "Embedding...").

## 🚦 Getting Started

1. **Prerequisites**:
   - Node.js (v18+)
   - MongoDB Atlas account with a Vector Search index configured.
2. **Installation**:
   ```bash
   npm install
   ```
3. **Environment Setup**:
   - Copy `.env.example` to `.env` and configure the required variables:
     - `GEMINI_API_KEY`: Get one at [Google AI Studio](https://aistudio.google.com/app/apikey).
     - `MONGODB_URI`: Connection string for your MongoDB Atlas instance.
     - `GITHUB_CLIENT_ID` & `GITHUB_CLIENT_SECRET`: For OAuth integration.
4. **Run Development Server**:
   ```bash
   npm run dev
   ```

## 🔧 Troubleshooting

### MongoDB Vector Index Errors
If you encounter `MongoServerError: PlanExecutor error... vector field is indexed with X dimensions but queried with Y dimensions`, ensure your embedding model configuration matches your MongoDB Atlas vector index dimensions.
- **Fix**: Update the `dimensions` parameter in your embedding service to match the index configuration (e.g., `768` for `text-embedding-3-small`).

---
*Built with ❤️ for developers who want to see the big picture.*
