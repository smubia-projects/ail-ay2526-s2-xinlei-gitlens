import mongoose from 'mongoose';
import { RepoFile, RepoOverview, RepoStats, Highlight } from '../types.js';

const RepoSchema = new mongoose.Schema({
  owner: { type: String, required: true },
  name: { type: String, required: true },
  branch: { type: String, required: true },
  lastCommitSha: { type: String }, // Track the latest commit indexed
  overview: { type: Object, required: true },
  stats: { type: Object, required: true },
  highlights: { type: Array, default: [] },
  embedding: { type: [Number], default: [] },
  lastIndexed: { type: Date, default: Date.now },
  githubUserId: { type: Number, index: true }, // GitHub ID of the owner
  isPrivate: { type: Boolean, default: false },
  isTemporary: { type: Boolean, default: false },
  indexedBy: { type: [String], default: [], index: true }, // List of user IDs or guest IDs who have this in their library
  expiresAt: { type: Date, index: { expires: 0 } } // TTL index
});

// Compound index to quickly find a repo
RepoSchema.index({ owner: 1, name: 1, branch: 1 }, { unique: true });

export const RepoModel = mongoose.model('Repository', RepoSchema);
