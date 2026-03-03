'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const yaml    = require('js-yaml');

const router  = express.Router();

const EXERCISES_DIR = path.resolve(__dirname, '../../exercises');

function loadExercises() {
  const files = fs.readdirSync(EXERCISES_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .sort();

  return files.map((file) => {
    const raw = fs.readFileSync(path.join(EXERCISES_DIR, file), 'utf8');
    return yaml.load(raw);
  });
}

// GET /api/exercises
router.get('/', (_req, res) => {
  const exercises = loadExercises().map(({ id, title, difficulty, category, order }) => ({
    id, title, difficulty, category, order,
  }));
  res.json(exercises);
});

// GET /api/exercises/:id
router.get('/:id', (req, res) => {
  const exercise = loadExercises().find((e) => e.id === req.params.id);
  if (!exercise) return res.status(404).json({ error: 'Exercise not found' });
  res.json(exercise);
});

module.exports = router;
module.exports.loadExercises = loadExercises;
