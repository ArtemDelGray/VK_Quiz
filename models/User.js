const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['organizer', 'player'], default: 'player' },
    history: [{
        quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz' },
        score: Number,
        playedAt: { type: Date, default: Date.now }
    }]
});

module.exports = mongoose.model('User', UserSchema);