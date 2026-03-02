import mongoose from 'mongoose';
import { RepoFile, RepoOverview, RepoStats, Highlight } from '../types.js';

const RepoSchema = new mongoose.Schema({
  owner: { type: String, required: true },
  name: { type: String, required: true },
  branch: { type: String, required: true },
  files: { type: Array, required: true },
  overview: { type: Object, required: true },
  stats: { type: Object, required: true },
  highlights: { type: Array, default: [] },
  embedding: { type: [Number], default: [] },
  lastIndexed: { type: Date, default: Date.now }
});

// Compound index to quickly find a repo
RepoSchema.index({ owner: 1, name: 1, branch: 1 }, { unique: true });

export const RepoModel = mongoose.model('Repository', RepoSchema);
