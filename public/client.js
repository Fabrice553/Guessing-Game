// ===== SOCKET CONNECTION =====
const socket = io();

// ===== DOM ELEMENTS =====
const loginScreen = document.getElementById('loginScreen');
const mainScreen = document.getElementById('mainScreen');
const gameScreen = document.getElementById('gameScreen');
const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('usernameInput');
const loginError = document.getElementById('loginError');
const userGreeting = document.getElementById('userGreeting');

// Main screen elements
const logoutBtn = document.getElementById('logoutBtn');
const leaderboardBtn = document.getElementById('leaderboardBtn');
const refreshBtn = document.getElementById('refreshBtn');
const sessionNameInput = document.getElementById('sessionNameInput');
const createSessionBtn = document.getElementById('createSessionBtn');
const sessionsList = document.getElementById('sessionsList');

// Game screen elements
const leaveGameBtn = document.getElementById('leaveGameBtn');
const sessionName = document.getElementById('sessionName');
const statusBadge = document.getElementById('statusBadge');
const playerCount = document.getElementById('playerCount');
const playersList = document.getElementById('playersList');
const yourScore = document.getElementById('yourScore');
const messages = document.getElementById('messages');

// Game areas
const questionArea = document.getElementById('questionArea');
const setupArea = document.getElementById('setupArea');
const readyArea = document.getElementById('readyArea');
const waitingArea = document.getElementById('waitingArea');

// Question/Answer elements
const questionText = document.getElementById('questionText');
const guessInput = document.getElementById('guessInput');
const guessBtn = document.getElementById('guessBtn');
const attemptsInfo = document.getElementById('attemptsInfo');
const questionInput = document.getElementById('questionInput');
const answerInput = document.getElementById('answerInput');
const createQuestionBtn = document.getElementById('createQuestionBtn');
const setupError = document.getElementById('setupError');
const readyMessage = document.getElementById('readyMessage');
const startGameBtn = document.getElementById('startGameBtn');
const startError = document.getElementById('startError');

// Leaderboard modal
const leaderboardModal = document.getElementById('leaderboardModal');
const leaderboardBtn_close = document.getElementById('closeLeaderboardBtn');
const leaderboardBody = document.getElementById('leaderboardBody');

// ===== STATE =====
let currentUser = null;
let currentSessionId = null;
let isGameMaster = false;
let playerData = null;

// ===== LOGIN =====
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  joinServer();
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
  userGreeting.textContent = `Welcome, ${data.username}!`;
  yourScore.textContent = '0 pts';
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
  }, 4000);
}

// ===== NAVIGATION =====
logoutBtn.addEventListener('click', logout);

function logout() {
  socket.disconnect();
  currentUser = null;
  currentSessionId = null;
  isGameMaster = false;
  showScreen('login');
  usernameInput.value = '';
  usernameInput.focus();
}

leaderboardBtn.addEventListener('click', () => {
  socket.emit('get_leaderboard');
});

leaderboardBtn_close.addEventListener('click', () => {
  leaderboardModal.classList.add('hidden');
});

socket.on('leaderboard', (data) => {
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
refreshBtn.addEventListener('click', loadSessions);
createSessionBtn.addEventListener('click', createSession);

function loadSessions() {
  socket.emit('get_sessions');
}

socket.on('sessions_list', (sessions) => {
  displaySessions(sessions);
});

socket.on('sessions_list_updated', (sessions) => {
  displaySessions(sessions);
});

function displaySessions(sessions) {
  sessionsList.innerHTML = '';

  if (sessions.length === 0) {
    sessionsList.innerHTML = '<p class="loading">No sessions yet. Create one!</p>';
    return;
  }

  sessions.forEach(session => {
    const card = document.createElement('div');
    card.className = 'session-card';
    card.innerHTML = `
      <h3>${session.name}</h3>
      <p>👑 ${session.gameMasterName}</p>
      <p>👥 ${session.playerCount}/${session.maxPlayers} players</p>
      <p>Status: ${session.status === 'waiting' ? '⏳ Waiting' : '🎮 Playing'}</p>
      <span class="session-status ${session.status === 'waiting' ? 'status-waiting' : 'status-playing'}">
        ${session.status === 'waiting' ? 'Waiting' : 'Playing'}
      </span>
    `;

    if (session.status === 'waiting') {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => joinSession(session.id));
    } else {
      card.style.opacity = '0.6';
    }

    sessionsList.appendChild(card);
  });
}

function createSession() {
  const name = sessionNameInput.value.trim();
  if (!name) {
    showGameMessage('Enter session name', 'error');
    return;
  }
  socket.emit('create_session', { sessionName: name, maxPlayers: 10 });
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
  showGameMessage(`New session: ${data.name}`, 'info');
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
  showGameMessage(`${data.username} joined`, 'info');
  socket.emit('get_session_details');
});

socket.on('player_left', (data) => {
  showGameMessage(`${data.username} left`, 'system');
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

socket.on('session_details', (data) => {
  sessionName.textContent = data.sessionName;
  statusBadge.textContent = data.status === 'waiting' ? '⏳ Waiting' : '🎮 Playing';
  statusBadge.style.background = data.status === 'waiting' ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 235, 0, 0.3)';
  updatePlayersList(data.players);
  playerCount.textContent = data.playerCount;

  const myPlayer = data.players.find(p => p.id === currentUser.userId);
  if (myPlayer) {
    yourScore.textContent = `${myPlayer.score} pts`;
  }
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

socket.on('session_deleted', () => {
  if (currentSessionId) {
    showGameMessage('Session was deleted', 'warning');
    leaveGame();
  }
});

// ===== GAME SETUP =====
createQuestionBtn.addEventListener('click', createQuestion);

function createQuestion() {
  const question = questionInput.value.trim();
  const answer = answerInput.value.trim();

  if (!question || !answer) {
    showError(setupError, 'Fill in both fields');
    return;
  }

  socket.emit('create_question', { question, answer });
  questionInput.value = '';
  answerInput.value = '';
}

socket.on('question_created', (data) => {
  showError(setupError, 'Question created!');
  setTimeout(() => {
    showError(setupError, '');
    showReadyArea();
  }, 1500);
});

startGameBtn.addEventListener('click', () => {
  socket.emit('start_game');
});

socket.on('game_started', (data) => {
  hideAllAreas();
  questionArea.classList.remove('hidden');
  questionText.textContent = data.question;
  attemptsInfo.textContent = 'Attempts: 3/3';
  guessInput.value = '';
  guessInput.focus();
  guessBtn.disabled = false;
  guessInput.disabled = false;
  showGameMessage(`Game started! ${data.timeLimit}s limit`, 'info');
});

// ===== GAME PLAY =====
guessBtn.addEventListener('click', makeGuess);
guessInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !guessBtn.disabled) makeGuess();
});

function makeGuess() {
  const guess = guessInput.value.trim();
  if (!guess) {
    showGameMessage('Enter a guess', 'error');
    return;
  }
  socket.emit('make_guess', { guess });
  guessInput.value = '';
}

socket.on('incorrect_answer', (data) => {
  attemptsInfo.textContent = `Attempts: ${data.attemptsLeft}/3`;
  showGameMessage(data.message, 'error');
});

socket.on('player_guessed_wrong', (data) => {
  showGameMessage(`${data.username} guessed wrong (${data.attemptsLeft} left)`, 'system');
});

socket.on('no_attempts', (data) => {
  showGameMessage('You are out of attempts!', 'warning');
});

socket.on('correct_answer', (data) => {
  showGameMessage(`🎉 ${data.winner} got it! Answer: ${data.answer}`, 'success');
  guessBtn.disabled = true;
  guessInput.disabled = true;
});

socket.on('game_timeout', (data) => {
  showGameMessage(`⏱️ Time up! Answer: ${data.answer}`, 'warning');
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

  const myPlayer = data.players.find(p => p.id === currentUser.userId);
  if (myPlayer) {
    yourScore.textContent = `${myPlayer.score} pts`;
  }
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

function updatePlayersList(players) {
  playersList.innerHTML = '';
  players.forEach(player => {
    const div = document.createElement('div');
    div.className = `player-item ${player.isGameMaster ? 'master' : ''}`;
    div.innerHTML = `
      <span class="player-name">${player.name}</span>
      <span class="player-score">${player.score} pts</span>
    `;
    playersList.appendChild(div);
  });
}

function showSetupArea() {
  hideAllAreas();
  setupArea.classList.remove('hidden');
  questionInput.focus();
  showGameMessage('Create a question for players', 'info');
}

function showReadyArea() {
  hideAllAreas();
  readyArea.classList.remove('hidden');
  const count = document.querySelectorAll('.player-item').length;
  readyMessage.textContent = `${count} players ready. Click start to begin!`;
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
}

function showGameMessage(message, type = 'info') {
  const div = document.createElement('div');
  div.className = `message ${type}`;
  div.textContent = message;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;

  if (type !== 'system') {
    setTimeout(() => div.remove(), 5000);
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
  hideAllAreas();
}

// Initial focus
window.addEventListener('load', () => {
  usernameInput.focus();
});