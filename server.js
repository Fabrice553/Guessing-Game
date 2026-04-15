const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const Logger = require('./utils/Logger');
const Validator = require('./utils/Validator');
const GameSession = require('./classes/GameSession');

// ===== INITIALIZATION =====
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const logger = new Logger();

// ===== MIDDLEWARE =====
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

// ===== STATE MANAGEMENT =====
const gameSessions = new Map();
const users = new Map();
const socketIpMap = new Map();

// ===== SOCKET.IO =====
io.on('connection', (socket) => {
  const clientIp = socket.handshake.address;
  socketIpMap.set(socket.id, clientIp);

  logger.info(`[CONNECTION] New socket connected`, {
    socketId: socket.id,
    ip: clientIp,
    totalConnected: io.engine.clientsCount
  });

  // ===== USER JOIN =====
  socket.on('user_join', (userData) => {
    try {
      logger.info(`[EVENT] user_join initiated`, { socketId: socket.id, username: userData?.username });

      const validation = Validator.validateUsername(userData?.username);
      if (!validation.valid) {
        logger.warn(`[VALIDATION] Username validation failed`, { socketId: socket.id, error: validation.error });
        socket.emit('error', validation.error);
        return;
      }

      const duplicateUser = Array.from(users.values()).find(
        u => u.username.toLowerCase() === userData.username.toLowerCase()
      );

      if (duplicateUser) {
        logger.warn(`[VALIDATION] Duplicate username`, { username: userData.username });
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

      logger.info(`[USER] User joined successfully`, {
        socketId: socket.id,
        username: userData.username,
        totalUsers: users.size
      });

      socket.emit('user_joined', {
        userId: socket.id,
        username: userData.username,
        message: `Welcome ${userData.username}!`
      });

      broadcastUsersList();

    } catch (error) {
      logger.error(`[ERROR] Error in user_join`, { socketId: socket.id, error: error.message });
      socket.emit('error', 'Error joining server');
    }
  });

  // ===== GET SESSIONS =====
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

      logger.debug(`[SESSION] Retrieved ${sessions.length} sessions`);
      socket.emit('sessions_list', sessions);
    } catch (error) {
      logger.error(`[ERROR] Error in get_sessions`, { socketId: socket.id, error: error.message });
      socket.emit('error', 'Error fetching sessions');
    }
  });

  // ===== CREATE SESSION =====
  socket.on('create_session', (data) => {
    try {
      const user = users.get(socket.id);
      if (!user) {
        logger.warn(`[VALIDATION] User not found on create_session`, { socketId: socket.id });
        socket.emit('error', 'User not found');
        return;
      }

      logger.info(`[EVENT] create_session initiated`, { socketId: socket.id, sessionName: data?.sessionName });

      const validation = Validator.validateSessionName(data?.sessionName);
      if (!validation.valid) {
        logger.warn(`[VALIDATION] Session name validation failed`, { error: validation.error });
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
      session.addPlayer(socket.id, user.username);
      user.currentSessionId = session.id;

      socket.join(`session_${session.id}`);

      logger.game(`[SESSION_CREATED] New game session created`, {
        sessionId: session.id,
        sessionName: session.name,
        gameMaster: user.username,
        maxPlayers: maxPlayers
      });

      socket.emit('session_created', {
        sessionId: session.id,
        sessionName: session.name,
        status: 'waiting'
      });

      io.emit('session_created_broadcast', {
        id: session.id,
        name: session.name,
        gameMasterName: user.username,
        playerCount: 1,
        maxPlayers: maxPlayers,
        status: 'waiting'
      });

      broadcastSessionsUpdate();
    } catch (error) {
      logger.error(`[ERROR] Error in create_session`, { socketId: socket.id, error: error.message });
      socket.emit('error', 'Error creating session');
    }
  });

  // ===== JOIN SESSION =====
  socket.on('join_session', (data) => {
    try {
      const user = users.get(socket.id);
      if (!user) {
        logger.warn(`[VALIDATION] User not found on join_session`, { socketId: socket.id });
        socket.emit('error', 'User not found');
        return;
      }

      const session = gameSessions.get(data?.sessionId);
      if (!session) {
        logger.warn(`[VALIDATION] Session not found`, { sessionId: data?.sessionId });
        socket.emit('error', 'Session not found');
        return;
      }

      logger.info(`[EVENT] join_session initiated`, {
        socketId: socket.id,
        username: user.username,
        sessionId: session.id
      });

      if (session.status === 'in_progress') {
        logger.warn(`[VALIDATION] Attempt to join in-progress session`, { sessionId: session.id });
        socket.emit('error', 'Game is already in progress');
        return;
      }

      if (session.players.has(socket.id)) {
        logger.warn(`[VALIDATION] User already in session`, { socketId: socket.id, sessionId: session.id });
        socket.emit('error', 'You are already in this session');
        return;
      }

      if (session.players.size >= session.maxPlayers) {
        logger.warn(`[VALIDATION] Session is full`, { sessionId: session.id });
        socket.emit('error', 'Session is full');
        return;
      }

      session.addPlayer(socket.id, user.username);
      user.currentSessionId = session.id;
      socket.join(`session_${session.id}`);

      logger.game(`[PLAYER_JOINED] Player joined session`, {
        sessionId: session.id,
        player: user.username,
        totalPlayers: session.players.size
      });

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
      logger.error(`[ERROR] Error in join_session`, { socketId: socket.id, error: error.message });
      socket.emit('error', 'Error joining session');
    }
  });

  // ===== LEAVE SESSION =====
  socket.on('leave_session', () => {
    try {
      const user = users.get(socket.id);
      if (!user || !user.currentSessionId) {
        logger.warn(`[VALIDATION] User not in session on leave`, { socketId: socket.id });
        return;
      }

      const session = gameSessions.get(user.currentSessionId);
      if (!session) {
        user.currentSessionId = null;
        return;
      }

      logger.info(`[EVENT] leave_session initiated`, {
        socketId: socket.id,
        username: user.username,
        sessionId: session.id
      });

      const wasGameMaster = session.gameMasterId === socket.id;
      const sessionId = session.id;

      session.removePlayer(socket.id);
      user.currentSessionId = null;
      socket.leave(`session_${session.id}`);

      logger.game(`[PLAYER_LEFT] Player left session`, {
        sessionId: sessionId,
        player: user.username,
        wasGameMaster: wasGameMaster,
        remainingPlayers: session.players.size
      });

      io.to(`session_${session.id}`).emit('player_left', {
        username: user.username,
        playerCount: session.players.size,
        message: `${user.username} left the game`
      });

      if (wasGameMaster) {
        if (session.players.size > 0) {
          const newMasterId = Array.from(session.players.keys())[0];
          session.gameMasterId = newMasterId;
          const newMasterUser = users.get(newMasterId);

          logger.game(`[GAME_MASTER_CHANGED] New game master assigned`, {
            sessionId: sessionId,
            newMaster: newMasterUser?.username
          });

          io.to(`session_${session.id}`).emit('game_master_changed', {
            newGameMasterName: newMasterUser?.username
          });
        } else {
          gameSessions.delete(session.id);
          logger.game(`[SESSION_DELETED] Session deleted (no players)`, { sessionId: sessionId });
          io.emit('session_deleted', { sessionId: sessionId });
          broadcastSessionsUpdate();
          return;
        }
      }

      if (session.players.size === 0) {
        gameSessions.delete(session.id);
        logger.game(`[SESSION_DELETED] Session deleted (last player left)`, { sessionId: sessionId });
        io.emit('session_deleted', { sessionId: sessionId });
      } else {
        broadcastSessionUpdate(session.id);
      }

      broadcastSessionsUpdate();

    } catch (error) {
      logger.error(`[ERROR] Error in leave_session`, { socketId: socket.id, error: error.message });
    }
  });

  // ===== CREATE MULTIPLE QUESTIONS (NEW) =====
  socket.on('create_questions', (data) => {
    try {
      const user = users.get(socket.id);
      if (!user || !user.currentSessionId) {
        logger.warn(`[VALIDATION] User not in session on create_questions`, { socketId: socket.id });
        socket.emit('error', 'User not in session');
        return;
      }

      const session = gameSessions.get(user.currentSessionId);
      if (!session) {
        logger.warn(`[VALIDATION] Session not found on create_questions`, { sessionId: user.currentSessionId });
        socket.emit('error', 'Session not found');
        return;
      }

      if (session.gameMasterId !== socket.id) {
        logger.warn(`[VALIDATION] Non-master attempted to create questions`, { socketId: socket.id });
        socket.emit('error', 'Only game master can create questions');
        return;
      }

      if (!data.questions || data.questions.length === 0) {
        logger.warn(`[VALIDATION] No questions provided`, { socketId: socket.id });
        socket.emit('error', 'Add at least 1 question');
        return;
      }

      // Validate and add all questions
      let addedCount = 0;
      data.questions.forEach(q => {
        const result = session.addQuestion(q.question, q.options, q.correctAnswerIndex);
        if (result) addedCount++;
      });

      if (addedCount === 0) {
        logger.warn(`[VALIDATION] No valid questions to add`, { socketId: socket.id });
        socket.emit('error', 'No valid questions');
        return;
      }

      logger.game(`[QUESTIONS_CREATED] Game master created ${addedCount} questions`, {
        sessionId: session.id,
        gameMaster: user.username,
        questionCount: addedCount
      });

      socket.emit('questions_created', {
        count: addedCount,
        message: `${addedCount} questions ready!`
      });

    } catch (error) {
      logger.error(`[ERROR] Error in create_questions`, { socketId: socket.id, error: error.message });
      socket.emit('error', 'Error creating questions');
    }
  });

  // ===== START GAME (UPDATED FOR MULTIPLE QUESTIONS) =====
  socket.on('start_game', () => {
    try {
      const user = users.get(socket.id);
      if (!user || !user.currentSessionId) {
        logger.warn(`[VALIDATION] User not in session on start_game`, { socketId: socket.id });
        socket.emit('error', 'User not in session');
        return;
      }

      const session = gameSessions.get(user.currentSessionId);
      if (!session) {
        logger.warn(`[VALIDATION] Session not found on start_game`, { sessionId: user.currentSessionId });
        socket.emit('error', 'Session not found');
        return;
      }

      logger.info(`[EVENT] start_game initiated`, { socketId: socket.id, sessionId: session.id });

      if (session.gameMasterId !== socket.id) {
        logger.warn(`[VALIDATION] Non-master attempted to start game`, { socketId: socket.id });
        socket.emit('error', 'Only game master can start game');
        return;
      }

      if (session.getTotalQuestions() === 0) {
        logger.warn(`[VALIDATION] No questions prepared`, { sessionId: session.id });
        socket.emit('error', 'Please prepare questions first');
        return;
      }

      if (session.players.size < 3) {
        logger.warn(`[VALIDATION] Not enough players`, {
          sessionId: session.id,
          players: session.players.size
        });
        socket.emit('error', 'Need at least 3 players to start the game');
        return;
      }

      session.startGame();
      session.currentQuestionIndex = 0;

      logger.game(`[GAME_STARTED] Game started in session`, {
        sessionId: session.id,
        gameMaster: user.username,
        players: session.players.size,
        totalQuestions: session.getTotalQuestions()
      });

      const currentQuestion = session.getCurrentQuestion();
      
      io.to(`session_${session.id}`).emit('game_started', {
        question: currentQuestion.question,
        options: currentQuestion.options,
        questionNumber: 1,
        totalQuestions: session.getTotalQuestions(),
        timeLimit: session.timeLimit,
        attempts: 3,
        message: `Game started! ${session.getTotalQuestions()} questions. 60 seconds per question.`,
        roundNumber: session.roundCount
      });

      session.gameTimer = setTimeout(() => {
        handleQuestionTimeout(session.id);
      }, session.timeLimit * 1000);

    } catch (error) {
      logger.error(`[ERROR] Error in start_game`, { socketId: socket.id, error: error.message });
      socket.emit('error', 'Error starting game');
    }
  });

  // ===== MAKE GUESS (UPDATED FOR MULTIPLE CHOICE) =====
  socket.on('make_guess', (data) => {
    try {
      const user = users.get(socket.id);
      if (!user || !user.currentSessionId) {
        logger.warn(`[VALIDATION] User not in session on make_guess`, { socketId: socket.id });
        socket.emit('error', 'User not in session');
        return;
      }

      const session = gameSessions.get(user.currentSessionId);
      if (!session) {
        logger.warn(`[VALIDATION] Session not found on make_guess`, { sessionId: user.currentSessionId });
        socket.emit('error', 'Session not found');
        return;
      }

      if (session.status !== 'in_progress') {
        logger.warn(`[VALIDATION] Game not in progress`, { sessionId: session.id });
        socket.emit('error', 'Game is not in progress');
        return;
      }

      const currentQuestion = session.getCurrentQuestion();
      if (!currentQuestion) {
        logger.warn(`[VALIDATION] No current question`, { sessionId: session.id });
        socket.emit('error', 'No more questions');
        return;
      }

      const guessIndex = parseInt(data.guess);
      
      if (isNaN(guessIndex) || guessIndex < 0 || guessIndex >= currentQuestion.options.length) {
        logger.warn(`[VALIDATION] Invalid guess index`, { guessIndex });
        socket.emit('error', 'Invalid selection');
        return;
      }

      const playerGuess = session.getPlayerGuess(socket.id);

      if (!playerGuess) {
        logger.warn(`[VALIDATION] Player data not found`, { socketId: socket.id });
        socket.emit('error', 'Player data not found');
        return;
      }

      if (playerGuess.attempts <= 0) {
        logger.warn(`[VALIDATION] Player out of attempts`, { socketId: socket.id });
        socket.emit('error', 'You have no more attempts');
        return;
      }

      logger.info(`[GUESS] Player made guess`, {
        socketId: socket.id,
        username: user.username,
        sessionId: session.id,
        selectedOption: guessIndex,
        correctOption: currentQuestion.correctAnswerIndex,
        isCorrect: guessIndex === currentQuestion.correctAnswerIndex
      });

      const isCorrect = guessIndex === currentQuestion.correctAnswerIndex;

      if (isCorrect) {
        session.addScore(socket.id, 10);
        const newScore = session.getPlayerScore(socket.id);

        logger.game(`[CORRECT_ANSWER] Correct answer`, {
          sessionId: session.id,
          winner: user.username,
          newScore: newScore,
          correctAnswer: currentQuestion.options[currentQuestion.correctAnswerIndex]
        });

        io.to(`session_${session.id}`).emit('correct_answer', {
          player: user.username,
          correctAnswer: currentQuestion.options[guessIndex],
          playerScore: newScore,
          message: `✅ ${user.username} got it right! +10 points`
        });

        // Broadcast leaderboard to all (Game Master sees live updates)
        broadcastLiveLeaderboard(session.id);

        setTimeout(() => {
          moveToNextQuestion(session.id);
        }, 2000);

      } else {
        const attemptsLeft = playerGuess.attempts - 1;
        session.recordGuess(socket.id, guessIndex);

        logger.info(`[WRONG_ANSWER] Wrong answer recorded`, {
          username: user.username,
          selectedOption: currentQuestion.options[guessIndex],
          attemptsLeft: attemptsLeft,
          sessionId: session.id
        });

        socket.emit('incorrect_answer', {
          attemptsLeft: attemptsLeft,
          message: `❌ Wrong! ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} left.`
        });

        io.to(`session_${session.id}`).emit('player_guessed_wrong', {
          username: user.username,
          attemptsLeft: attemptsLeft
        });

        // Broadcast leaderboard after every guess
        broadcastLiveLeaderboard(session.id);

        if (attemptsLeft === 0) {
          logger.info(`[NO_ATTEMPTS] Player out of attempts`, {
            username: user.username,
            sessionId: session.id
          });
          socket.emit('no_attempts', {
            message: 'You are out of attempts!'
          });
        }
      }
    } catch (error) {
      logger.error(`[ERROR] Error in make_guess`, { socketId: socket.id, error: error.message });
      socket.emit('error', 'Error making guess');
    }
  });

  // ===== GET SESSION DETAILS =====
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
        attempts: player.attempts,
        isGameMaster: session.gameMasterId === player.userId
      }));

      socket.emit('session_details', {
        sessionId: session.id,
        sessionName: session.name,
        status: session.status,
        question: session.status === 'in_progress' ? session.getCurrentQuestion()?.question : null,
        gameMasterName: session.gameMasterName,
        players: players,
        playerCount: session.players.size,
        timeRemaining: session.timeRemaining,
        roundNumber: session.roundCount
      });
    } catch (error) {
      logger.error(`[ERROR] Error in get_session_details`, { socketId: socket.id, error: error.message });
    }
  });

  // ===== GET LEADERBOARD =====
  socket.on('get_leaderboard', () => {
    try {
      logger.info(`[EVENT] get_leaderboard requested`, { socketId: socket.id });

      const leaderboard = Array.from(users.entries())
        .map(([userId, userData]) => ({
          username: userData.username,
          score: userData.score
        }))
        .sort((a, b) => b.score - a.score);

      socket.emit('leaderboard', leaderboard);
    } catch (error) {
      logger.error(`[ERROR] Error in get_leaderboard`, { socketId: socket.id, error: error.message });
      socket.emit('error', 'Error fetching leaderboard');
    }
  });

  // ===== DISCONNECT =====
  socket.on('disconnect', () => {
    try {
      const user = users.get(socket.id);
      if (user) {
        logger.info(`[DISCONNECT] User disconnected`, {
          socketId: socket.id,
          username: user.username,
          totalUsers: users.size - 1
        });

        if (user.currentSessionId) {
          const session = gameSessions.get(user.currentSessionId);
          if (session) {
            const wasGameMaster = session.gameMasterId === socket.id;
            session.removePlayer(socket.id);

            if (session.players.size > 0) {
              io.to(`session_${session.id}`).emit('player_left', {
                username: user.username,
                playerCount: session.players.size,
                message: `${user.username} disconnected`
              });

              if (wasGameMaster) {
                const newMasterId = Array.from(session.players.keys())[0];
                session.gameMasterId = newMasterId;
                const newMasterUser = users.get(newMasterId);

                logger.game(`[GAME_MASTER_CHANGED] New master on disconnect`, {
                  sessionId: session.id,
                  newMaster: newMasterUser?.username
                });

                io.to(`session_${session.id}`).emit('game_master_changed', {
                  newGameMasterName: newMasterUser?.username
                });
              }

              broadcastSessionUpdate(session.id);
            } else {
              gameSessions.delete(session.id);
              logger.game(`[SESSION_DELETED] Session deleted on disconnect`, { sessionId: session.id });
              io.emit('session_deleted', { sessionId: session.id });
            }
          }
        }

        users.delete(socket.id);
        socketIpMap.delete(socket.id);
        broadcastUsersList();
        broadcastSessionsUpdate();
      }
    } catch (error) {
      logger.error(`[ERROR] Error in disconnect`, { socketId: socket.id, error: error.message });
    }
  });
});

// ===== HELPER FUNCTIONS =====
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
    isGameMaster: session.gameMasterId === player.userId
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

// NEW: Broadcast live leaderboard
function broadcastLiveLeaderboard(sessionId) {
  const session = gameSessions.get(sessionId);
  if (!session) return;

  const leaderboard = session.getPlayersData()
    .map(player => ({
      name: player.userName,
      score: player.score,
      isGameMaster: session.gameMasterId === player.userId
    }))
    .sort((a, b) => b.score - a.score);

  io.to(`session_${sessionId}`).emit('live_leaderboard_update', {
    leaderboard: leaderboard,
    timestamp: new Date()
  });
}

// NEW: Move to next question
function moveToNextQuestion(sessionId) {
  const session = gameSessions.get(sessionId);
  if (!session) return;

  if (session.gameTimer) {
    clearTimeout(session.gameTimer);
    session.gameTimer = null;
  }

  const hasNext = session.nextQuestion();

  if (hasNext) {
    const currentQuestion = session.getCurrentQuestion();
    const progress = session.getQuestionProgress();

    logger.game(`[NEXT_QUESTION] Moving to next question`, {
      sessionId: sessionId,
      questionNumber: progress.current,
      totalQuestions: progress.total
    });

    io.to(`session_${sessionId}`).emit('next_question', {
      question: currentQuestion.question,
      options: currentQuestion.options,
      questionNumber: progress.current,
      totalQuestions: progress.total,
      timeLimit: session.timeLimit,
      attempts: 3,
      message: `Question ${progress.current} of ${progress.total}`,
      progress: progress.percentage
    });

    session.gameTimer = setTimeout(() => {
      handleQuestionTimeout(sessionId);
    }, session.timeLimit * 1000);

  } else {
    endAllQuestions(sessionId);
  }
}

// NEW: Handle question timeout
function handleQuestionTimeout(sessionId) {
  const session = gameSessions.get(sessionId);
  if (!session) return;

  const currentQuestion = session.getCurrentQuestion();
  
  logger.game(`[QUESTION_TIMEOUT] Time expired for question`, {
    sessionId: sessionId,
    questionNumber: session.currentQuestionIndex + 1
  });

  io.to(`session_${sessionId}`).emit('question_timeout', {
    correctAnswer: currentQuestion.options[currentQuestion.correctAnswerIndex],
    message: `⏱️ Time's up! Answer was: ${currentQuestion.options[currentQuestion.correctAnswerIndex]}`
  });

  setTimeout(() => {
    moveToNextQuestion(sessionId);
  }, 3000);
}

// NEW: End all questions
function endAllQuestions(sessionId) {
  const session = gameSessions.get(sessionId);
  if (!session) return;

  logger.game(`[ALL_QUESTIONS_ENDED] All questions completed`, {
    sessionId: sessionId,
    totalQuestions: session.getTotalQuestions()
  });

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

// ===== ERROR HANDLING =====
process.on('unhandledRejection', (reason, promise) => {
  logger.error(`[UNHANDLED_REJECTION]`, { reason: reason?.toString?.() });
});

process.on('uncaughtException', (error) => {
  logger.error(`[UNCAUGHT_EXCEPTION]`, { message: error.message, stack: error.stack });
  process.exit(1);
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`🎮 Guessing Game Server started`, { port: PORT });
  console.log(`\n🎮 GUESSING GAME SERVER RUNNING\n`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`📊 Waiting for players...\n`);
});

module.exports = server;