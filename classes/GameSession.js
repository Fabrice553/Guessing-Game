const { v4: uuidv4 } = require('uuid');

class GameSession {
  constructor(name, gameMasterId, gameMasterName, maxPlayers = 10) {
    this.id = uuidv4();
    this.name = name;
    this.gameMasterId = gameMasterId;
    this.gameMasterName = gameMasterName;
    this.maxPlayers = maxPlayers;
    this.players = new Map(); // Map of userId -> userName
    this.playerGuesses = new Map(); // Map of userId -> {attempts, guesses}
    this.question = null;
    this.answer = null;
    this.status = 'waiting'; // waiting, in_progress, ended
    this.winner = null;
    this.timeLimit = 60; // 60 seconds
    this.gameTimer = null;
    this.createdAt = new Date();
    this.startedAt = null;
    this.endedAt = null;
  }

  addPlayer(userId, userName) {
    if (this.players.size < this.maxPlayers) {
      this.players.set(userId, userName);
      this.playerGuesses.set(userId, {
        attempts: 3,
        guesses: []
      });
      return true;
    }
    return false;
  }

  removePlayer(userId) {
    this.players.delete(userId);
    this.playerGuesses.delete(userId);
  }

  setQuestion(question, answer) {
    this.question = question;
    this.answer = answer;
  }

  startGame() {
    this.status = 'in_progress';
    this.winner = null;
    this.startedAt = new Date();

    // Reset player guesses
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
    }
  }

  getPlayerGuess(userId) {
    return this.playerGuesses.get(userId);
  }

  recordGuess(userId, guess) {
    const playerGuess = this.playerGuesses.get(userId);
    if (playerGuess) {
      playerGuess.guesses.push(guess);
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
}

module.exports = GameSession;