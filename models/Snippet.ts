import mongoose from 'mongoose';

const SnippetSchema = new mongoose.Schema({
  repoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repository', required: true },
  owner: { type: String, required: true },
  name: { type: String, required: true },
  path: { type: String, required: true },
  content: { type: String, required: true },
  purpose: { type: String },
  startLine: { type: Number, required: true },
  endLine: { type: Number, required: true },
  embedding: { type: [Number], required: true },
});

// Index for vector search
// Note: The actual Atlas Vector Search index is created in the MongoDB Atlas UI,
// but we'll name it 'vector_index' to match our code.
SnippetSchema.index({ repoId: 1, path: 1 });

export const SnippetModel = mongoose.model('Snippet', SnippetSchema);
