import mongoose from 'mongoose';

const FileSchema = new mongoose.Schema({
  repoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Repository', required: true, index: true },
  path: { type: String, required: true },
  type: { type: String, enum: ['blob', 'tree'], required: true },
  sha: { type: String, required: true },
  url: { type: String, required: true },
  content: { type: String },
  status: { type: String, enum: ['PENDING', 'INDEXED', 'FAILED'], default: 'PENDING' }
});

FileSchema.index({ repoId: 1, path: 1 }, { unique: true });

export const FileModel = mongoose.model('File', FileSchema);
