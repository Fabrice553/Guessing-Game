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
// Morgan HTTP Logging
app.use(morgan('combined', {
  stream: {
    write: (message) => {
      logger.info(message.trim());
    }
  }
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);
app.use(express.static(path.join(__dirname, 'public')));

// ===== STATE MANAGEMENT =====
const gameSessions = new Map(); // sessionId -> GameSession
const users = new Map(); // socketId -> user
const socketIpMap = new Map(); // socketId -> IP

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

      // Validate username
      const validation = Validator.validateUsername(userData?.username);
      if (!validation.valid) {
        logger.warn(`[VALIDATION] Username validation failed`, { socketId: socket.id, error: validation.error });
        socket.emit('error', validation.error);
        return;
      }

      // Check duplicate username
      const duplicateUser = Array.from(users.values()).find(
        u => u.username.toLowerCase() === userData.username.toLowerCase()
      );

      if (duplicateUser) {
        logger.warn(`[VALIDATION] Duplicate username`, { username: userData.username });
        socket.emit('error', 'Username already taken');
        return;
      }

      // Add user
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

      // Broadcast users list
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

      // Validate session name
      const validation = Validator.validateSessionName(data?.sessionName);
      if (!validation.valid) {
        logger.warn(`[VALIDATION] Session name validation failed`, { error: validation.error });
        socket.emit('error', validation.error);
        return;
      }

      // Create session
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

      // Broadcast new session
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

      // Validation checks
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

      // Add player
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

      // Notify others in session
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

      // Notify others
      io.to(`session_${session.id}`).emit('player_left', {
        username: user.username,
        playerCount: session.players.size,
        message: `${user.username} left the game`
      });

      // Handle game master departure
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

      // Delete session if empty
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

  // ===== CREATE QUESTION =====
  socket.on('create_question', (data) => {
    try {
      const user = users.get(socket.id);
      if (!user || !user.currentSessionId) {
        logger.warn(`[VALIDATION] User not in session on create_question`, { socketId: socket.id });
        socket.emit('error', 'User not in session');
        return;
      }

      const session = gameSessions.get(user.currentSessionId);
      if (!session) {
        logger.warn(`[VALIDATION] Session not found on create_question`, { sessionId: user.currentSessionId });
        socket.emit('error', 'Session not found');
        return;
      }

      if (session.gameMasterId !== socket.id) {
        logger.warn(`[VALIDATION] Non-master attempted to create question`, { socketId: socket.id });
        socket.emit('error', 'Only game master can create questions');
        return;
      }

      logger.info(`[EVENT] create_question initiated`, { socketId: socket.id, sessionId: session.id });

      // Validate question and answer
      const qValidation = Validator.validateQuestion(data?.question);
      if (!qValidation.valid) {
        logger.warn(`[VALIDATION] Question validation failed`, { error: qValidation.error });
        socket.emit('error', qValidation.error);
        return;
      }

      const aValidation = Validator.validateAnswer(data?.answer);
      if (!aValidation.valid) {
        logger.warn(`[VALIDATION] Answer validation failed`, { error: aValidation.error });
        socket.emit('error', aValidation.error);
        return;
      }

      // Set question
      const result = session.setQuestion(data.question, data.answer);
      if (!result) {
        logger.error(`[ERROR] Failed to set question`, { sessionId: session.id });
        socket.emit('error', 'Failed to create question');
        return;
      }

      logger.game(`[QUESTION_CREATED] Game master created question`, {
        sessionId: session.id,
        gameMaster: user.username,
        questionLength: data.question.length
      });

      socket.emit('question_created', {
        message: 'Question created successfully'
      });

    } catch (error) {
      logger.error(`[ERROR] Error in create_question`, { socketId: socket.id, error: error.message });
      socket.emit('error', 'Error creating question');
    }
  });

  // ===== START GAME =====
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

      // Validation checks
      if (session.gameMasterId !== socket.id) {
        logger.warn(`[VALIDATION] Non-master attempted to start game`, { socketId: socket.id });
        socket.emit('error', 'Only game master can start game');
        return;
      }

      if (!session.question || !session.answer) {
        logger.warn(`[VALIDATION] Attempt to start game without question`, { sessionId: session.id });
        socket.emit('error', 'Please create a question first');
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

      // Start game
      session.startGame();

      logger.game(`[GAME_STARTED] Game started in session`, {
        sessionId: session.id,
        gameMaster: user.username,
        players: session.players.size,
        question: session.question
      });

      io.to(`session_${session.id}`).emit('game_started', {
        question: session.question,
        timeLimit: session.timeLimit,
        attempts: 3,
        message: 'Game started! You have 3 attempts to guess the answer.',
        roundNumber: session.roundCount
      });

      // Set game timer
      session.gameTimer = setTimeout(() => {
        handleGameTimeout(session.id);
      }, session.timeLimit * 1000);

    } catch (error) {
      logger.error(`[ERROR] Error in start_game`, { socketId: socket.id, error: error.message });
      socket.emit('error', 'Error starting game');
    }
  });

  // ===== MAKE GUESS =====
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

      if (session.winner) {
        logger.warn(`[VALIDATION] Game already has winner`, { sessionId: session.id });
        socket.emit('error', 'Game has already ended');
        return;
      }

      // Validate guess
      const validation = Validator.validateGuess(data?.guess);
      if (!validation.valid) {
        logger.warn(`[VALIDATION] Guess validation failed`, { error: validation.error });
        socket.emit('error', validation.error);
        return;
      }

      const guess = data.guess.toLowerCase().trim();
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
        isCorrect: guess === session.answer
      });

      const isCorrect = guess === session.answer;

      if (isCorrect) {
        // CORRECT ANSWER
        session.winner = socket.id;
        session.addScore(socket.id, 10);
        const newScore = session.getPlayerScore(socket.id);

        // Clear timer
        if (session.gameTimer) {
          clearTimeout(session.gameTimer);
          session.gameTimer = null;
        }

        logger.game(`[GAME_WON] Correct answer guessed`, {
          sessionId: session.id,
          winner: user.username,
          newScore: newScore,
          answer: session.answer
        });

        io.to(`session_${session.id}`).emit('correct_answer', {
          winner: user.username,
          answer: session.answer,
          winnerScore: newScore,
          message: `🎉 ${user.username} got the correct answer! +10 points`
        });

        // Wait then end game
        setTimeout(() => {
          endGameSession(session.id);
        }, 3000);

      } else {
        // INCORRECT ANSWER
        const attemptsLeft = playerGuess.attempts - 1;
        session.recordGuess(socket.id, guess);

        logger.info(`[GUESS] Incorrect guess recorded`, {
          username: user.username,
          attemptsLeft: attemptsLeft,
          sessionId: session.id
        });

        socket.emit('incorrect_answer', {
          attemptsLeft: attemptsLeft,
          message: `❌ Wrong answer! ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} left.`
        });

        io.to(`session_${session.id}`).emit('player_guessed_wrong', {
          username: user.username,
          attemptsLeft: attemptsLeft
        });

        if (attemptsLeft === 0) {
          logger.info(`[GUESS] Player out of attempts`, {
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
        question: session.status === 'in_progress' ? session.question : null,
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

        // Leave session if in one
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

function handleGameTimeout(sessionId) {
  const session = gameSessions.get(sessionId);
  if (!session) return;

  logger.game(`[GAME_TIMEOUT] Game time expired`, { sessionId: sessionId });

  session.winner = null;
  session.endGame();

  io.to(`session_${sessionId}`).emit('game_timeout', {
    answer: session.answer,
    message: '⏱️ Time is up! No one got the answer.',
    noWinner: true
  });

  setTimeout(() => {
    endGameSession(sessionId);
  }, 3000);
}

function endGameSession(sessionId) {
  const session = gameSessions.get(sessionId);
  if (!session) return;

  logger.game(`[GAME_ENDED] Game session ended`, {
    sessionId: sessionId,
    winner: session.winner ? users.get(session.winner)?.username : 'None',
    answer: session.answer
  });

  session.endGame();

  const players = session.getPlayersData().map(player => ({
    id: player.userId,
    name: player.userName,
    score: player.score
  }));

  io.to(`session_${sessionId}`).emit('game_ended', {
    players: players,
    answer: session.answer,
    message: 'Game session ended. Waiting for next question...'
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