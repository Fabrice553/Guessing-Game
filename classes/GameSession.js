const { v4: uuidv4 } = require('uuid');

class GameSession {
  constructor(name, gameMasterId, gameMasterName, maxPlayers = 10) {
    this.id = uuidv4();
    this.name = name;
    this.gameMasterId = gameMasterId;
    this.gameMasterName = gameMasterName;
    this.maxPlayers = maxPlayers;
    this.players = new Map(); // userId -> userName (EXCLUDES GAME MASTER)
    this.playerScores = new Map(); // userId -> score
    this.playerGuesses = new Map(); // userId -> {attempts, guesses, answered}
    
    this.questions = [];
    this.currentQuestionIndex = 0;
    
    this.status = 'waiting';
    this.timeLimit = 60;
    this.gameTimer = null;
    this.questionStartTime = null;
    this.createdAt = new Date();
    this.startedAt = null;
    this.endedAt = null;
    this.roundCount = 0;
  }

  addPlayer(userId, userName) {
    if (this.players.size >= this.maxPlayers) {
      return false;
    }
    this.players.set(userId, userName);
    this.playerScores.set(userId, 0);
    this.playerGuesses.set(userId, {
      attempts: 3,
      guesses: [],
      answered: false // NEW: Track if player answered current question
    });
    return true;
  }

  removePlayer(userId) {
    this.players.delete(userId);
    this.playerScores.delete(userId);
    this.playerGuesses.delete(userId);
  }

  addQuestion(question, options, correctAnswerIndex) {
    if (!question || !options || options.length < 2) {
      return false;
    }
    
    this.questions.push({
      id: this.questions.length + 1,
      question: question,
      options: options,
      correctAnswerIndex: correctAnswerIndex,
      createdAt: new Date()
    });
    
    return true;
  }

  getCurrentQuestion() {
    if (this.currentQuestionIndex >= this.questions.length) {
      return null;
    }
    return this.questions[this.currentQuestionIndex];
  }

  nextQuestion() {
    this.currentQuestionIndex++;
    if (this.currentQuestionIndex >= this.questions.length) {
      return false;
    }
    
    // Reset player attempts and answered status for new question
    this.playerGuesses.forEach(playerGuess => {
      playerGuess.attempts = 3;
      playerGuess.guesses = [];
      playerGuess.answered = false; // NEW: Reset answered status
    });
    
    this.questionStartTime = Date.now();
    return true;
  }

  getTotalQuestions() {
    return this.questions.length;
  }

  checkAnswer(guessIndex, questionIndex) {
    if (!this.questions[questionIndex]) {
      return false;
    }
    
    const question = this.questions[questionIndex];
    return guessIndex === question.correctAnswerIndex;
  }

  getQuestionProgress() {
    return {
      current: this.currentQuestionIndex + 1,
      total: this.questions.length,
      percentage: Math.round((this.currentQuestionIndex / this.questions.length) * 100)
    };
  }

  // NEW: Get elapsed time for current question
  getElapsedTime() {
    if (!this.questionStartTime) return 0;
    return Math.floor((Date.now() - this.questionStartTime) / 1000);
  }

  // NEW: Get remaining time for current question
  getRemainingTime() {
    const elapsed = this.getElapsedTime();
    return Math.max(0, this.timeLimit - elapsed);
  }

  startGame() {
    this.status = 'in_progress';
    this.startedAt = new Date();
    this.currentQuestionIndex = 0;
    this.questionStartTime = Date.now(); // NEW: Track question start time
    this.roundCount++;

    this.playerGuesses.forEach(playerGuess => {
      playerGuess.attempts = 3;
      playerGuess.guesses = [];
      playerGuess.answered = false;
    });
  }

  endGame() {
    this.status = 'ended';
    this.endedAt = new Date();
    if (this.gameTimer) {
      clearTimeout(this.gameTimer);
      this.gameTimer = null;
    }
  }

  addScore(userId, points) {
    if (this.playerScores.has(userId)) {
      const currentScore = this.playerScores.get(userId);
      this.playerScores.set(userId, currentScore + points);
      return true;
    }
    return false;
  }

  getPlayerScore(userId) {
    return this.playerScores.get(userId) || 0;
  }

  getPlayerGuess(userId) {
    return this.playerGuesses.get(userId);
  }

  recordGuess(userId, guess) {
    const playerGuess = this.playerGuesses.get(userId);
    if (playerGuess) {
      playerGuess.guesses.push(guess);
      playerGuess.answered = true; // NEW: Mark as answered
      playerGuess.attempts--;
      return playerGuess;
    }
    return null;
  }

  getTimeRemaining() {
    if (this.status !== 'in_progress' || !this.startedAt) {
      return this.timeLimit;
    }

    const elapsed = Math.floor((Date.now() - this.startedAt) / 1000);
    const remaining = Math.max(0, this.timeLimit - elapsed);
    return remaining;
  }

  isTimeExpired() {
    return this.getTimeRemaining() <= 0;
  }

  get timeRemaining() {
    return this.getTimeRemaining();
  }

  getPlayersData() {
    return Array.from(this.players.entries()).map(([userId, userName]) => ({
      userId,
      userName,
      score: this.getPlayerScore(userId),
      attempts: this.getPlayerGuess(userId)?.attempts || 0,
      answered: this.getPlayerGuess(userId)?.answered || false
    }));
  }

  getWinnerData() {
    if (!this.winner) return null;
    return {
      userId: this.winner,
      userName: this.players.get(this.winner),
      score: this.getPlayerScore(this.winner)
    };
  }
}

module.exports = GameSession;