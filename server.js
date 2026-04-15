const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const Logger = require('./utils/Logger');
const Validator = require('./utils/Validator');
const GameSession = require('./classes/GameSession');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const logger = new Logger();

app.use(morgan('combined', {
  stream: {
    write: (message) => {
      logger.info(message.trim());
    }
  }
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);
app.use(express.static(path.join(__dirname, 'public')));

const gameSessions = new Map();
const users = new Map();
const socketIpMap = new Map();

io.on('connection', (socket) => {
  const clientIp = socket.handshake.address;
  socketIpMap.set(socket.id, clientIp);

  logger.info(`[CONNECTION] New socket connected`);

  socket.on('user_join', (userData) => {
    try {
      const validation = Validator.validateUsername(userData?.username);
      if (!validation.valid) {
        socket.emit('error', validation.error);
        return;
      }

      const duplicateUser = Array.from(users.values()).find(
        u => u.username.toLowerCase() === userData.username.toLowerCase()
      );

      if (duplicateUser) {
        socket.emit('error', 'Username already taken');
        return;
      }

      users.set(socket.id, {
        username: userData.username,
        score: 0,
        currentSessionId: null,
        joinedAt: new Date(),
        ip: clientIp
      });

      socket.emit('user_joined', {
        userId: socket.id,
        username: userData.username,
        message: `Welcome ${userData.username}!`
      });

      broadcastUsersList();
    } catch (error) {
      logger.error(`[ERROR] Error in user_join`, { error: error.message });
      socket.emit('error', 'Error joining server');
    }
  });

  socket.on('get_sessions', () => {
    try {
      const sessions = Array.from(gameSessions.values()).map(session => ({
        id: session.id,
        name: session.name,
        gameMasterId: session.gameMasterId,
        gameMasterName: session.gameMasterName,
        playerCount: session.players.size,
        maxPlayers: session.maxPlayers,
        status: session.status,
        createdAt: session.createdAt
      }));

      socket.emit('sessions_list', sessions);
    } catch (error) {
      logger.error(`[ERROR] Error in get_sessions`);
      socket.emit('error', 'Error fetching sessions');
    }
  });

  socket.on('create_session', (data) => {
    try {
      const user = users.get(socket.id);
      if (!user) {
        socket.emit('error', 'User not found');
        return;
      }

      const validation = Validator.validateSessionName(data?.sessionName);
      if (!validation.valid) {
        socket.emit('error', validation.error);
        return;
      }

      const maxPlayers = data.maxPlayers || 10;
      const session = new GameSession(
        data.sessionName,
        socket.id,
        user.username,
        maxPlayers
      );

      gameSessions.set(session.id, session);
      user.currentSessionId = session.id;

      socket.join(`session_${session.id}`);

      socket.emit('session_created', {
        sessionId: session.id,
        sessionName: session.name,
        status: 'waiting'
      });

      io.emit('session_created_broadcast', {
        id: session.id,
        name: session.name,
        gameMasterName: user.username,
        playerCount: 0,
        maxPlayers: maxPlayers,
        status: 'waiting'
      });

      broadcastSessionsUpdate();
    } catch (error) {
      logger.error(`[ERROR] Error in create_session`);
      socket.emit('error', 'Error creating session');
    }
  });

  socket.on('join_session', (data) => {
    try {
      const user = users.get(socket.id);
      if (!user) {
        socket.emit('error', 'User not found');
        return;
      }

      const session = gameSessions.get(data?.sessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      if (session.status === 'in_progress') {
        socket.emit('error', 'Game is already in progress');
        return;
      }

      if (session.players.has(socket.id)) {
        socket.emit('error', 'You are already in this session');
        return;
      }

      if (session.players.size >= session.maxPlayers) {
        socket.emit('error', 'Session is full');
        return;
      }

      session.addPlayer(socket.id, user.username);
      user.currentSessionId = session.id;
      socket.join(`session_${session.id}`);

      socket.emit('session_joined', {
        sessionId: session.id,
        sessionName: session.name,
        playerCount: session.players.size,
        gameMasterName: session.gameMasterName
      });

      io.to(`session_${session.id}`).emit('player_joined', {
        username: user.username,
        playerCount: session.players.size,
        message: `${user.username} joined the game`
      });

      broadcastSessionUpdate(session.id);
      broadcastSessionsUpdate();

    } catch (error) {
      logger.error(`[ERROR] Error in join_session`);
      socket.emit('error', 'Error joining session');
    }
  });

  socket.on('leave_session', () => {
    try {
      const user = users.get(socket.id);
      if (!user || !user.currentSessionId) {
        return;
      }

      const session = gameSessions.get(user.currentSessionId);
      if (!session) {
        user.currentSessionId = null;
        return;
      }

      const wasGameMaster = session.gameMasterId === socket.id;
      const sessionId = session.id;

      if (!wasGameMaster) {
        session.removePlayer(socket.id);
      }
      
      user.currentSessionId = null;
      socket.leave(`session_${session.id}`);

      if (!wasGameMaster) {
        io.to(`session_${session.id}`).emit('player_left', {
          username: user.username,
          playerCount: session.players.size,
          message: `${user.username} left the game`
        });
      }

      if (wasGameMaster) {
        if (session.players.size > 0) {
          const newMasterId = Array.from(session.players.keys())[0];
          session.gameMasterId = newMasterId;
          const newMasterUser = users.get(newMasterId);

          io.to(`session_${session.id}`).emit('game_master_changed', {
            newGameMasterName: newMasterUser?.username
          });
        } else {
          gameSessions.delete(session.id);
          io.emit('session_deleted', { sessionId: sessionId });
          broadcastSessionsUpdate();
          return;
        }
      }

      if (session.players.size === 0) {
        gameSessions.delete(session.id);
        io.emit('session_deleted', { sessionId: sessionId });
      } else {
        broadcastSessionUpdate(session.id);
      }

      broadcastSessionsUpdate();

    } catch (error) {
      logger.error(`[ERROR] Error in leave_session`);
    }
  });

  socket.on('create_questions', (data) => {
    try {
      const user = users.get(socket.id);
      if (!user || !user.currentSessionId) {
        socket.emit('error', 'User not in session');
        return;
      }

      const session = gameSessions.get(user.currentSessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      if (session.gameMasterId !== socket.id) {
        socket.emit('error', 'Only game master can create questions');
        return;
      }

      if (!data.questions || data.questions.length === 0) {
        socket.emit('error', 'Add at least 1 question');
        return;
      }

      let addedCount = 0;
      data.questions.forEach(q => {
        const result = session.addQuestion(q.question, q.options, q.correctAnswerIndex);
        if (result) addedCount++;
      });

      if (addedCount === 0) {
        socket.emit('error', 'No valid questions');
        return;
      }

      socket.emit('questions_created', {
        count: addedCount,
        message: `${addedCount} questions ready!`
      });

    } catch (error) {
      logger.error(`[ERROR] Error in create_questions`);
      socket.emit('error', 'Error creating questions');
    }
  });

  socket.on('start_game', () => {
    try {
      const user = users.get(socket.id);
      if (!user || !user.currentSessionId) {
        socket.emit('error', 'User not in session');
        return;
      }

      const session = gameSessions.get(user.currentSessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      if (session.gameMasterId !== socket.id) {
        socket.emit('error', 'Only game master can start game');
        return;
      }

      if (session.getTotalQuestions() === 0) {
        socket.emit('error', 'Please prepare questions first');
        return;
      }

      if (session.players.size < 3) {
        socket.emit('error', 'Need at least 3 players to start the game');
        return;
      }

      session.startGame();
      session.currentQuestionIndex = 0;

      const currentQuestion = session.getCurrentQuestion();
      
      io.to(`session_${session.id}`).emit('game_started', {
        question: currentQuestion.question,
        options: currentQuestion.options,
        questionNumber: 1,
        totalQuestions: session.getTotalQuestions(),
        timeLimit: session.timeLimit,
        message: `Game started! ${session.getTotalQuestions()} questions.`,
        roundNumber: session.roundCount
      });

      startCountdownTimer(session.id);

    } catch (error) {
      logger.error(`[ERROR] Error in start_game`);
      socket.emit('error', 'Error starting game');
    }
  });

  socket.on('make_guess', (data) => {
    try {
      const user = users.get(socket.id);
      if (!user || !user.currentSessionId) {
        socket.emit('error', 'User not in session');
        return;
      }

      const session = gameSessions.get(user.currentSessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      if (session.status !== 'in_progress') {
        socket.emit('error', 'Game is not in progress');
        return;
      }

      if (!session.gameRunning || session.winner) {
        socket.emit('error', 'Cannot answer now');
        return;
      }

      const currentQuestion = session.getCurrentQuestion();
      if (!currentQuestion) {
        socket.emit('error', 'No more questions');
        return;
      }

      const guessIndex = parseInt(data.guess);
      
      if (isNaN(guessIndex) || guessIndex < 0 || guessIndex >= currentQuestion.options.length) {
        socket.emit('error', 'Invalid selection');
        return;
      }

      const playerGuess = session.getPlayerGuess(socket.id);
      if (!playerGuess) {
        socket.emit('error', 'Player data not found');
        return;
      }

      session.recordAnswer(socket.id, guessIndex);

      const isCorrect = guessIndex === currentQuestion.correctAnswerIndex;

      if (isCorrect) {
        session.winner = socket.id;
        session.addScore(socket.id, 10);
        session.gameRunning = false;

        const newScore = session.getPlayerScore(socket.id);

        io.to(`session_${session.id}`).emit('correct_answer_found', {
          player: user.username,
          correctAnswer: currentQuestion.options[guessIndex],
          playerScore: newScore,
          message: `🎉 ${user.username} got it right! +10 points`,
          allPlayers: session.getPlayersData()
        });

        setTimeout(() => {
          moveToNextQuestion(session.id);
        }, 3000);

      } else {
        broadcastAnswerStatistics(session.id);
      }

    } catch (error) {
      logger.error(`[ERROR] Error in make_guess`);
      socket.emit('error', 'Error making guess');
    }
  });

  // NEW: Reset to next question
  socket.on('reset_question', () => {
    try {
      const user = users.get(socket.id);
      if (!user || !user.currentSessionId) {
        socket.emit('error', 'User not in session');
        return;
      }

      const session = gameSessions.get(user.currentSessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      if (session.gameMasterId !== socket.id) {
        socket.emit('error', 'Only game master can reset');
        return;
      }

      moveToNextQuestion(session.id);

    } catch (error) {
      logger.error(`[ERROR] Error in reset_question`);
      socket.emit('error', 'Error resetting question');
    }
  });

  // NEW: Delete entire session
  socket.on('delete_session', () => {
    try {
      const user = users.get(socket.id);
      if (!user || !user.currentSessionId) {
        socket.emit('error', 'User not in session');
        return;
      }

      const session = gameSessions.get(user.currentSessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      if (session.gameMasterId !== socket.id) {
        socket.emit('error', 'Only game master can delete session');
        return;
      }

      const sessionId = session.id;

      io.to(`session_${sessionId}`).emit('session_force_deleted', {
        message: 'Game Master ended the session'
      });

      // Remove all players
      session.players.forEach((userName, userId) => {
        const player = users.get(userId);
        if (player) {
          player.currentSessionId = null;
        }
      });

      gameSessions.delete(sessionId);
      
      io.to(`session_${sessionId}`).emit('disconnect_from_session');
      io.emit('session_deleted', { sessionId: sessionId });

      broadcastSessionsUpdate();

    } catch (error) {
      logger.error(`[ERROR] Error in delete_session`);
      socket.emit('error', 'Error deleting session');
    }
  });

  socket.on('get_session_details', () => {
    try {
      const user = users.get(socket.id);
      if (!user || !user.currentSessionId) {
        return;
      }

      const session = gameSessions.get(user.currentSessionId);
      if (!session) {
        return;
      }

      const players = session.getPlayersData().map(player => ({
        id: player.userId,
        name: player.userName,
        score: player.score,
        isGameMaster: false
      }));

      socket.emit('session_details', {
        sessionId: session.id,
        sessionName: session.name,
        status: session.status,
        question: session.status === 'in_progress' ? session.getCurrentQuestion()?.question : null,
        gameMasterName: session.gameMasterName,
        gameMasterId: session.gameMasterId,
        players: players,
        playerCount: session.players.size,
        timeRemaining: session.timeRemaining,
        roundNumber: session.roundCount,
        isCurrentUserGameMaster: session.gameMasterId === socket.id
      });
    } catch (error) {
      logger.error(`[ERROR] Error in get_session_details`);
    }
  });

  socket.on('get_leaderboard', () => {
    try {
      const leaderboard = Array.from(users.entries())
        .map(([userId, userData]) => ({
          username: userData.username,
          score: userData.score
        }))
        .sort((a, b) => b.score - a.score);

      socket.emit('leaderboard', leaderboard);
    } catch (error) {
      logger.error(`[ERROR] Error in get_leaderboard`);
      socket.emit('error', 'Error fetching leaderboard');
    }
  });

  socket.on('disconnect', () => {
    try {
      const user = users.get(socket.id);
      if (user) {
        if (user.currentSessionId) {
          const session = gameSessions.get(user.currentSessionId);
          if (session) {
            const wasGameMaster = session.gameMasterId === socket.id;

            if (!wasGameMaster) {
              session.removePlayer(socket.id);
            }

            if (session.players.size > 0 && !wasGameMaster) {
              io.to(`session_${session.id}`).emit('player_left', {
                username: user.username,
                playerCount: session.players.size,
                message: `${user.username} disconnected`
              });

              broadcastSessionUpdate(session.id);
            } else if (wasGameMaster) {
              if (session.players.size > 0) {
                const newMasterId = Array.from(session.players.keys())[0];
                session.gameMasterId = newMasterId;
                const newMasterUser = users.get(newMasterId);

                io.to(`session_${session.id}`).emit('game_master_changed', {
                  newGameMasterName: newMasterUser?.username
                });
              } else {
                gameSessions.delete(session.id);
                io.emit('session_deleted', { sessionId: session.id });
              }
            }
          }
        }

        users.delete(socket.id);
        socketIpMap.delete(socket.id);
        broadcastUsersList();
        broadcastSessionsUpdate();
      }
    } catch (error) {
      logger.error(`[ERROR] Error in disconnect`);
    }
  });
});

// ===== HELPERS =====
function broadcastUsersList() {
  const usersList = Array.from(users.values()).map((user, index) => ({
    id: Array.from(users.keys())[index],
    username: user.username,
    score: user.score
  }));
  io.emit('users_list_updated', usersList);
}

function broadcastSessionUpdate(sessionId) {
  const session = gameSessions.get(sessionId);
  if (!session) return;

  const players = session.getPlayersData().map(player => ({
    id: player.userId,
    name: player.userName,
    score: player.score,
    isGameMaster: false
  }));

  io.to(`session_${sessionId}`).emit('session_updated', {
    sessionId: session.id,
    sessionName: session.name,
    players: players,
    playerCount: session.players.size,
    status: session.status
  });
}

function broadcastSessionsUpdate() {
  const sessions = Array.from(gameSessions.values()).map(session => ({
    id: session.id,
    name: session.name,
    gameMasterId: session.gameMasterId,
    gameMasterName: session.gameMasterName,
    playerCount: session.players.size,
    maxPlayers: session.maxPlayers,
    status: session.status,
    createdAt: session.createdAt
  }));

  io.emit('sessions_list_updated', sessions);
}

function broadcastAnswerStatistics(sessionId) {
  const session = gameSessions.get(sessionId);
  if (!session) return;

  const stats = session.getAnswerStatistics();
  if (!stats) return;

  const currentQuestion = session.getCurrentQuestion();
  
  io.to(`session_${sessionId}`).emit('answer_statistics', {
    statistics: stats,
    playersAnswered: session.getPlayersData().filter(p => p.answered).length,
    totalPlayers: session.players.size,
    question: currentQuestion.question,
    players: session.getPlayersData()
  });
}

function startCountdownTimer(sessionId) {
  const session = gameSessions.get(sessionId);
  if (!session) return;

  const countdownInterval = setInterval(() => {
    const session = gameSessions.get(sessionId);
    if (!session || session.status !== 'in_progress') {
      clearInterval(countdownInterval);
      return;
    }

    const remaining = session.getRemainingTime();

    io.to(`session_${sessionId}`).emit('countdown_update', {
      remaining: remaining,
      totalTime: session.timeLimit
    });

    if (remaining <= 0) {
      clearInterval(countdownInterval);
      handleQuestionTimeout(sessionId);
    }
  }, 1000);

  session.countdownInterval = countdownInterval;
}

function moveToNextQuestion(sessionId) {
  const session = gameSessions.get(sessionId);
  if (!session) return;

  if (session.countdownInterval) {
    clearInterval(session.countdownInterval);
  }

  if (session.gameTimer) {
    clearTimeout(session.gameTimer);
    session.gameTimer = null;
  }

  const hasNext = session.nextQuestion();

  if (hasNext) {
    const currentQuestion = session.getCurrentQuestion();
    const progress = session.getQuestionProgress();

    io.to(`session_${sessionId}`).emit('next_question', {
      question: currentQuestion.question,
      options: currentQuestion.options,
      questionNumber: progress.current,
      totalQuestions: progress.total,
      timeLimit: session.timeLimit,
      message: `Question ${progress.current} of ${progress.total}`,
      progress: progress.percentage
    });

    startCountdownTimer(sessionId);

  } else {
    endAllQuestions(sessionId);
  }
}

function handleQuestionTimeout(sessionId) {
  const session = gameSessions.get(sessionId);
  if (!session) return;

  const currentQuestion = session.getCurrentQuestion();
  
  io.to(`session_${sessionId}`).emit('question_timeout', {
    correctAnswer: currentQuestion.options[currentQuestion.correctAnswerIndex],
    message: `⏱️ Time's up! Answer was: ${currentQuestion.options[currentQuestion.correctAnswerIndex]}`,
    allPlayers: session.getPlayersData()
  });

  setTimeout(() => {
    moveToNextQuestion(sessionId);
  }, 3000);
}

function endAllQuestions(sessionId) {
  const session = gameSessions.get(sessionId);
  if (!session) return;

  if (session.countdownInterval) {
    clearInterval(session.countdownInterval);
  }

  session.endGame();

  const players = session.getPlayersData().map(player => ({
    id: player.userId,
    name: player.userName,
    score: player.score
  }));

  io.to(`session_${sessionId}`).emit('all_questions_ended', {
    players: players.sort((a, b) => b.score - a.score),
    message: '🎉 All questions completed! Game Over.'
  });

  broadcastSessionUpdate(sessionId);
}

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`[UNHANDLED_REJECTION]`);
});

process.on('uncaughtException', (error) => {
  logger.error(`[UNCAUGHT_EXCEPTION]`);
  process.exit(1);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`🎮 Guessing Game Server started`);
  console.log(`\n🎮 GUESSING GAME SERVER RUNNING\n`);
  console.log(`📍 URL: http://localhost:${PORT}\n`);
});

module.exports = server;