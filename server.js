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

      if (!session.gameRunning) {
        socket.emit('error', 'Cannot answer yet');
        return;
      }

      if (session.winner) {
        socket.emit('error', 'Someone already answered');
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

      // FIX: Check if player has attempts left
      if (!session.hasAttemptsLeft(socket.id)) {
        socket.emit('error', 'No more attempts!');
        return;
      }

      session.recordAnswer(socket.id, guessIndex);

      const isCorrect = guessIndex === currentQuestion.correctAnswerIndex;

      if (isCorrect) {
        // CORRECT ANSWER
        session.winner = socket.id;
        session.gameRunning = false;
        session.addScore(socket.id, 10);

        const newScore = session.getPlayerScore(socket.id);

        logger.info(`[CORRECT_ANSWER] ${user.username} answered correctly`);

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
        // WRONG ANSWER
        const attemptsLeft = session.getRemainingAttempts(socket.id);

        logger.info(`[WRONG_ANSWER] ${user.username} answered wrong. Attempts left: ${attemptsLeft}`);

        // Send to this player
        socket.emit('wrong_answer', {
          attemptsLeft: attemptsLeft,
          message: `❌ Wrong! ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} left.`
        });

        // Show answer stats to all
        broadcastAnswerStatistics(session.id);

        // Broadcast to others
        io.to(`session_${session.id}`).except(socket.id).emit('player_guessed_wrong', {
          username: user.username,
          attemptsLeft: attemptsLeft,
          message: `${user.username} guessed wrong (${attemptsLeft} attempts left)`
        });

        // Update live leaderboard
        io.to(`session_${session.id}`).emit('players_update', {
          players: session.getPlayersData()
        });

        // If out of attempts
        if (attemptsLeft === 0) {
          logger.info(`[OUT_OF_ATTEMPTS] ${user.username} is out of attempts`);
          socket.emit('out_of_attempts', {
            message: 'You are out of attempts!'
          });
        }
      }

    } catch (error) {
      logger.error(`[ERROR] Error in make_guess`);
      socket.emit('error', 'Error making guess');
    }
  });