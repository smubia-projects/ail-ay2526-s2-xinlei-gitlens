# GitLens AI Code Visualizer

An advanced, AI-powered repository explorer and code analysis tool designed to help developers understand complex codebases instantly.

## 🚀 Overview

GitLens AI Code Visualizer combines high-performance repository exploration with state-of-the-art Large Language Models. By leveraging **Gemini 3.1 Pro/Flash** and **MongoDB Atlas Vector Search**, it provides a "RAG-first" (Retrieval-Augmented Generation) experience that allows you to chat with your code, visualize dependencies, and trace function flows in real-time.

## ✨ Implemented Features

### 🔍 AI-Powered Exploration
- **Private Repository Support**: Full GitHub OAuth flow for secure access to private repositories.
- **Persistent User History**: User authentication to save indexed repositories and custom analysis notes.
- **Semantic Search (RAG)**: Automatically chunks and embeds code using `gemini-embedding-001`. Relevant snippets are retrieved using MongoDB Atlas Vector Search to provide the AI with precise context.
- **Deep Code Analysis**: Uses Gemini 3.1 Pro for complex reasoning and **Gemini 3 Flash** for high-speed interactions.
- **Resilient AI Layer**: Built-in timeout handling (45s), exponential backoff for 503 errors, and automatic response sanitization.
- **Symbol Analysis**: Automatically identifies functions, classes, and variables with line-accurate explanations and parameter details.

### 📊 Visualization & Tracing
- **Dependency Graphs**: Interactive D3.js visualizations showing how files and symbols relate to each other.
- **Function Flow Tracing**: Step-by-step visual tracing of data flow and call hierarchies for any function.
- **Usage Examples**: AI-extracted real-world usage examples from across the repository.

### 🛠️ Developer Experience
- **GitHub Integration**: Seamlessly explore any public repository by URL.
- **Source Navigation**: Click on AI-retrieved context to jump directly to the relevant line in the code viewer.
- **Speed Mode**: Toggle between high-reasoning (Pro) and high-speed (Flash) models.
- **Modern UI**: Responsive, high-performance interface built with React, Tailwind CSS, and Framer Motion.
- **Auto-Scrolling Chat**: Chat interface automatically scrolls to the latest response.
- **Instant Flow Visualization**: Logic flow diagrams render instantly without slow animations.

## 🛠️ Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS, Framer Motion, Lucide Icons.
- **Backend**: Express.js, MongoDB Atlas (Vector Search), Vite.
- **AI/ML**: Google Gemini API (Pro, Flash, Embeddings).
- **Visualization**: D3.js, Recharts.

## 📋 TODOs & Future Improvements

- [ ] **AST-Aware Chunking**: Move from fixed-size chunking to Abstract Syntax Tree (AST) aware chunking for superior semantic retrieval.
- [ ] **AI-Driven Refactoring**: Enable the AI to suggest and apply multi-file refactoring changes directly.
- [ ] **Code Complexity Heatmaps**: Visualize "hot spots" in the codebase based on cyclomatic complexity or churn.
- [ ] **Local Codebase Support**: Add support for analyzing local directories via file system API or secure uploads.

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
4. **Run Development Server**:
   ```bash
   npm run dev
   ```

## 🔧 Troubleshooting

### MongoDB Vector Index Errors
If you encounter `MongoServerError: PlanExecutor error... vector field is indexed with X dimensions but queried with Y dimensions`, ensure your embedding model configuration matches your MongoDB Atlas vector index dimensions.
- **Fix**: Update the `dimensions` parameter in your embedding service (e.g., `services/gemini.ts`) to match the index configuration (e.g., `768`).

---
*Built with ❤️ for developers who want to see the big picture.*
