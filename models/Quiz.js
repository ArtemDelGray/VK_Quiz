const mongoose = require('mongoose');

const QuestionSchema = new mongoose.Schema({
    text: { type: String, required: true },
    mediaUrl: { type: String, default: null },
    type: { type: String, enum: ['single', 'multiple'], default: 'single' },
    options: [{ text: String, isCorrect: Boolean }],
    timeLimit: { type: Number, default: 20 }
});

const QuizSchema = new mongoose.Schema({
    organizerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    category: { type: String, required: true },
    settings: {
        isPublic: { type: Boolean, default: false },
        defaultTimeLimit: { type: Number, default: 20 }
    },
    questions: [QuestionSchema],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Quiz', QuizSchema);