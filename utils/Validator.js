class Validator {
  static validateUsername(username) {
    if (!username || typeof username !== 'string') {
      return { valid: false, error: 'Username is required' };
    }

    username = username.trim();

    if (username.length === 0) {
      return { valid: false, error: 'Username cannot be empty' };
    }

    if (username.length > 20) {
      return { valid: false, error: 'Username cannot exceed 20 characters' };
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return { valid: false, error: 'Username can only contain letters, numbers, underscore, and dash' };
    }

    return { valid: true };
  }

  static validateSessionName(name) {
    if (!name || typeof name !== 'string') {
      return { valid: false, error: 'Session name is required' };
    }

    name = name.trim();

    if (name.length === 0) {
      return { valid: false, error: 'Session name cannot be empty' };
    }

    if (name.length > 50) {
      return { valid: false, error: 'Session name cannot exceed 50 characters' };
    }

    return { valid: true };
  }

  static validateQuestion(question) {
    if (!question || typeof question !== 'string') {
      return { valid: false, error: 'Question is required' };
    }

    question = question.trim();

    if (question.length === 0) {
      return { valid: false, error: 'Question cannot be empty' };
    }

    if (question.length > 500) {
      return { valid: false, error: 'Question cannot exceed 500 characters' };
    }

    return { valid: true };
  }

  static validateAnswer(answer) {
    if (!answer || typeof answer !== 'string') {
      return { valid: false, error: 'Answer is required' };
    }

    answer = answer.trim();

    if (answer.length === 0) {
      return { valid: false, error: 'Answer cannot be empty' };
    }

    if (answer.length > 100) {
      return { valid: false, error: 'Answer cannot exceed 100 characters' };
    }

    return { valid: true };
  }

  static validateGuess(guess) {
    if (!guess || typeof guess !== 'string') {
      return { valid: false, error: 'Guess is required' };
    }

    guess = guess.trim();

    if (guess.length === 0) {
      return { valid: false, error: 'Guess cannot be empty' };
    }

    if (guess.length > 100) {
      return { valid: false, error: 'Guess cannot exceed 100 characters' };
    }

    return { valid: true };
  }

  static validateMaxPlayers(max) {
    if (!max || typeof max !== 'number') {
      return { valid: false, error: 'Max players must be a number' };
    }

    if (max < 3 || max > 100) {
      return { valid: false, error: 'Max players must be between 3 and 100' };
    }

    return { valid: true };
  }
}

module.exports = Validator;