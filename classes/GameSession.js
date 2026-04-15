const { v4: uuidv4 } = require('uuid');

class GameSession {
  constructor(name, gameMasterId, gameMasterName, maxPlayers = 10) {
    this.id = uuidv4();
    this.name = name;
    this.gameMasterId = gameMasterId;
    this.gameMasterName = gameMasterName;
    this.maxPlayers = maxPlayers;
    this.players = new Map();
    this.playerScores = new Map();
    this.playerGuesses = new Map();
    
    this.questions = [];
    this.currentQuestionIndex = 0;
    this.questionAnswerStats = {};
    
    this.status = 'waiting';
    this.gameRunning = false; // NEW: Track if actively answering
    this.winner = null;
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
      answered: false,
      selectedAnswer: null
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
    
    this.playerGuesses.forEach(playerGuess => {
      playerGuess.attempts = 3;
      playerGuess.guesses = [];
      playerGuess.answered = false;
      playerGuess.selectedAnswer = null;
    });
    
    this.questionAnswerStats = {};
    this.gameRunning = false;
    this.winner = null;
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

  getElapsedTime() {
    if (!this.questionStartTime) return 0;
    return Math.floor((Date.now() - this.questionStartTime) / 1000);
  }

  getRemainingTime() {
    const elapsed = this.getElapsedTime();
    return Math.max(0, this.timeLimit - elapsed);
  }

  recordAnswer(userId, guessIndex) {
    const playerGuess = this.playerGuesses.get(userId);
    if (playerGuess) {
      playerGuess.selectedAnswer = guessIndex;
      playerGuess.answered = true;
      
      if (!this.questionAnswerStats[guessIndex]) {
        this.questionAnswerStats[guessIndex] = 0;
      }
      this.questionAnswerStats[guessIndex]++;
      
      return playerGuess;
    }
    return null;
  }

  getAnswerStatistics() {
    const currentQuestion = this.getCurrentQuestion();
    if (!currentQuestion) return null;
    
    const stats = {};
    currentQuestion.options.forEach((option, index) => {
      stats[index] = {
        option: option,
        count: this.questionAnswerStats[index] || 0,
        percentage: Math.round(((this.questionAnswerStats[index] || 0) / this.players.size) * 100)
      };
    });
    
    return stats;
  }

  startGame() {
    this.status = 'in_progress';
    this.gameRunning = false;
    this.startedAt = new Date();
    this.currentQuestionIndex = 0;
    this.questionStartTime = Date.now();
    this.roundCount++;

    this.playerGuesses.forEach(playerGuess => {
      playerGuess.attempts = 3;
      playerGuess.guesses = [];
      playerGuess.answered = false;
      playerGuess.selectedAnswer = null;
    });
    
    this.questionAnswerStats = {};
  }

  startQuestion() {
    this.gameRunning = true;
    this.winner = null;
  }

  endGame() {
    this.status = 'ended';
    this.gameRunning = false;
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
    return this.getRemainingTime() <= 0;
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