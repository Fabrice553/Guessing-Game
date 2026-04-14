// Socket.IO connection
const socket = io();

// DOM Elements
const loginScreen = document.getElementById('loginScreen');
const mainScreen = document.getElementById('mainScreen');
const gameScreen = document.getElementById('gameScreen');
const usernameInput = document.getElementById('usernameInput');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const logoutBtn = document.getElementById('logoutBtn');
const leaderboardBtn = document.getElementById('leaderboardBtn');
const leaderboardModal = document.getElementById('leaderboardModal');
const closeLeaderboardBtn = document.getElementById('closeLeaderboardBtn');

// Game Elements
const sessionNameInput = document.getElementById('sessionNameInput');
const createSessionBtn = document.getElementById('createSessionBtn');
const refreshSessionsBtn = document.getElementById('refreshSessionsBtn');
const sessionsList = document.getElementById('sessionsList');
const leaveGameBtn = document.getElementById('leaveGameBtn');
const sessionTitle = document.getElementById('sessionTitle');
const gameStatus = document.getElementById('gameStatus');
const playersList = document.getElementById('playersList');
const playerCount = document.getElementById('playerCount');
const messages = document.getElementById('messages');

// Question/Game Elements
const questionArea = document.getElementById('questionArea');
const setupArea = document.getElementById('setupArea');
const readyArea = document.getElementById('readyArea');
const waitingArea = document.getElementById('waitingArea');
const questionText = document.getElementById('questionText');
const guessInput = document.getElementById('guessInput');
const guessBtn = document.getElementById('guessBtn');
const attemptsDisplay = document.getElementById('attemptsDisplay');
const questionInput = document.getElementById('questionInput');
const answerInput = document.getElementById('answerInput');
const createQuestionBtn = document.getElementById('createQuestionBtn');
const questionError = document.getElementById('questionError');
const readyMessage = document.getElementById('readyMessage');
const startGameBtn = document.getElementById('startGameBtn');
const startError = document.getElementById('startError');

// User Info
let currentUser = null;
let currentSessionId = null;
let isGameMaster = false;

// ===== LOGIN =====
loginBtn.addEventListener('click', joinServer);
usernameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinServer();
});

function joinServer() {
  const username = usernameInput.value.trim();

  if (!username) {
    showLoginError('Please enter a username');
    return;
  }

  socket.emit('user_join', { username });
}

socket.on('user_joined', (data) => {
  currentUser = data;
  document.getElementById('userGreeting').textContent = `Welcome, ${data.username}!`;
  showScreen('main');
  loadSessions();
});

socket.on('error', (message) => {
  if (currentUser) {
    showGameMessage(message, 'error');
  } else {
    showLoginError(message);
  }
});

function showLoginError(message) {
  loginError.textContent = message;
  loginError.classList.add('show');
  setTimeout(() => {
    loginError.classList.remove('show');
  }, 3000);
}

// ===== NAVIGATION =====
logoutBtn.addEventListener('click', logout);

function logout() {
  socket.disconnect();
  currentUser = null;
  currentSessionId = null;
  showScreen('login');
  usernameInput.value = '';
}

leaderboardBtn.addEventListener('click', showLeaderboard);
closeLeaderboardBtn.addEventListener('click', hideLeaderboard);

function showLeaderboard() {
  socket.emit('get_leaderboard');
}

function hideLeaderboard() {
  leaderboardModal.classList.add('hidden');
}

socket.on('leaderboard', (data) => {
  const leaderboardBody = document.getElementById('leaderboardBody');
  leaderboardBody.innerHTML = '';

  data.forEach((player, index) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><strong>${index + 1}</strong></td>
      <td>${player.username}</td>
      <td><strong>${player.score}</strong></td>
    `;
    leaderboardBody.appendChild(row);
  });

  leaderboardModal.classList.remove('hidden');
});

// ===== SESSIONS =====
refreshSessionsBtn.addEventListener('click', loadSessions);
createSessionBtn.addEventListener('click', createSession);

function loadSessions() {
  socket.emit('get_sessions');
}

socket.on('sessions_list', (sessions) => {
  sessionsList.innerHTML = '';

  if (sessions.length === 0) {
    sessionsList.innerHTML = '<p class="empty-message">No active sessions. Create one!</p>';
    return;
  }

  sessions.forEach(session => {
    const card = document.createElement('div');
    card.className = 'session-card';
    card.innerHTML = `
      <h3>${session.name}</h3>
      <p>👨 Master: ${session.gameMasterName}</p>
      <p>👥 Players: ${session.playerCount}/${session.maxPlayers}</p>
      <p>Status: ${session.status === 'waiting' ? '⏳ Waiting' : '🎮 In Progress'}</p>
      <span class="session-status ${session.status === 'waiting' ? 'status-waiting' : 'status-in-progress'}">
        ${session.status === 'waiting' ? 'Waiting' : 'In Progress'}
      </span>
    `;

    if (session.status === 'waiting') {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => joinSession(session.id));
    } else {
      card.style.cursor = 'not-allowed';
      card.style.opacity = '0.6';
    }

    sessionsList.appendChild(card);
  });
});

function createSession() {
  const sessionName = sessionNameInput.value.trim();

  if (!sessionName) {
    showGameMessage('Please enter a session name', 'error');
    return;
  }

  socket.emit('create_session', { sessionName });
  sessionNameInput.value = '';
}

socket.on('session_created', (data) => {
  currentSessionId = data.sessionId;
  isGameMaster = true;
  showScreen('game');
  updateSessionHeader();
  showSetupArea();
});

socket.on('session_created_broadcast', (data) => {
  loadSessions();
  showGameMessage(`New session created: ${data.name}`, 'info');
});

function joinSession(sessionId) {
  socket.emit('join_session', { sessionId });
}

socket.on('session_joined', (data) => {
  currentSessionId = data.sessionId;
  isGameMaster = false;
  showScreen('game');
  updateSessionHeader();
  showWaitingArea();
  socket.emit('get_session_details');
});

socket.on('player_joined', (data) => {
  showGameMessage(`${data.username} joined the game`, 'info');
  socket.emit('get_session_details');
});

socket.on('player_left', (data) => {
  showGameMessage(`${data.username} left the game`, 'system');
  socket.emit('get_session_details');
});

socket.on('game_master_changed', (data) => {
  if (currentUser && data.newGameMasterName === currentUser.username) {
    isGameMaster = true;
    showSetupArea();
    showGameMessage('You are now the Game Master!', 'success');
  } else {
    showGameMessage(`${data.newGameMasterName} is now the Game Master`, 'info');
  }
});

socket.on('session_updated', (data) => {
  updatePlayersList(data.players);
  playerCount.textContent = data.playerCount;
});

leaveGameBtn.addEventListener('click', leaveGame);

function leaveGame() {
  socket.emit('leave_session');
  currentSessionId = null;
  isGameMaster = false;
  showScreen('main');
  loadSessions();
  clearGameScreen();
}

socket.on('session_deleted', (data) => {
  if (currentSessionId === data.sessionId) {
    showGameMessage('Session has been deleted', 'warning');
    leaveGame();
  }
  loadSessions();
});

// ===== GAME SETUP =====
createQuestionBtn.addEventListener('click', createQuestion);

function createQuestion() {
  const question = questionInput.value.trim();
  const answer = answerInput.value.trim();

  if (!question || !answer) {
    showError(questionError, 'Please fill in both fields');
    return;
  }

  socket.emit('create_question', { question, answer });
  questionInput.value = '';
  answerInput.value = '';
}

socket.on('question_created', (data) => {
  showError(questionError, 'Question created! Ready to start?');
  setTimeout(() => {
    showError(questionError, '');
    showReadyArea();
  }, 2000);
});

startGameBtn.addEventListener('click', startGame);

function startGame() {
  socket.emit('start_game');
}

socket.on('game_started', (data) => {
  hideAllAreas();
  questionArea.classList.remove('hidden');
  questionText.textContent = data.question;
  attemptsDisplay.textContent = `Attempts remaining: 3`;
  guessInput.value = '';
  guessInput.focus();
  showGameMessage(`Game started! You have ${data.timeLimit} seconds.`, 'info');
});

// ===== GAME PLAY =====
guessBtn.addEventListener('click', makeGuess);
guessInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') makeGuess();
});

function makeGuess() {
  const guess = guessInput.value.trim();

  if (!guess) {
    showGameMessage('Please enter a guess', 'error');
    return;
  }

  socket.emit('make_guess', { guess });
  guessInput.value = '';
}

socket.on('incorrect_answer', (data) => {
  attemptsDisplay.textContent = `Attempts remaining: ${data.attemptsLeft}`;
  showGameMessage(data.message, 'error');

  if (data.attemptsLeft === 0) {
    showGameMessage('You are out of attempts!', 'error');
  }
});

socket.on('player_guessed_wrong', (data) => {
  showGameMessage(`${data.username} guessed wrong (${data.attemptsLeft} left)`, 'system');
});

socket.on('correct_answer', (data) => {
  showGameMessage(`🎉 ${data.winner} got the correct answer: ${data.answer}`, 'success');
  guessBtn.disabled = true;
  guessInput.disabled = true;
});

socket.on('game_timeout', (data) => {
  showGameMessage(`⏱️ Time's up! The answer was: ${data.answer}`, 'warning');
  guessBtn.disabled = true;
  guessInput.disabled = true;
});

socket.on('game_ended', (data) => {
  guessBtn.disabled = false;
  guessInput.disabled = false;

  hideAllAreas();

  if (isGameMaster) {
    showSetupArea();
  } else {
    showWaitingArea();
  }

  updatePlayersList(data.players);
  showGameMessage(data.message, 'info');
});

// ===== HELPERS =====
function showScreen(screenName) {
  loginScreen.classList.remove('active');
  mainScreen.classList.remove('active');
  gameScreen.classList.remove('active');

  if (screenName === 'login') {
    loginScreen.classList.add('active');
  } else if (screenName === 'main') {
    mainScreen.classList.add('active');
  } else if (screenName === 'game') {
    gameScreen.classList.add('active');
  }
}

function updateSessionHeader() {
  socket.emit('get_session_details');
}

socket.on('session_details', (data) => {
  sessionTitle.textContent = data.sessionName;
  gameStatus.textContent = data.status === 'waiting' ? '⏳ Waiting' : '🎮 In Progress';
  gameStatus.style.background = data.status === 'waiting' ? '#c8e6c9' : '#ffe0b2';
  updatePlayersList(data.players);
  playerCount.textContent = data.playerCount;
});

function updatePlayersList(players) {
  playersList.innerHTML = '';

  players.forEach(player => {
    const playerDiv = document.createElement('div');
    playerDiv.className = `player-item ${player.isGameMaster ? 'master' : ''}`;
    playerDiv.innerHTML = `
      <span class="player-name">${player.name}</span>
      <span class="player-score">${player.score} pts</span>
    `;
    playersList.appendChild(playerDiv);
  });
}

function showSetupArea() {
  hideAllAreas();
  setupArea.classList.remove('hidden');
  questionInput.focus();
}

function showReadyArea() {
  hideAllAreas();
  readyArea.classList.remove('hidden');
  const playerCount = document.querySelectorAll('.player-item').length;
  readyMessage.textContent = `${playerCount} players ready. Click start to begin!`;
}

function showWaitingArea() {
  hideAllAreas();
  waitingArea.classList.remove('hidden');
}

function hideAllAreas() {
  questionArea.classList.add('hidden');
  setupArea.classList.add('hidden');
  readyArea.classList.add('hidden');
  waitingArea.classList.add('hidden');
  questionError.classList.remove('show');
  startError.classList.remove('show');
}

function showGameMessage(message, type = 'info') {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}`;
  messageDiv.textContent = message;
  messages.appendChild(messageDiv);
  messages.scrollTop = messages.scrollHeight;

  if (type !== 'system') {
    setTimeout(() => {
      messageDiv.remove();
    }, 5000);
  }
}

function showError(element, message) {
  if (message) {
    element.textContent = message;
    element.classList.add('show');
  } else {
    element.classList.remove('show');
  }
}

function clearGameScreen() {
  messages.innerHTML = '';
  playersList.innerHTML = '';
  questionArea.classList.add('hidden');
  setupArea.classList.add('hidden');
  readyArea.classList.add('hidden');
  waitingArea.classList.add('hidden');
}

// Initial load
window.addEventListener('load', () => {
  usernameInput.focus();
});