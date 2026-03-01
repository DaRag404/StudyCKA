import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

// Persist userId across page reloads
function getOrCreateUserId() {
  let id = localStorage.getItem('studycka_user_id');
  if (!id) {
    id = uuidv4();
    localStorage.setItem('studycka_user_id', id);
  }
  return id;
}

// Persist exercise progress across page reloads
const PROGRESS_KEY = 'studycka_progress';

function loadProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function saveProgress(progress) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch (_) {}
}

const useStore = create((set, get) => ({
  userId: getOrCreateUserId(),

  // Session state from backend
  sessionStatus: 'none', // none | starting | waiting | ready | resetting | error
  sessionError: null,

  // Exercise state
  exercises: [],
  selectedExerciseId: null,
  exerciseProgress: loadProgress(), // { [id]: 'none' | 'passed' | 'failed' }

  // Check result for current exercise
  checkResult: null, // { passed, results }

  // Setup status for current exercise preconditions
  setupStatus: 'idle', // idle | running | done | error

  // ── Actions ──────────────────────────────────────────────────────────────

  setSessionStatus: (status, error = null) =>
    set({ sessionStatus: status, sessionError: error }),

  setExercises: (exercises) => set({ exercises }),

  selectExercise: (id) => {
    const { userId, sessionStatus } = get();
    set({ selectedExerciseId: id, checkResult: null, setupStatus: 'idle' });
    if (sessionStatus === 'ready') {
      set({ setupStatus: 'running' });
      fetch(`/api/setup/${id}?userId=${userId}`, { method: 'POST' })
        .then(() => set({ setupStatus: 'done' }))
        .catch((e) => { console.error('[setup]', e); set({ setupStatus: 'error' }); });
    }
  },

  // Called when session transitions to ready while an exercise is already selected
  triggerSetupIfNeeded: () => {
    const { userId, selectedExerciseId } = get();
    if (!selectedExerciseId) return;
    set({ setupStatus: 'running' });
    fetch(`/api/setup/${selectedExerciseId}?userId=${userId}`, { method: 'POST' })
      .then(() => set({ setupStatus: 'done' }))
      .catch((e) => { console.error('[setup]', e); set({ setupStatus: 'error' }); });
  },

  setCheckResult: (result) => {
    const { selectedExerciseId, exerciseProgress } = get();
    const newProgress = {
      ...exerciseProgress,
      [selectedExerciseId]: result.passed ? 'passed' : 'failed',
    };
    saveProgress(newProgress);
    set({ checkResult: result, exerciseProgress: newProgress });
  },

  clearCheckResult: () => set({ checkResult: null }),

  resetProgress: () => {
    localStorage.removeItem(PROGRESS_KEY);
    set({ exerciseProgress: {} });
  },
}));

export default useStore;
