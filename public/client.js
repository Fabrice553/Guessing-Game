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
const attemptsInfo = document.getElementById('attemptsInfo');
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
const startError = document.getElementById('startError');
const questionsList = document.getElementById('questionsList');
const progressBarContainer = document.getElementById('progressBarContainer');
const progressBar = document.getElementById('progressBar');

// Leaderboard modal
const leaderboardModal = document.getElementById('leaderboardModal');
const leaderboardBtn_close = document.getElementById('closeLeaderboardBtn');
const leaderboardBody = document.getElementById('leaderboardBody');

// Live leaderboard
const liveLeaderboardSection = document.getElementById('liveLeaderboardSection');
const liveLeaderboard = document.getElementById('liveLeaderboard');

// ===== STATE =====
let currentUser = null;
let currentSessionId = null;
let isGameMaster = false;
let questionsPrep = []; // Store questions being prepared

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
  liveLeaderboardSection.classList.add('hidden');
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
  questionsPrep = [];
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

// ===== MULTIPLE QUESTIONS SETUP =====
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

  if (!correctAnswerValue || correctAnswerValue === '') {
    showError(setupError, 'Select correct answer');
    return;
  }

  const questionObj = {
    id: questionsPrep.length + 1,
    question: question,
    options: options,
    correctAnswerIndex: parseInt(correctAnswerValue)
  };

  questionsPrep.push(questionObj);
  showGameMessage(`Question ${questionsPrep.length} added`, 'success');

  // Clear inputs
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
      <p><small>Options: ${q.options.join(', ')}</small></p>
      <p><small>Answer: ${q.options[q.correctAnswerIndex]}</small></p>
      <button class="btn btn-small btn-danger" onclick="removeQuestion(${idx})">Remove</button>
    `;
    questionsList.appendChild(div);
  });
}

function removeQuestion(idx) {
  questionsPrep.splice(idx, 1);
  updateQuestionsList();
  showGameMessage('Question removed', 'info');
}

createQuestionBtn.addEventListener('click', submitAllQuestions);

function submitAllQuestions() {
  if (questionsPrep.length === 0) {
    showError(setupError, 'Add at least 1 question first');
    return;
  }

  socket.emit('create_questions', { questions: questionsPrep });
  questionsPrep = [];
  updateQuestionsList();
}

socket.on('questions_created', (data) => {
  showError(setupError, `${data.count} questions ready! Click Start Game`);
  setTimeout(() => {
    showError(setupError, '');
    showReadyArea();
  }, 2000);
});

startGameBtn.addEventListener('click', () => {
  socket.emit('start_game');
});

socket.on('game_started', (data) => {
  hideAllAreas();
  questionArea.classList.remove('hidden');
  progressBarContainer.classList.remove('hidden');
  questionText.textContent = data.question;
  attemptsInfo.textContent = `Q${data.questionNumber}/${data.totalQuestions}`;
  
  displayMultipleChoiceOptions(data.options);
  updateProgressBar(0);
  
  if (isGameMaster) {
    liveLeaderboardSection.classList.remove('hidden');
  }
  
  showGameMessage(`Game started! ${data.totalQuestions} questions. 60 seconds per question.`, 'info');
});

socket.on('next_question', (data) => {
  hideAllAreas();
  questionArea.classList.remove('hidden');
  progressBarContainer.classList.remove('hidden');
  questionText.textContent = data.question;
  attemptsInfo.textContent = `Q${data.questionNumber}/${data.totalQuestions}`;
  
  displayMultipleChoiceOptions(data.options);
  updateProgressBar(data.progress);
  
  showGameMessage(`Question ${data.questionNumber}/${data.totalQuestions}`, 'info');
});

socket.on('question_timeout', (data) => {
  showGameMessage(`⏱️ Time up! Answer: ${data.correctAnswer}`, 'warning');
  disableAllOptions();
});

socket.on('all_questions_ended', (data) => {
  hideAllAreas();
  progressBarContainer.classList.add('hidden');
  liveLeaderboardSection.classList.add('hidden');
  
  const resultsDiv = document.createElement('div');
  resultsDiv.className = 'game-section';
  resultsDiv.innerHTML = `
    <h3>🎉 Game Over!</h3>
    <div class="final-leaderboard">
      ${data.players.map((p, i) => `
        <div class="leaderboard-item">
          <span>${i + 1}. ${p.name}</span>
          <span class="final-score">${p.score} pts</span>
        </div>
      `).join('')}
    </div>
    <p>${data.message}</p>
  `;
  
  document.querySelector('.game-main').appendChild(resultsDiv);
  
  showGameMessage('All questions done! Thanks for playing', 'success');
});

// ===== GAME PLAY =====
function displayMultipleChoiceOptions(options) {
  const optionsContainer = document.getElementById('optionsContainer') || createOptionsContainer();
  optionsContainer.innerHTML = '';
  
  options.forEach((option, index) => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-option';
    btn.textContent = option;
    btn.onclick = () => selectOption(index);
    optionsContainer.appendChild(btn);
  });
}

function createOptionsContainer() {
  const container = document.createElement('div');
  container.id = 'optionsContainer';
  container.className = 'options-container';
  document.querySelector('.game-main').appendChild(container);
  return container;
}

function selectOption(optionIndex) {
  socket.emit('make_guess', { guess: optionIndex });
  disableAllOptions();
}

function disableAllOptions() {
  document.querySelectorAll('.btn-option').forEach(btn => {
    btn.disabled = true;
  });
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
  showGameMessage(`✅ ${data.player} got it right! +10 points`, 'success');
  disableAllOptions();
});

socket.on('live_leaderboard_update', (data) => {
  if (isGameMaster) {
    updateLiveLeaderboard(data.leaderboard);
  }
});

function updateLiveLeaderboard(leaderboard) {
  liveLeaderboard.innerHTML = '';
  leaderboard.forEach((player, index) => {
    const div = document.createElement('div');
    div.className = 'leaderboard-item-small';
    div.innerHTML = `
      <span>${index + 1}. ${player.name}</span>
      <span class="score-badge">${player.score} pts</span>
    `;
    liveLeaderboard.appendChild(div);
  });
}

function updateProgressBar(percentage) {
  progressBar.style.width = percentage + '%';
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
  showGameMessage('Add questions for players', 'info');
  liveLeaderboardSection.classList.add('hidden');
}

function showReadyArea() {
  hideAllAreas();
  readyArea.classList.remove('hidden');
  const count = document.querySelectorAll('.player-item').length;
  readyMessage.textContent = `${count} players ready. Click start to begin!`;
  liveLeaderboardSection.classList.add('hidden');
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
  progressBarContainer.classList.add('hidden');
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