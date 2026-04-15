const socket = io();

// ===== DOM ELEMENTS =====
const loginScreen = document.getElementById('loginScreen');
const mainScreen = document.getElementById('mainScreen');
const gameScreen = document.getElementById('gameScreen');
const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('usernameInput');
const loginError = document.getElementById('loginError');
const userGreeting = document.getElementById('userGreeting');

const logoutBtn = document.getElementById('logoutBtn');
const leaderboardBtn = document.getElementById('leaderboardBtn');
const refreshBtn = document.getElementById('refreshBtn');
const sessionNameInput = document.getElementById('sessionNameInput');
const createSessionBtn = document.getElementById('createSessionBtn');
const sessionsList = document.getElementById('sessionsList');

const leaveGameBtn = document.getElementById('leaveGameBtn');
const sessionName = document.getElementById('sessionName');
const statusBadge = document.getElementById('statusBadge');
const playerCount = document.getElementById('playerCount');
const playersList = document.getElementById('playersList');
const messages = document.getElementById('messages');

const questionArea = document.getElementById('questionArea');
const setupArea = document.getElementById('setupArea');
const readyArea = document.getElementById('readyArea');
const waitingArea = document.getElementById('waitingArea');
const gameOverControls = document.getElementById('gameOverControls');

const questionText = document.getElementById('questionText');
const questionInput = document.getElementById('questionInput');
const option1 = document.getElementById('option1');
const option2 = document.getElementById('option2');
const option3 = document.getElementById('option3');
const option4 = document.getElementById('option4');
const correctAnswer = document.getElementById('correctAnswer');
const addQuestionBtn = document.getElementById('addQuestionBtn');
const createQuestionBtn = document.getElementById('createQuestionBtn');
const setupError = document.getElementById('setupError');
const readyMessage = document.getElementById('readyMessage');
const startGameBtn = document.getElementById('startGameBtn');
const resetBtn = document.getElementById('resetBtn');
const deleteSessionBtn = document.getElementById('deleteSessionBtn');
const questionsList = document.getElementById('questionsList');
const progressBarContainer = document.getElementById('progressBarContainer');
const progressBar = document.getElementById('progressBar');

const countdownContainer = document.getElementById('countdownContainer');
const countdownValue = document.getElementById('countdownValue');

const leaderboardModal = document.getElementById('leaderboardModal');
const leaderboardBtn_close = document.getElementById('closeLeaderboardBtn');
const leaderboardBody = document.getElementById('leaderboardBody');

const liveLeaderboardSection = document.getElementById('liveLeaderboardSection');
const liveLeaderboard = document.getElementById('liveLeaderboard');

// ===== STATE =====
let currentUser = null;
let currentSessionId = null;
let isGameMaster = false;
let questionsPrep = [];
let gameEnded = false;
let myAttemptsLeft = 3;
let isResetting = false;

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
  setTimeout(() => loginError.classList.remove('show'), 4000);
}

// ===== NAVIGATION =====
logoutBtn.addEventListener('click', logout);

function logout() {
  socket.disconnect();
  currentUser = null;
  currentSessionId = null;
  isGameMaster = false;
  gameEnded = false;
  showScreen('login');
  usernameInput.value = '';
  usernameInput.focus();
}

leaderboardBtn.addEventListener('click', () => socket.emit('get_leaderboard'));
leaderboardBtn_close.addEventListener('click', () => leaderboardModal.classList.add('hidden'));

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

socket.on('sessions_list', displaySessions);
socket.on('sessions_list_updated', displaySessions);

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
      <span class="session-status ${session.status === 'waiting' ? 'status-waiting' : 'status-playing'}">
        ${session.status === 'waiting' ? '⏳ Waiting' : '🎮 Playing'}
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
  gameEnded = false;
  myAttemptsLeft = 3;
  isResetting = false;
  showScreen('game');
  updateSessionHeader();
  showSetupArea();
});

socket.on('session_created_broadcast', () => loadSessions());

function joinSession(sessionId) {
  socket.emit('join_session', { sessionId });
}

socket.on('session_joined', (data) => {
  currentSessionId = data.sessionId;
  isGameMaster = false;
  gameEnded = false;
  myAttemptsLeft = 3;
  isResetting = false;
  showScreen('game');
  liveLeaderboardSection.classList.add('hidden');
  gameOverControls.classList.add('hidden');
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
  updatePlayersList(data.players);
  playerCount.textContent = data.playerCount;
});

socket.on('session_force_deleted', (data) => {
  showGameMessage(data.message, 'warning');
  setTimeout(() => {
    leaveGame();
  }, 2000);
});

socket.on('disconnect_from_session', () => {
  leaveGame();
});

leaveGameBtn.addEventListener('click', leaveGame);

function leaveGame() {
  socket.emit('leave_session');
  currentSessionId = null;
  isGameMaster = false;
  gameEnded = false;
  questionsPrep = [];
  myAttemptsLeft = 3;
  isResetting = false;
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

// ===== QUESTIONS SETUP =====
addQuestionBtn.addEventListener('click', addQuestionToList);

function addQuestionToList() {
  const question = questionInput.value.trim();
  const opt1 = option1.value.trim();
  const opt2 = option2.value.trim();
  const opt3 = option3.value.trim();
  const opt4 = option4.value.trim();
  const correctAnswerValue = correctAnswer.value;

  if (!question) {
    showError(setupError, 'Enter a question');
    return;
  }

  const options = [opt1, opt2, opt3, opt4].filter(o => o);
  
  if (options.length < 2) {
    showError(setupError, 'Need at least 2 options');
    return;
  }

  if (!correctAnswerValue) {
    showError(setupError, 'Select correct answer');
    return;
  }

  questionsPrep.push({
    id: questionsPrep.length + 1,
    question,
    options,
    correctAnswerIndex: parseInt(correctAnswerValue)
  });

  showGameMessage(`Question ${questionsPrep.length} added`, 'success');

  questionInput.value = '';
  option1.value = '';
  option2.value = '';
  option3.value = '';
  option4.value = '';
  correctAnswer.value = '';

  updateQuestionsList();
}

function updateQuestionsList() {
  questionsList.innerHTML = '';
  questionsPrep.forEach((q, idx) => {
    const div = document.createElement('div');
    div.className = 'question-preview';
    div.innerHTML = `
      <p><strong>Q${idx + 1}:</strong> ${q.question}</p>
      <p><small>${q.options.join(', ')}</small></p>
      <button class="btn btn-small btn-danger" onclick="removeQuestion(${idx})">Remove</button>
    `;
    questionsList.appendChild(div);
  });
}

function removeQuestion(idx) {
  questionsPrep.splice(idx, 1);
  updateQuestionsList();
}

createQuestionBtn.addEventListener('click', () => {
  if (questionsPrep.length === 0) {
    showError(setupError, 'Add at least 1 question');
    return;
  }
  socket.emit('create_questions', { questions: questionsPrep });
  questionsPrep = [];
  updateQuestionsList();
});

socket.on('questions_created', (data) => {
  showError(setupError, `${data.count} questions ready!`);
  setTimeout(() => {
    showError(setupError, '');
    showReadyArea();
  }, 2000);
});

startGameBtn.addEventListener('click', () => socket.emit('start_game'));

// ===== GAME STARTED =====
socket.on('game_started', (data) => {
  gameEnded = false;
  myAttemptsLeft = 3;
  isResetting = false;
  hideAllAreas();
  questionArea.classList.remove('hidden');
  progressBarContainer.classList.remove('hidden');
  countdownContainer.classList.remove('hidden');
  questionText.textContent = data.question;
  displayMultipleChoiceOptions(data.options);
  updateProgressBar(0);
  countdownValue.textContent = '60';
  updateAttemptsDisplay();
  
  if (isGameMaster) {
    liveLeaderboardSection.classList.remove('hidden');
  }
  
  showGameMessage(`Game started! ${data.totalQuestions} questions.`, 'info');
});

// ===== QUESTION READY =====
socket.on('question_ready', () => {
  showGameMessage('You can answer now!', 'info');
  enableAllOptions();
});

// ===== COUNTDOWN =====
socket.on('countdown_update', (data) => {
  countdownValue.textContent = data.remaining;
  if (data.remaining <= 10) {
    countdownContainer.style.borderColor = '#f44336';
  } else {
    countdownContainer.style.borderColor = '#667eea';
  }
});

// ===== NEXT QUESTION =====
socket.on('next_question', (data) => {
  gameEnded = false;
  myAttemptsLeft = 3;
  isResetting = false;
  hideAllAreas();
  questionArea.classList.remove('hidden');
  progressBarContainer.classList.remove('hidden');
  countdownContainer.classList.remove('hidden');
  if (isGameMaster) {
    liveLeaderboardSection.classList.remove('hidden');
  }
  questionText.textContent = data.question;
  displayMultipleChoiceOptions(data.options);
  updateProgressBar(data.progress);
  countdownValue.textContent = '60';
  updateAttemptsDisplay();
  
  // FIX: Reset button state
  if (resetBtn) {
    resetBtn.disabled = false;
    resetBtn.textContent = '↻ Reset New Question';
  }
  
  setTimeout(() => {
    enableAllOptions();
  }, 500);
  
  showGameMessage(`Question ${data.questionNumber}/${data.totalQuestions}`, 'info');
});

// ===== CORRECT ANSWER =====
socket.on('correct_answer_found', (data) => {
  showGameMessage(`✅ ${data.player} answered correctly! +10 points`, 'success');
  updatePlayersList(data.allPlayers);
  disableAllOptions();
});

// ===== WRONG ANSWER =====
socket.on('wrong_answer', (data) => {
  myAttemptsLeft = data.attemptsLeft;
  showGameMessage(data.message, 'error');
  updateAttemptsDisplay();
  
  if (data.attemptsLeft > 0) {
    enableAllOptions();
  } else {
    disableAllOptions();
  }
});

socket.on('out_of_attempts', (data) => {
  showGameMessage(data.message, 'warning');
  disableAllOptions();
});

socket.on('player_guessed_wrong', (data) => {
  showGameMessage(data.message, 'system');
});

// ===== QUESTION TIMEOUT =====
socket.on('question_timeout', (data) => {
  showGameMessage(`⏱️ Time's up! Answer: ${data.correctAnswer}`, 'warning');
  updatePlayersList(data.allPlayers);
  disableAllOptions();
});

// ===== ANSWER STATISTICS =====
socket.on('answer_statistics', (data) => {
  if (isGameMaster) {
    updateAnswerStatistics(data);
  }
});

function updateAnswerStatistics(data) {
  liveLeaderboard.innerHTML = '<h5 style="margin-top: 0;">Distribution:</h5>';
  
  Object.keys(data.statistics).forEach(optionIndex => {
    const stat = data.statistics[optionIndex];
    const div = document.createElement('div');
    div.className = 'answer-stat';
    div.innerHTML = `
      <div class="stat-row">
        <span>${stat.option}</span>
        <span>${stat.count} (${stat.percentage}%)</span>
      </div>
      <div class="stat-bar">
        <div class="stat-fill" style="width: ${stat.percentage}%"></div>
      </div>
    `;
    liveLeaderboard.appendChild(div);
  });
  
  // FIX: Only show attempts to game master
  const playerDiv = document.createElement('div');
  playerDiv.className = 'player-answers';
  playerDiv.innerHTML = '<h5 style="margin: 10px 0 5px 0;">Players:</h5>';
  
  data.players.forEach(player => {
    const p = document.createElement('p');
    p.style.cssText = 'font-size: 11px; margin: 3px 0;';
    p.textContent = `${player.userName}: ${player.answered ? '✓' : '⏳'} (${player.attemptsLeft} left)`;
    playerDiv.appendChild(p);
  });
  
  liveLeaderboard.appendChild(playerDiv);
}

// ===== PLAYERS UPDATE =====
socket.on('players_update', (data) => {
  updatePlayersList(data.players);
});

// ===== GAME OVER =====
socket.on('all_questions_ended', (data) => {
  gameEnded = true;
  isResetting = false;
  hideAllAreas();
  progressBarContainer.classList.add('hidden');
  countdownContainer.classList.add('hidden');
  liveLeaderboardSection.classList.add('hidden');
  
  if (isGameMaster) {
    gameOverControls.classList.remove('hidden');
    resetBtn.disabled = false;
    resetBtn.textContent = '↻ Reset New Question';
  }
  
  const resultsDiv = document.createElement('div');
  resultsDiv.className = 'game-section';
  resultsDiv.innerHTML = `
    <h3>🎉 Game Over!</h3>
    <div class="final-leaderboard">
      ${data.players.map((p, i) => `
        <div class="leaderboard-item">
          <span>${i + 1}. ${p.name}</span>
          <span>${p.score} pts</span>
        </div>
      `).join('')}
    </div>
  `;
  
  document.querySelector('.game-main').appendChild(resultsDiv);
  showGameMessage('All questions done!', 'success');
});

// ===== GAME MASTER CONTROLS =====
resetBtn.addEventListener('click', () => {
  if (isResetting) {
    showGameMessage('Already resetting...', 'warning');
    return;
  }

  if (confirm('Reset to next question?')) {
    isResetting = true;
    resetBtn.disabled = true;
    resetBtn.textContent = '⏳ Resetting...';
    showGameMessage('Resetting question...', 'info');
    socket.emit('reset_question');
  }
});

deleteSessionBtn.addEventListener('click', () => {
  if (confirm('🔴 This will end the session for all players. Are you sure?')) {
    deleteSessionBtn.disabled = true;
    deleteSessionBtn.textContent = '⏳ Ending...';
    socket.emit('delete_session');
  }
});

socket.on('session_force_deleted', () => {
  if (deleteSessionBtn) {
    deleteSessionBtn.disabled = false;
    deleteSessionBtn.textContent = '✕ End Game Session';
  }
});

// ===== GAME PLAY =====
function displayMultipleChoiceOptions(options) {
  const optionsContainer = document.getElementById('optionsContainer') || createOptionsContainer();
  optionsContainer.innerHTML = '';
  
  options.forEach((option, index) => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-option';
    btn.textContent = option;
    btn.disabled = true;
    btn.onclick = () => selectOption(index);
    optionsContainer.appendChild(btn);
  });
}

function createOptionsContainer() {
  const container = document.createElement('div');
  container.id = 'optionsContainer';
  container.className = 'options-container';
  questionArea.appendChild(container);
  return container;
}

function selectOption(optionIndex) {
  disableAllOptions();
  socket.emit('make_guess', { guess: optionIndex });
}

function disableAllOptions() {
  document.querySelectorAll('.btn-option').forEach(btn => btn.disabled = true);
}

function enableAllOptions() {
  document.querySelectorAll('.btn-option').forEach(btn => btn.disabled = false);
}

function updateProgressBar(percentage) {
  progressBar.style.width = percentage + '%';
}

function updateAttemptsDisplay() {
  const attemptsInfo = document.getElementById('attemptsInfo');
  if (attemptsInfo) {
    attemptsInfo.textContent = `Attempts left: ${myAttemptsLeft}/3`;
    attemptsInfo.style.color = myAttemptsLeft <= 1 ? '#f44336' : '#666';
  }
}

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
    div.className = 'player-item';
    div.innerHTML = `
      <span>${player.name}</span>
      <span class="player-score">${player.score} pts</span>
    `;
    playersList.appendChild(div);
  });
}

function showSetupArea() {
  hideAllAreas();
  setupArea.classList.remove('hidden');
  questionInput.focus();
  liveLeaderboardSection.classList.add('hidden');
  gameOverControls.classList.add('hidden');
}

function showReadyArea() {
  hideAllAreas();
  readyArea.classList.remove('hidden');
  const count = document.querySelectorAll('.player-item').length;
  readyMessage.textContent = `${count} players ready. Click start!`;
  liveLeaderboardSection.classList.add('hidden');
  gameOverControls.classList.add('hidden');
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
  gameOverControls.classList.add('hidden');
  progressBarContainer.classList.add('hidden');
  countdownContainer.classList.add('hidden');
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
  
  const resultsDiv = document.querySelector('.game-main .game-section');
  if (resultsDiv && resultsDiv !== questionArea && resultsDiv !== setupArea) {
    resultsDiv.remove();
  }
}

window.addEventListener('load', () => usernameInput.focus());