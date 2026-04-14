const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const GameSession = require('./classes/GameSession');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Store all game sessions
const gameSessions = new Map();

// Store user info
const users = new Map();

// Socket.IO connection
io.on('connection', (socket) => {
  console.log(`New user connected: ${socket.id}`);

  // User joins server
  socket.on('user_join', (userData) => {
    try {
      // Validate username
      if (!userData.username || userData.username.trim() === '') {
        socket.emit('error', 'Username cannot be empty');
        return;
      }

      users.set(socket.id, {
        username: userData.username,
        score: 0,
        currentSessionId: null
      });

      socket.emit('user_joined', {
        userId: socket.id,
        username: userData.username,
        message: `Welcome ${userData.username}!`
      });

      // Broadcast to all users
      io.emit('users_list_updated', Array.from(users.values()).map((user, index) => ({
        id: Array.from(users.keys())[index],
        username: user.username,
        score: user.score
      })));

      console.log(`User ${userData.username} joined. Total users: ${users.size}`);
    } catch (error) {
      socket.emit('error', 'Error joining server');
      console.error('Error in user_join:', error);
    }
  });

  // Get all active sessions
  socket.on('get_sessions', () => {
    try {
      const sessions = Array.from(gameSessions.values()).map(session => ({
        id: session.id,
        name: session.name,
        gameMasterId: session.gameMasterId,
        gameMasterName: users.get(session.gameMasterId)?.username || 'Unknown',
        playerCount: session.players.size,
        maxPlayers: session.maxPlayers,
        status: session.status,
        createdAt: session.createdAt
      }));

      socket.emit('sessions_list', sessions);
    } catch (error) {
      socket.emit('error', 'Error fetching sessions');
      console.error('Error in get_sessions:', error);
    }
  });

  // Create new game session
  socket.on('create_session', (data) => {
    try {
      // Validate input
      if (!data.sessionName || data.sessionName.trim() === '') {
        socket.emit('error', 'Session name cannot be empty');
        return;
      }

      const user = users.get(socket.id);
      if (!user) {
        socket.emit('error', 'User not found');
        return;
      }

      const session = new GameSession(
        data.sessionName,
        socket.id,
        user.username,
        data.maxPlayers || 10
      );

      gameSessions.set(session.id, session);
      session.addPlayer(socket.id, user.username);
      user.currentSessionId = session.id;

      // Join socket room
      socket.join(`session_${session.id}`);

      socket.emit('session_created', {
        sessionId: session.id,
        sessionName: session.name,
        status: 'waiting'
      });

      // Notify all about new session
      io.emit('session_created_broadcast', {
        id: session.id,
        name: session.name,
        gameMasterName: user.username,
        playerCount: 1,
        status: 'waiting'
      });

      // Update session info for users in the session
      broadcastSessionUpdate(session.id);

      console.log(`Session created: ${session.name} by ${user.username}`);
    } catch (error) {
      socket.emit('error', 'Error creating session');
      console.error('Error in create_session:', error);
    }
  });

  // Join existing session
  socket.on('join_session', (data) => {
    try {
      const { sessionId } = data;
      const session = gameSessions.get(sessionId);
      const user = users.get(socket.id);

      // Validate
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      if (!user) {
        socket.emit('error', 'User not found');
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

      // Add player
      session.addPlayer(socket.id, user.username);
      user.currentSessionId = sessionId;
      socket.join(`session_${sessionId}`);

      socket.emit('session_joined', {
        sessionId: session.id,
        sessionName: session.name,
        playerCount: session.players.size,
        gameMasterName: users.get(session.gameMasterId)?.username
      });

      // Notify others in session
      io.to(`session_${sessionId}`).emit('player_joined', {
        username: user.username,
        playerCount: session.players.size,
        message: `${user.username} joined the game`
      });

      // Update session info
      broadcastSessionUpdate(sessionId);

      console.log(`${user.username} joined session ${session.name}. Players: ${session.players.size}`);
    } catch (error) {
      socket.emit('error', 'Error joining session');
      console.error('Error in join_session:', error);
    }
  });

  // Leave session
  socket.on('leave_session', () => {
    try {
      const user = users.get(socket.id);
      if (!user || !user.currentSessionId) {
        socket.emit('error', 'Not in any session');
        return;
      }

      const session = gameSessions.get(user.currentSessionId);
      if (!session) {
        user.currentSessionId = null;
        return;
      }

      const wasGameMaster = session.gameMasterId === socket.id;

      // Remove player
      session.removePlayer(socket.id);
      user.currentSessionId = null;
      socket.leave(`session_${session.id}`);

      // Notify others
      io.to(`session_${session.id}`).emit('player_left', {
        username: user.username,
        playerCount: session.players.size,
        message: `${user.username} left the game`
      });

      // If game master left, assign new one or delete session
      if (wasGameMaster) {
        if (session.players.size > 0) {
          const newMasterId = Array.from(session.players.keys())[0];
          session.gameMasterId = newMasterId;
          io.to(`session_${session.id}`).emit('game_master_changed', {
            newGameMasterName: users.get(newMasterId)?.username
          });
        } else {
          gameSessions.delete(session.id);
          io.emit('session_deleted', { sessionId: session.id });
        }
      }

      // If session is empty, delete it
      if (session.players.size === 0) {
        gameSessions.delete(session.id);
        io.emit('session_deleted', { sessionId: session.id });
      } else {
        broadcastSessionUpdate(session.id);
      }

      console.log(`${user.username} left session. Players remaining: ${session.players.size}`);
    } catch (error) {
      socket.emit('error', 'Error leaving session');
      console.error('Error in leave_session:', error);
    }
  });

  // Game master creates question
  socket.on('create_question', (data) => {
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

      // Validate input
      if (!data.question || data.question.trim() === '') {
        socket.emit('error', 'Question cannot be empty');
        return;
      }

      if (!data.answer || data.answer.trim() === '') {
        socket.emit('error', 'Answer cannot be empty');
        return;
      }

      session.setQuestion(data.question, data.answer.toLowerCase().trim());

      socket.emit('question_created', {
        message: 'Question created successfully'
      });

      console.log(`Question created in session ${session.name}`);
    } catch (error) {
      socket.emit('error', 'Error creating question');
      console.error('Error in create_question:', error);
    }
  });

  // Game master starts game
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

      if (!session.question || !session.answer) {
        socket.emit('error', 'Please create a question first');
        return;
      }

      if (session.players.size < 3) {
        socket.emit('error', 'Need at least 3 players to start the game');
        return;
      }

      // Start game
      session.startGame();

      io.to(`session_${session.id}`).emit('game_started', {
        question: session.question,
        timeLimit: session.timeLimit,
        attempts: 3,
        message: 'Game started! You have 3 attempts to guess the answer.'
      });

      // Set timer for game session
      session.gameTimer = setTimeout(() => {
        handleGameTimeout(session.id);
      }, session.timeLimit * 1000);

      console.log(`Game started in session ${session.name}`);
    } catch (error) {
      socket.emit('error', 'Error starting game');
      console.error('Error in start_game:', error);
    }
  });

  // Player makes a guess
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

      if (session.winner) {
        socket.emit('error', 'Game has already ended');
        return;
      }

      if (!data.guess || data.guess.trim() === '') {
        socket.emit('error', 'Please enter a guess');
        return;
      }

      const guess = data.guess.toLowerCase().trim();
      const playerGuess = session.getPlayerGuess(socket.id);

      if (!playerGuess) {
        socket.emit('error', 'Player data not found');
        return;
      }

      if (playerGuess.attempts <= 0) {
        socket.emit('error', 'You have no more attempts');
        return;
      }

      const isCorrect = guess === session.answer;

      if (isCorrect) {
        // Correct answer
        session.winner = socket.id;
        user.score += 10;

        // Clear timer
        if (session.gameTimer) {
          clearTimeout(session.gameTimer);
        }

        io.to(`session_${session.id}`).emit('correct_answer', {
          winner: user.username,
          answer: session.answer,
          winnerScore: user.score,
          message: `🎉 ${user.username} got the correct answer!`
        });

        // Wait 3 seconds then end game
        setTimeout(() => {
          endGameSession(session.id);
        }, 3000);
      } else {
        // Incorrect answer
        playerGuess.attempts--;

        socket.emit('incorrect_answer', {
          attemptsLeft: playerGuess.attempts,
          message: `Wrong answer! ${playerGuess.attempts} attempts left.`
        });

        io.to(`session_${session.id}`).emit('player_guessed_wrong', {
          username: user.username,
          attemptsLeft: playerGuess.attempts
        });

        // If no attempts left
        if (playerGuess.attempts === 0) {
          socket.emit('no_attempts', {
            message: 'You are out of attempts!'
          });
        }
      }
    } catch (error) {
      socket.emit('error', 'Error making guess');
      console.error('Error in make_guess:', error);
    }
  });

  // Get session details
  socket.on('get_session_details', () => {
    try {
      const user = users.get(socket.id);
      if (!user || !user.currentSessionId) {
        socket.emit('error', 'Not in any session');
        return;
      }

      const session = gameSessions.get(user.currentSessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      const players = Array.from(session.players.entries()).map(([playerId, playerName]) => {
        const playerUser = users.get(playerId);
        const playerGuess = session.getPlayerGuess(playerId);
        return {
          id: playerId,
          name: playerName,
          score: playerUser?.score || 0,
          attempts: playerGuess?.attempts || 3,
          isGameMaster: session.gameMasterId === playerId
        };
      });

      socket.emit('session_details', {
        sessionId: session.id,
        sessionName: session.name,
        status: session.status,
        question: session.status === 'in_progress' ? session.question : null,
        gameMasterName: users.get(session.gameMasterId)?.username,
        players: players,
        playerCount: session.players.size,
        timeRemaining: session.timeRemaining
      });
    } catch (error) {
      socket.emit('error', 'Error fetching session details');
      console.error('Error in get_session_details:', error);
    }
  });

  // Get leaderboard
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
      socket.emit('error', 'Error fetching leaderboard');
      console.error('Error in get_leaderboard:', error);
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    try {
      const user = users.get(socket.id);
      if (user) {
        console.log(`User disconnected: ${user.username}`);

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
                message: `${user.username} left the game`
              });

              if (wasGameMaster) {
                const newMasterId = Array.from(session.players.keys())[0];
                session.gameMasterId = newMasterId;
                io.to(`session_${session.id}`).emit('game_master_changed', {
                  newGameMasterName: users.get(newMasterId)?.username
                });
              }

              broadcastSessionUpdate(session.id);
            } else {
              gameSessions.delete(session.id);
              io.emit('session_deleted', { sessionId: session.id });
            }
          }
        }

        users.delete(socket.id);
        io.emit('users_list_updated', Array.from(users.values()).map((user, index) => ({
          id: Array.from(users.keys())[index],
          username: user.username,
          score: user.score
        })));
      }
    } catch (error) {
      console.error('Error in disconnect:', error);
    }
  });
});

// Helper functions
function broadcastSessionUpdate(sessionId) {
  const session = gameSessions.get(sessionId);
  if (!session) return;

  const players = Array.from(session.players.entries()).map(([playerId, playerName]) => {
    const playerUser = users.get(playerId);
    return {
      id: playerId,
      name: playerName,
      score: playerUser?.score || 0,
      isGameMaster: session.gameMasterId === playerId
    };
  });

  io.to(`session_${sessionId}`).emit('session_updated', {
    sessionId: session.id,
    sessionName: session.name,
    players: players,
    playerCount: session.players.size,
    status: session.status
  });
}

function handleGameTimeout(sessionId) {
  const session = gameSessions.get(sessionId);
  if (!session) return;

  session.winner = null;

  io.to(`session_${sessionId}`).emit('game_timeout', {
    answer: session.answer,
    message: '⏱️ Time is up! Game ended.',
    noWinner: true
  });

  // Wait 3 seconds then end game
  setTimeout(() => {
    endGameSession(sessionId);
  }, 3000);
}

function endGameSession(sessionId) {
  const session = gameSessions.get(sessionId);
  if (!session) return;

  session.endGame();

  const players = Array.from(session.players.entries()).map(([playerId, playerName]) => {
    const playerUser = users.get(playerId);
    return {
      id: playerId,
      name: playerName,
      score: playerUser?.score || 0
    };
  });

  io.to(`session_${sessionId}`).emit('game_ended', {
    players: players,
    message: 'Game session ended. Waiting for next question...'
  });

  broadcastSessionUpdate(sessionId);
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Guessing Game Server running on http://localhost:${PORT}`);
  console.log('Waiting for players...');
});