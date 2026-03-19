import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  githubId: { type: Number, required: true, unique: true },
  login: { type: String, required: true },
  avatarUrl: { type: String },
  aiConfig: {
    provider: { type: String, default: 'gemini' },
    apiKey: { type: String },
    baseUrl: { type: String },
    chatModel: { type: String },
    embeddingModel: { type: String },
    useFlash: { type: Boolean, default: true }
  }
}, { timestamps: true });

export const UserModel = mongoose.model('User', UserSchema);
