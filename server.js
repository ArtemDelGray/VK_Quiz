import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Можно загружать только изображения'));
    }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'quiz-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

app.use(express.static(path.join(__dirname, 'public')));

const users = [];
const quizzes = [];
const rooms = {};

const getCurrentUser = (req) => users.find(u => u.id === req.session.user?.id);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'auth.html')));

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (users.find(u => u.username === username)) return res.status(400).json({ error: 'Логин занят' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = { 
        id: Date.now(), 
        username, 
        password: hashedPassword,
        avatar: 'https://cdn-icons-png.flaticon.com/512/149/149071.png', 
        hostedHistory: [], 
        playedHistory: [],
        wins: 0
    };
    users.push(newUser);
    req.session.user = { id: newUser.id, username: newUser.username };
    res.status(201).json({ success: true });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    req.session.user = { id: user.id, username: user.username };
    res.json({ success: true });
});

app.get('/profile-data', (req, res) => {
    const user = getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Не авторизован' });
    res.json(user);
});

app.post('/upload-avatar', upload.single('avatar'), (req, res) => {
    const user = getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Не авторизован' });
    if (!req.file) return res.status(400).json({ error: 'Файл не выбран' });

    user.avatar = '/uploads/' + req.file.filename;
    res.json({ success: true, avatarUrl: user.avatar });
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.get('/my-quizzes-data', (req, res) => {
    const user = getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Не авторизован' });
    res.json(quizzes.filter(q => q.authorId === user.id));
});

app.get('/quiz/:id', (req, res) => {
    const user = getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Не авторизован' });
    const quiz = quizzes.find(q => q.id === req.params.id);
    if (!quiz) return res.status(404).json({ error: 'Квиз не найден' });
    res.json(quiz);
});

app.post('/upload-question-img', upload.single('questionImage'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    res.json({ imageUrl: '/uploads/' + req.file.filename });
});

app.post('/create-quiz', (req, res) => {
    const user = getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Не авторизован' });
    const { title, category, questions } = req.body;
    const newQuiz = { id: Date.now().toString(), authorId: user.id, title: title || "Без названия", category: category || "Общее", questions: questions || [] };
    quizzes.push(newQuiz);
    res.status(201).json({ success: true, quizId: newQuiz.id });
});

app.put('/edit-quiz/:id', (req, res) => {
    const user = getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Не авторизован' });
    const quizIndex = quizzes.findIndex(q => q.id === req.params.id && q.authorId === user.id);
    if (quizIndex === -1) return res.status(404).json({ error: 'Квиз не найден' });
    const { title, category, questions } = req.body;
    quizzes[quizIndex] = { ...quizzes[quizIndex], title: title || "Без названия", category: category || "Общее", questions: questions || [] };
    res.json({ success: true, quizId: quizzes[quizIndex].id });
});

app.delete('/delete-quiz/:id', (req, res) => {
    const user = getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Не авторизован' });
    const quizIndex = quizzes.findIndex(q => q.id === req.params.id && q.authorId === user.id);
    if (quizIndex === -1) return res.status(404).json({ error: 'Квиз не найден' });
    quizzes.splice(quizIndex, 1);
    res.json({ success: true });
});

function getStrippedQuestion(quiz, index) {
    const q = quiz.questions[index];
    return {
        text: q.text, image: q.image, type: q.type,
        options: q.options.map(o => ({ text: o.text }))
    };
}

io.on('connection', (socket) => {
    socket.on('create_room', ({ userData, quizId }) => {
        const quiz = quizzes.find(q => q.id === quizId);
        if (!quiz) return socket.emit('error_msg', 'Квиз не найден');

        const roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomCode] = {
            organizer: socket.id,
            organizerId: userData.id,
            quiz: quiz,
            players: [],
            status: 'waiting',
            currentQ: 0,
            answers: {}
        };
        socket.join(roomCode);
        socket.emit('room_created', { code: roomCode, quizTitle: quiz.title });
    });

    socket.on('join_room', ({ roomCode, userData }) => {
        const room = rooms[roomCode];
        if (!room) return socket.emit('error_msg', 'Комната не найдена');

        const isHost = (userData.id === room.organizerId);

        if (isHost) {
            room.organizer = socket.id;
            room.organizerConnected = true;
            socket.to(roomCode).emit('host_reconnected');
        } else {
            let player = room.players.find(p => p.userId === userData.id);
            if (player) {
                player.id = socket.id;
                player.connected = true;
            } else {
                player = { id: socket.id, userId: userData.id, username: userData.username, avatar: userData.avatar, score: 0, hasAnswered: false, lastColor: '', connected: true };
                room.players.push(player);
            }
        }

        socket.join(roomCode);
        const activePlayers = room.players.filter(p => p.connected !== false);
        io.to(roomCode).emit('update_players', activePlayers);
        socket.emit('join_success', { code: roomCode, quizTitle: room.quiz.title, isHost, hostConnected: room.organizerConnected });

        if (room.status !== 'waiting') {
            socket.emit('game_started', {
                totalQuestions: room.quiz.questions.length,
                questionIndex: room.currentQ,
                question: getStrippedQuestion(room.quiz, room.currentQ),
                players: activePlayers,
                status: room.status,
                myAnswers: room.answers[userData.id] || []
            });

            if (room.status === 'checking' || room.status === 'locked') {
                const q = room.quiz.questions[room.currentQ];
                socket.emit('answers_locked', {
                    correctOptions: q.options.map(o => o.isCorrect),
                    players: activePlayers
                });
            }
        }
    });

    socket.on('start_game', (roomCode) => {
        const room = rooms[roomCode];
        const activePlayers = room ? room.players.filter(p => p.connected !== false) : [];
        if (room && room.organizer === socket.id && activePlayers.length > 0) {
            room.status = 'playing';
            room.currentQ = 0;
            room.answers = {};
            room.players.forEach(p => { p.hasAnswered = false; p.lastColor = ''; });
            
            io.to(roomCode).emit('game_started', {
                totalQuestions: room.quiz.questions.length,
                questionIndex: 0,
                question: getStrippedQuestion(room.quiz, 0),
                players: activePlayers
            });
        }
    });

    socket.on('submit_answer', ({ roomCode, selectedOptions }) => {
        const room = rooms[roomCode];
        if (room && (room.status === 'playing' || room.status === 'checking')) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                room.answers[player.userId] = selectedOptions;
                player.hasAnswered = selectedOptions.length > 0;
                io.to(roomCode).emit('update_players', room.players.filter(p => p.connected !== false));
            }
        }
    });

    socket.on('trigger_check', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.organizer === socket.id && room.status === 'playing') {
            room.status = 'checking';
            io.to(roomCode).emit('start_timer', 5);

            setTimeout(() => {
                if (!rooms[roomCode]) return;
                
                room.status = 'locked'; // <-- FIX: Lock answers after timer
                
                const q = room.quiz.questions[room.currentQ];
                const correctCount = q.options.filter(o => o.isCorrect).length;
                const step = correctCount > 0 ? 1 / correctCount : 0;

                room.players.forEach(p => {
                    const selected = room.answers[p.userId] || [];
                    let qScore = 0;
                    
                    if (selected.length > 0 && correctCount > 0) {
                        if (q.type === 'single') {
                            if (q.options[selected[0]]?.isCorrect) qScore = 1;
                        } else {
                            let correctSel = 0, wrongSel = 0;
                            selected.forEach(idx => {
                                if (q.options[idx]?.isCorrect) correctSel++;
                                else wrongSel++;
                            });
                            qScore = Math.max(0, (correctSel * step) - (wrongSel * step));
                        }
                    }
                    
                    p.score += qScore;
                    
                    if (selected.length === 0) p.lastColor = 'red';
                    else if (qScore === 1) p.lastColor = 'green';
                    else if (qScore > 0) p.lastColor = 'yellow';
                    else p.lastColor = 'red';
                });

                io.to(roomCode).emit('answers_locked', {
                    correctOptions: q.options.map(o => o.isCorrect),
                    players: room.players.filter(p => p.connected !== false)
                });
            }, 5000);
        }
    });

    socket.on('next_question', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.organizer === socket.id) {
            room.currentQ++;
            if (room.currentQ < room.quiz.questions.length) {
                room.status = 'playing';
                room.answers = {};
                room.players.forEach(p => { p.hasAnswered = false; p.lastColor = ''; });
                
                io.to(roomCode).emit('new_question', {
                    questionIndex: room.currentQ,
                    question: getStrippedQuestion(room.quiz, room.currentQ),
                    players: room.players.filter(p => p.connected !== false)
                });
            } else {
                room.status = 'finished';
                
                const activePlayers = room.players.filter(p => p.connected !== false);
                const maxScore = activePlayers.length > 0 ? Math.max(...activePlayers.map(p => p.score)) : 0;
                activePlayers.forEach(p => {
                    const u = users.find(user => user.id === p.userId);
                    if (u) {
                        u.playedHistory.push(room.quiz.id);
                        if (p.score === maxScore && maxScore > 0) u.wins = (u.wins || 0) + 1;
                    }
                });
                const hostU = users.find(u => u.id === room.organizerId);
                if (hostU) hostU.hostedHistory.push(room.quiz.id);

                activePlayers.sort((a, b) => b.score - a.score);
                io.to(roomCode).emit('game_over', activePlayers);
            }
        }
    });

    socket.on('leave_room', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            if (room.organizer === socket.id) {
                room.organizerConnected = false;
                io.to(roomCode).emit('host_disconnected');
            } else {
                const player = room.players.find(p => p.id === socket.id);
                if (player) {
                    player.connected = false;
                    io.to(roomCode).emit('update_players', room.players.filter(p => p.connected !== false));
                }
            }
            socket.leave(roomCode);
        }
    });

    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            if (room.organizer === socket.id) {
                room.organizerConnected = false;
                io.to(code).emit('host_disconnected');
            } else {
                const player = room.players.find(p => p.id === socket.id);
                if (player) {
                    player.connected = false;
                    io.to(code).emit('update_players', room.players.filter(p => p.connected !== false));
                }
            }
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Сервер: http://localhost:${PORT}`));
