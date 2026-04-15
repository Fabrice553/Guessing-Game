const { v4: uuidv4 } = require('uuid');

class GameSession {
  constructor(name, gameMasterId, gameMasterName, maxPlayers = 10) {
    this.id = uuidv4();
    this.name = name;
    this.gameMasterId = gameMasterId;
    this.gameMasterName = gameMasterName;
    this.maxPlayers = maxPlayers;
    this.players = new Map(); // userId -> userName
    this.playerScores = new Map(); // userId -> score
    this.playerGuesses = new Map(); // userId -> {attempts, guesses}
    this.question = null;
    this.answer = null;
    this.status = 'waiting'; // waiting, in_progress, ended
    this.winner = null;
    this.timeLimit = 60; // 60 seconds
    this.gameTimer = null;
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
      guesses: []
    });
    return true;
  }

  removePlayer(userId) {
    this.players.delete(userId);
    this.playerScores.delete(userId);
    this.playerGuesses.delete(userId);
  }

  setQuestion(question, answer) {
    if (!question || !answer) {
      return false;
    }
    this.question = question;
    this.answer = answer.toLowerCase().trim();
    return true;
  }

  startGame() {
    this.status = 'in_progress';
    this.winner = null;
    this.startedAt = new Date();
    this.roundCount++;

    // Reset attempts for all players
    this.playerGuesses.forEach(playerGuess => {
      playerGuess.attempts = 3;
      playerGuess.guesses = [];
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
      attempts: this.getPlayerGuess(userId)?.attempts || 0
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