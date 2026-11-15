import { create } from 'zustand';
import { load } from 'js-yaml';
import { setup, check } from './lab/shell.js';
import { installSystemResources, reconcile } from './lab/cluster.js';

const exercises = Object.values(
  import.meta.glob('../../exercises/*.yaml', { eager: true, query: '?raw', import: 'default' }),
)
  .map((text) => load(text))
  .sort((a, b) => a.order - b.order);
const prefix = 'studycka_lab_v1:';
function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function persist(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
const selected = read('studycka_selected', null);
function loadLab(id) {
  const key = prefix + (id || 'practice');
  const saved = read(key, null);
  if (!saved) return setup(exercises.find((x) => x.id === id));
  if (!saved.kubeadmLab && !saved.images) {
    installSystemResources(saved);
    reconcile(saved);
    persist(key, saved);
  }
  return saved;
}
export const useStore = create((set, get) => ({
  sessionStatus: 'ready',
  exercises,
  selectedExerciseId: selected,
  lab: loadLab(selected),
  exerciseProgress: read('studycka_progress', {}),
  checkResult: read('studycka_result:' + selected, null),
  save: () => {
    const s = get();
    persist(prefix + (s.selectedExerciseId || 'practice'), s.lab);
  },
  selectExercise: (id) => {
    get().save();
    persist('studycka_selected', id);
    set({
      selectedExerciseId: id,
      lab: loadLab(id),
      checkResult: read('studycka_result:' + id, null),
    });
  },
  resetLab: () => {
    const id = get().selectedExerciseId;
    set({ lab: setup(exercises.find((x) => x.id === id)), checkResult: null });
    localStorage.removeItem('studycka_result:' + id);
    get().save();
  },
  checkAnswer: () => {
    const s = get(),
      id = s.selectedExerciseId,
      result = check(
        s.lab,
        exercises.find((x) => x.id === id),
      );
    const progress = { ...s.exerciseProgress, [id]: result.passed ? 'passed' : 'failed' };
    persist('studycka_progress', progress);
    persist('studycka_result:' + id, result);
    set({ exerciseProgress: progress, checkResult: result });
  },
  resetProgress: () => {
    localStorage.removeItem('studycka_progress');
    exercises.forEach((x) => localStorage.removeItem('studycka_result:' + x.id));
    set({ exerciseProgress: {}, checkResult: null });
  },
}));
export default useStore;
