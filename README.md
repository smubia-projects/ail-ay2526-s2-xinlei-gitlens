# GitLens Cursor AI Code Visualizer

An advanced, AI-powered repository explorer and code analysis tool designed to help developers understand complex codebases instantly.

## 🚀 Overview

GitLens Cursor AI Code Visualizer combines high-performance repository exploration with state-of-the-art Large Language Models. By leveraging **Gemini 3.1 Pro/Flash** and **MongoDB Atlas Vector Search**, it provides a "RAG-first" (Retrieval-Augmented Generation) experience that allows you to chat with your code, visualize dependencies, and trace function flows in real-time.

## ✨ Implemented Features

### 🔍 AI-Powered Exploration
- **Semantic Search (RAG)**: Automatically chunks and embeds code using `gemini-embedding-001`. Relevant snippets are retrieved using MongoDB Atlas Vector Search to provide the AI with precise context.
- **Deep Code Analysis**: Uses Gemini 3.1 Pro for complex reasoning and Flash for high-speed interactions.
- **Symbol Analysis**: Automatically identifies functions, classes, and variables with line-accurate explanations and parameter details.

### 📊 Visualization & Tracing
- **Dependency Graphs**: Interactive D3.js visualizations showing how files and symbols relate to each other.
- **Function Flow Tracing**: Step-by-step visual tracing of data flow and call hierarchies for any function.
- **Usage Examples**: AI-extracted real-world usage examples from across the repository.

### 🛠️ Developer Experience
- **GitHub Integration**: Seamlessly explore any public repository by URL.
- **Source Navigation**: Click on AI-retrieved context to jump directly to the relevant line in the code viewer.
- **Resilient API Layer**: Built-in exponential backoff retry logic for Gemini 503 (High Demand) errors.
- **Modern UI**: Responsive, high-performance interface built with React, Tailwind CSS, and Framer Motion.

## 🛠️ Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS, Framer Motion, Lucide Icons.
- **Backend**: Express.js, MongoDB Atlas (Vector Search), Vite.
- **AI/ML**: Google Gemini API (Pro, Flash, Embeddings).
- **Visualization**: D3.js, Recharts.

## 📋 TODOs & Future Improvements

- [ ] **Private Repository Support**: Implement full OAuth flow for secure access to private GitHub/GitLab repos.
- [ ] **AST-Aware Chunking**: Move from fixed-size chunking to Abstract Syntax Tree (AST) aware chunking for superior semantic retrieval.
- [ ] **AI-Driven Refactoring**: Enable the AI to suggest and apply multi-file refactoring changes directly.
- [ ] **Code Complexity Heatmaps**: Visualize "hot spots" in the codebase based on cyclomatic complexity or churn.
- [ ] **Local Codebase Support**: Add support for analyzing local directories via file system API or secure uploads.
- [ ] **Persistent User History**: Add user authentication to save chat history, indexed repositories, and custom analysis notes.

## 🚦 Getting Started

1. **Environment Setup**:
   - Ensure `GEMINI_API_KEY` is set in your environment.
   - Configure `MONGODB_URI` for the vector search index.
2. **Indexing**:
   - Enter a GitHub URL.
   - The app will automatically clone, chunk, and index the repository for semantic search.
3. **Analyze**:
   - Use the chat interface to ask questions about the code.
   - Use the "Visualize" and "Trace" tools to explore the structure.

---
*Built with ❤️ for developers who want to see the big picture.*
