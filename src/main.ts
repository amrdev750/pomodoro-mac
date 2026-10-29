import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged, 
  GoogleAuthProvider, 
  signInWithRedirect, 
  getRedirectResult, 
  User 
} from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyDy9rqxuQfKZUYzcygJDf9iDprdTWspFbs",
  authDomain: "focus-matrix-app-962cc.firebaseapp.com",
  projectId: "focus-matrix-app-962cc",
  storageBucket: "focus-matrix-app-962cc.firebasestorage.app",
  messagingSenderId: "225906852053",
  appId: "1:225906852053:web:956e1ed0c154bf165d625c",
  measurementId: "G-CEK7QDMFZ7"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser: User | null = null;

interface SessionLog {
  timestamp: string;
  category: string;
  durationMinutes: number;
  note: string;
  quality: string;
  hour: number;
}

interface ActivityData {
  [dateKey: string]: {
    totalMinutes: number;
    categories: { [category: string]: number };
    sessions: SessionLog[];
  };
}

let timerConfig = JSON.parse(localStorage.getItem('pomodoro_durations') || JSON.stringify({
  pomodoro: 25,
  shortBreak: 5,
  longBreak: 15
}));

const MODES = {
  pomodoro: { name: 'Deep Focus', minutes: timerConfig.pomodoro },
  shortBreak: { name: 'Short Break', minutes: timerConfig.shortBreak },
  longBreak: { name: 'Long Break', minutes: timerConfig.longBreak }
};

let currentMode: 'pomodoro' | 'shortBreak' | 'longBreak' = 'pomodoro';
let timeLeft = MODES[currentMode].minutes * 60;
let totalTime = timeLeft;
let timerId: number | null = null;
let isRunning = false;
let pendingSessionMinutes = 0;

let activity: ActivityData = JSON.parse(localStorage.getItem('pomodoro_activity_v4') || '{}');
let categories: string[] = JSON.parse(localStorage.getItem('pomodoro_categories') || '["General Focus", "USMLE", "Software Engineering"]');
let customTheme = JSON.parse(localStorage.getItem('pomodoro_custom_theme') || 'null');
let selectedQuality = '✨ Solid';

const timeDisplay = document.getElementById('time-display')!;
const sessionLabel = document.getElementById('session-label')!;
const startBtn = document.getElementById('start-btn')!;
const resetBtn = document.getElementById('reset-btn')!;
const ringFill = document.getElementById('ring-fill') as unknown as SVGCircleElement;
const heatmapMatrix = document.getElementById('heatmap-matrix')!;
const modeBtns = document.querySelectorAll('.mode-btn');
const categorySelect = document.getElementById('category-select') as HTMLSelectElement;
const statsCategorySelect = document.getElementById('stats-category-select') as HTMLSelectElement;

const CIRCUMFERENCE = 2 * Math.PI * 140;

function init() {
  applyTheme();
  renderCategories();
  updateTimerUI();
  renderHeatmap();
  renderStats();
  renderPeakFocusAnalytics();
  setupEventListeners();
  setupAuthListeners();
  checkForRemoteAnnouncements();
}

// --- Active Daily User (ADU) Telemetry for Admin Portal ---
async function logActiveDailyUser(userId: string, email: string) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const aduRef = doc(db, "daily_active_users", `${today}_${userId}`);
    await setDoc(aduRef, {
      uid: userId,
      email: email,
      date: today,
      lastActive: serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.log("Offline mode or Firebase missing: local data active.");
  }
}

// --- Remote Announcements & Config ---
async function checkForRemoteAnnouncements() {
  try {
    const configDoc = await getDoc(doc(db, "app_config", "announcements"));
    if (configDoc.exists()) {
      const data = configDoc.data();
      if (data.active && data.message) {
        console.log("📢 Remote Announcement:", data.message);
      }
    }
  } catch (e) {
    console.log("No active announcements.");
  }
}

// --- Firebase Auth & Cloud Sync ---
function setupAuthListeners() {
  const authModal = document.getElementById('auth-modal');
  const emailInput = document.getElementById('auth-email') as HTMLInputElement;
  const passwordInput = document.getElementById('auth-password') as HTMLInputElement;
  const btnLogin = document.getElementById('btn-login') as HTMLButtonElement;
  const btnSignup = document.getElementById('btn-signup') as HTMLButtonElement;
  const btnGoogle = document.getElementById('btn-google') as HTMLButtonElement;

  // Create feedback status element if missing
  let feedbackEl = document.getElementById('auth-feedback');
  if (!feedbackEl && authModal) {
    feedbackEl = document.createElement('div');
    feedbackEl.id = 'auth-feedback';
    feedbackEl.style.cssText = 'font-size: 11px; text-align: center; margin-top: 8px; min-height: 16px; transition: all 0.2s;';
    document.getElementById('auth-signed-out')?.appendChild(feedbackEl);
  }

  function setFeedback(msg: string, isError = true) {
    if (!feedbackEl) return;
    feedbackEl.textContent = msg;
    feedbackEl.style.color = isError ? '#ef4444' : '#22c55e';
  }

  function setAuthLoading(loading: boolean) {
    if (btnLogin) btnLogin.disabled = loading;
    if (btnSignup) btnSignup.disabled = loading;
    if (btnGoogle) btnGoogle.disabled = loading;
  }

  // Process redirect authentication on application startup
  getRedirectResult(auth)
    .then((result) => {
      if (result?.user) {
        setFeedback('Signed in with Google successfully!', false);
        setTimeout(() => {
          authModal?.classList.add('hidden');
          setFeedback('');
        }, 800);
      }
    })
    .catch((error: any) => {
      console.error("Redirect auth error:", error);
      if (error.message) {
        setFeedback(error.message.replace('Firebase: ', ''));
      }
    });

  document.getElementById('auth-btn')?.addEventListener('click', () => {
    setFeedback('');
    authModal?.classList.remove('hidden');
  });

  document.getElementById('close-auth-modal')?.addEventListener('click', () => {
    authModal?.classList.add('hidden');
  });

  // 1. Email Sign In
  btnLogin?.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

    if (!email || !password) {
      setFeedback('Please enter both email and password.');
      return;
    }

    setAuthLoading(true);
    setFeedback('Signing in...', false);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      setFeedback('Success! Syncing cloud profile...', false);
      setTimeout(() => {
        authModal?.classList.add('hidden');
        setAuthLoading(false);
        setFeedback('');
      }, 800);
    } catch (e: any) {
      setAuthLoading(false);
      setFeedback(e.message ? e.message.replace('Firebase: ', '') : 'Failed to sign in.');
    }
  });

  // 2. Email Sign Up
  btnSignup?.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

    if (!email || !password) {
      setFeedback('Please enter an email and password to register.');
      return;
    }

    if (password.length < 6) {
      setFeedback('Password must be at least 6 characters.');
      return;
    }

    setAuthLoading(true);
    setFeedback('Creating account...', false);

    try {
      await createUserWithEmailAndPassword(auth, email, password);
      setFeedback('Account created successfully!', false);
      setTimeout(() => {
        authModal?.classList.add('hidden');
        setAuthLoading(false);
        setFeedback('');
      }, 800);
    } catch (e: any) {
      setAuthLoading(false);
      setFeedback(e.message ? e.message.replace('Firebase: ', '') : 'Failed to create account.');
    }
  });

  // 3. Google Sign-In with Redirect (Tauri-compatible)
  const provider = new GoogleAuthProvider();
  btnGoogle?.addEventListener('click', async () => {
    setAuthLoading(true);
    setFeedback('Redirecting to Google...', false);

    try {
      await signInWithRedirect(auth, provider);
    } catch (e: any) {
      setAuthLoading(false);
      console.error("Google Auth error:", e);
      setFeedback(e.message ? e.message.replace('Firebase: ', '') : 'Google sign-in failed.');
    }
  });

  // 4. Sign Out
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await signOut(auth);
    setFeedback('');
  });

  // 5. Auth State Listener
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    const authBtn = document.getElementById('auth-btn');

    if (user) {
      authBtn?.classList.add('logged-in');
      document.getElementById('auth-signed-out')?.classList.add('hidden');
      document.getElementById('auth-signed-in')?.classList.remove('hidden');
      document.getElementById('user-email-display')!.textContent = user.email || user.uid;

      logActiveDailyUser(user.uid, user.email || 'anonymous');

      try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          if (data.activity) activity = data.activity;
          if (data.categories) categories = data.categories;
          localStorage.setItem('pomodoro_activity_v4', JSON.stringify(activity));
          localStorage.setItem('pomodoro_categories', JSON.stringify(categories));
          renderCategories();
          renderStats();
          renderPeakFocusAnalytics();
        }
      } catch (err) {
        console.log("Loaded local cache.");
      }
    } else {
      authBtn?.classList.remove('logged-in');
      document.getElementById('auth-signed-out')?.classList.remove('hidden');
      document.getElementById('auth-signed-in')?.classList.add('hidden');
    }
  });
}

async function syncUserDataToCloud() {
  if (!currentUser) return;
  try {
    await setDoc(doc(db, "users", currentUser.uid), {
      activity,
      categories,
      timerConfig,
      lastSync: serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.log("Local sync complete.");
  }
}

function setupEventListeners() {
  startBtn.addEventListener('click', toggleTimer);
  resetBtn.addEventListener('click', resetTimer);

  modeBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const mode = target.dataset.mode as keyof typeof MODES;
      if (mode && mode !== currentMode) {
        modeBtns.forEach(b => b.classList.remove('active'));
        target.classList.add('active');
        currentMode = mode;
        resetTimer();
      }
    });
  });

  statsCategorySelect.addEventListener('change', () => {
    renderStats();
    renderPeakFocusAnalytics();
  });

  document.getElementById('theme-btn')?.addEventListener('click', () => document.getElementById('theme-modal')?.classList.remove('hidden'));
  document.getElementById('close-theme-modal')?.addEventListener('click', () => document.getElementById('theme-modal')?.classList.add('hidden'));
  
  document.getElementById('settings-btn')?.addEventListener('click', () => document.getElementById('data-modal')?.classList.remove('hidden'));
  document.getElementById('close-modal-btn')?.addEventListener('click', () => document.getElementById('data-modal')?.classList.add('hidden'));

  document.getElementById('settings-timer-btn')?.addEventListener('click', () => {
    (document.getElementById('setting-pomo') as HTMLInputElement).value = timerConfig.pomodoro.toString();
    (document.getElementById('setting-short') as HTMLInputElement).value = timerConfig.shortBreak.toString();
    (document.getElementById('setting-long') as HTMLInputElement).value = timerConfig.longBreak.toString();
    document.getElementById('timer-settings-modal')?.classList.remove('hidden');
  });
  document.getElementById('close-timer-modal')?.addEventListener('click', () => document.getElementById('timer-settings-modal')?.classList.add('hidden'));
  document.getElementById('save-timer-settings')?.addEventListener('click', saveTimerSettings);

  document.getElementById('manage-cats-btn')?.addEventListener('click', () => {
    renderCategoryManager();
    document.getElementById('cat-modal')?.classList.remove('hidden');
  });
  document.getElementById('close-cat-modal')?.addEventListener('click', () => document.getElementById('cat-modal')?.classList.add('hidden'));

  document.getElementById('export-btn')?.addEventListener('click', exportData);
  document.getElementById('import-file')?.addEventListener('change', importData);
  document.getElementById('add-cat-btn')?.addEventListener('click', addCategory);
  document.getElementById('save-theme-btn')?.addEventListener('click', saveCustomTheme);

  document.querySelectorAll('.qual-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.qual-btn').forEach(b => b.classList.remove('active'));
      const target = e.currentTarget as HTMLElement;
      target.classList.add('active');
      selectedQuality = target.dataset.quality || '✨ Solid';
    });
  });

  document.getElementById('save-log-btn')?.addEventListener('click', saveSessionLog);
}

function saveTimerSettings() {
  const pomo = parseInt((document.getElementById('setting-pomo') as HTMLInputElement).value) || 25;
  const short = parseInt((document.getElementById('setting-short') as HTMLInputElement).value) || 5;
  const long = parseInt((document.getElementById('setting-long') as HTMLInputElement).value) || 15;

  timerConfig = { pomodoro: pomo, shortBreak: short, longBreak: long };
  localStorage.setItem('pomodoro_durations', JSON.stringify(timerConfig));

  MODES.pomodoro.minutes = pomo;
  MODES.shortBreak.minutes = short;
  MODES.longBreak.minutes = long;

  document.getElementById('timer-settings-modal')?.classList.add('hidden');
  resetTimer();
}

function renderCategories() {
  categorySelect.innerHTML = '';
  statsCategorySelect.innerHTML = '<option value="all">All Categories</option>';

  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    categorySelect.appendChild(opt);

    const statOpt = document.createElement('option');
    statOpt.value = cat;
    statOpt.textContent = cat;
    statsCategorySelect.appendChild(statOpt);
  });
}

function renderCategoryManager() {
  const list = document.getElementById('cat-manage-list')!;
  list.innerHTML = '';
  categories.forEach(cat => {
    const li = document.createElement('li');
    li.className = 'task-item';
    li.innerHTML = `<span>${cat}</span> <button class="ctrl-btn sm secondary" data-cat="${cat}"><i class="fa-solid fa-trash"></i></button>`;
    li.querySelector('button')?.addEventListener('click', () => {
      if (categories.length <= 1) {
        alert('You must keep at least one category.');
        return;
      }
      categories = categories.filter(c => c !== cat);
      localStorage.setItem('pomodoro_categories', JSON.stringify(categories));
      syncUserDataToCloud();
      renderCategories();
      renderCategoryManager();
    });
    list.appendChild(li);
  });
}

function addCategory() {
  const input = document.getElementById('new-cat-input') as HTMLInputElement;
  const val = input.value.trim();
  if (!val || categories.includes(val)) return;
  categories.push(val);
  localStorage.setItem('pomodoro_categories', JSON.stringify(categories));
  syncUserDataToCloud();
  input.value = '';
  renderCategories();
  renderCategoryManager();
}

function applyTheme() {
  if (!customTheme) return;
  document.documentElement.style.setProperty('--purple-accent', customTheme.accent);
  document.documentElement.style.setProperty('--bg-primary', customTheme.bg);
  document.documentElement.style.setProperty('--card-bg', customTheme.card);
}

function saveCustomTheme() {
  const accent = (document.getElementById('picker-accent') as HTMLInputElement).value;
  const bg = (document.getElementById('picker-bg') as HTMLInputElement).value;
  const card = (document.getElementById('picker-card') as HTMLInputElement).value;

  customTheme = { accent, bg, card };
  localStorage.setItem('pomodoro_custom_theme', JSON.stringify(customTheme));
  applyTheme();
  document.getElementById('theme-modal')?.classList.add('hidden');
}

function toggleTimer() {
  if (isRunning) pauseTimer();
  else startTimer();
}

function startTimer() {
  isRunning = true;
  startBtn.innerHTML = `<i class="fa-solid fa-pause"></i> Pause`;
  timerId = window.setInterval(() => {
    timeLeft--;
    updateTimerUI();
    if (timeLeft <= 0) completeSession();
  }, 1000);
}

function pauseTimer() {
  isRunning = false;
  startBtn.innerHTML = `<i class="fa-solid fa-play"></i> Start`;
  if (timerId) clearInterval(timerId);
}

function resetTimer() {
  pauseTimer();
  timeLeft = MODES[currentMode].minutes * 60;
  totalTime = timeLeft;
  sessionLabel.textContent = MODES[currentMode].name;
  updateTimerUI();
}

function updateTimerUI() {
  const m = Math.floor(timeLeft / 60).toString().padStart(2, '0');
  const s = (timeLeft % 60).toString().padStart(2, '0');
  timeDisplay.textContent = `${m}:${s}`;
  const offset = CIRCUMFERENCE - (timeLeft / totalTime) * CIRCUMFERENCE;
  if (ringFill) ringFill.style.strokeDashoffset = `${offset}`;
}

function completeSession() {
  pauseTimer();
  if (currentMode === 'pomodoro') {
    pendingSessionMinutes = MODES[currentMode].minutes;
    (document.getElementById('session-note-input') as HTMLInputElement).value = '';
    document.getElementById('log-modal')?.classList.remove('hidden');
  } else {
    alert('Break session completed!');
    resetTimer();
  }
}

function saveSessionLog() {
  const note = (document.getElementById('session-note-input') as HTMLInputElement).value.trim() || 'Deep Focus Session';
  const today = new Date().toISOString().split('T')[0];
  const currentHour = new Date().getHours();
  const category = categorySelect.value || 'General Focus';

  if (!activity[today]) {
    activity[today] = { totalMinutes: 0, categories: {}, sessions: [] };
  }
  
  activity[today].totalMinutes += pendingSessionMinutes;
  activity[today].categories[category] = (activity[today].categories[category] || 0) + pendingSessionMinutes;
  
  activity[today].sessions.push({
    timestamp: new Date().toISOString(),
    category,
    durationMinutes: pendingSessionMinutes,
    note,
    quality: selectedQuality,
    hour: currentHour
  });

  localStorage.setItem('pomodoro_activity_v4', JSON.stringify(activity));
  syncUserDataToCloud();
  if (currentUser) logActiveDailyUser(currentUser.uid, currentUser.email || 'anonymous');

  document.getElementById('log-modal')?.classList.add('hidden');
  renderHeatmap();
  renderStats();
  renderPeakFocusAnalytics();
  resetTimer();
}

function renderPeakFocusAnalytics() {
  const selectedCat = statsCategorySelect?.value || 'all';
  const hoursCount = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  let totalLoggedMins = 0;

  Object.values(activity).forEach(day => {
    if (!day.sessions) return;
    day.sessions.forEach(session => {
      if (selectedCat !== 'all' && session.category !== selectedCat) return;
      const mins = session.durationMinutes;
      totalLoggedMins += mins;
      if (session.hour >= 6 && session.hour < 12) hoursCount.morning += mins;
      else if (session.hour >= 12 && session.hour < 18) hoursCount.afternoon += mins;
      else if (session.hour >= 18 && session.hour < 24) hoursCount.evening += mins;
      else hoursCount.night += mins;
    });
  });

  const mPct = totalLoggedMins ? (hoursCount.morning / totalLoggedMins) * 100 : 0;
  const aPct = totalLoggedMins ? (hoursCount.afternoon / totalLoggedMins) * 100 : 0;
  const ePct = totalLoggedMins ? (hoursCount.evening / totalLoggedMins) * 100 : 0;
  const nPct = totalLoggedMins ? (hoursCount.night / totalLoggedMins) * 100 : 0;

  (document.getElementById('bar-morning') as HTMLElement).style.width = `${mPct}%`;
  (document.getElementById('bar-afternoon') as HTMLElement).style.width = `${aPct}%`;
  (document.getElementById('bar-evening') as HTMLElement).style.width = `${ePct}%`;
  (document.getElementById('bar-night') as HTMLElement).style.width = `${nPct}%`;

  const maxVal = Math.max(hoursCount.morning, hoursCount.afternoon, hoursCount.evening, hoursCount.night);
  let peakStr = 'No data yet';
  if (maxVal > 0) {
    if (maxVal === hoursCount.morning) peakStr = '☀️ Morning Peak (6AM - 12PM)';
    else if (maxVal === hoursCount.afternoon) peakStr = '🌤️ Afternoon Peak (12PM - 6PM)';
    else if (maxVal === hoursCount.evening) peakStr = '🌙 Evening Peak (6PM - 12AM)';
    else peakStr = '🌌 Night Peak (12AM - 6AM)';
  }
  document.getElementById('peak-time-display')!.textContent = peakStr;
}

function renderHeatmap() {
  heatmapMatrix.innerHTML = '';
  const now = new Date();
  const daysInYear = 365;
  const selectedCat = statsCategorySelect?.value || 'all';

  const yearLabel = document.getElementById('year-label');
  if (yearLabel) yearLabel.textContent = now.getFullYear().toString();

  for (let i = daysInYear - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const dayData = activity[dateStr];
    
    let mins = 0;
    if (dayData) {
      if (selectedCat === 'all') {
        mins = dayData.totalMinutes;
      } else {
        mins = dayData.categories[selectedCat] || 0;
      }
    }

    const cell = document.createElement('div');
    cell.className = 'day-cell';
    cell.title = `${dateStr}: ${mins} mins focused`;

    if (mins === 0) {
      cell.classList.add('empty');
    } else if (mins > 0 && mins <= 25) {
      cell.classList.add('l1');
    } else if (mins > 25 && mins <= 75) {
      cell.classList.add('l2');
    } else if (mins > 75 && mins <= 150) {
      cell.classList.add('l3');
    } else {
      cell.classList.add('l4');
    }

    heatmapMatrix.appendChild(cell);
  }
}

function renderStats() {
  const today = new Date().toISOString().split('T')[0];
  const selectedCat = statsCategorySelect?.value || 'all';
  const dayData = activity[today];

  let todayMins = 0;
  if (dayData) {
    todayMins = selectedCat === 'all' ? dayData.totalMinutes : (dayData.categories[selectedCat] || 0);
  }
  document.getElementById('stat-today')!.textContent = (todayMins / 60).toFixed(1);

  let totalMins = 0;
  Object.values(activity).forEach(d => {
    if (selectedCat === 'all') totalMins += d.totalMinutes;
    else totalMins += (d.categories[selectedCat] || 0);
  });
  document.getElementById('stat-total')!.textContent = `${Math.round(totalMins / 60)}h`;

  let streak = 0;
  let checkDate = new Date();
  while (true) {
    const key = checkDate.toISOString().split('T')[0];
    const d = activity[key];
    let matchMins = 0;
    if (d) {
      matchMins = selectedCat === 'all' ? d.totalMinutes : (d.categories[selectedCat] || 0);
    }
    if (matchMins > 0) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }
  document.getElementById('stat-streak')!.textContent = `${streak}`;
  document.getElementById('stat-tasks')!.textContent = `0`;
  renderHeatmap();
}

function exportData() {
  const backup = { activity, categories, customTheme, timerConfig };
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backup, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", "focus_matrix_pro_backup.json");
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

function importData(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target?.result as string);
      if (data.activity) {
        activity = data.activity;
        localStorage.setItem('pomodoro_activity_v4', JSON.stringify(activity));
      }
      if (data.categories) {
        categories = data.categories;
        localStorage.setItem('pomodoro_categories', JSON.stringify(categories));
      }
      if (data.customTheme) {
        customTheme = data.customTheme;
        localStorage.setItem('pomodoro_custom_theme', JSON.stringify(customTheme));
        applyTheme();
      }
      if (data.timerConfig) {
        timerConfig = data.timerConfig;
        localStorage.setItem('pomodoro_durations', JSON.stringify(timerConfig));
      }
      syncUserDataToCloud();
      renderCategories();
      renderStats();
      renderPeakFocusAnalytics();
      alert('Data imported successfully!');
      document.getElementById('data-modal')?.classList.add('hidden');
    } catch {
      alert('Invalid JSON backup file.');
    }
  };
  reader.readAsText(file);
}

window.addEventListener('DOMContentLoaded', init);