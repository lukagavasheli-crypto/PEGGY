const express = require('express');
const db = require('../db');
const scheduler = require('../polling/scheduler');

const router = express.Router();

router.get('/notifications', (req, res) => {
  const notifications = db.getAllNotifications();
  res.json(notifications);
});

router.patch('/notifications/:id/seen', (req, res) => {
  db.markSeen(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

router.post('/notifications/mark-all-seen', (req, res) => {
  db.markAllSeen();
  res.json({ ok: true });
});

router.get('/status', (req, res) => {
  res.json(scheduler.getStatus());
});

// --- Todos ---

router.get('/todos', (req, res) => {
  res.json(db.getAllTodos());
});

router.post('/todos', (req, res) => {
  const { text, priority } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });
  const todo = db.insertTodo(text.trim(), priority);
  res.json(todo);
});

router.patch('/todos/:id', (req, res) => {
  const todo = db.updateTodo(parseInt(req.params.id, 10), req.body);
  res.json(todo);
});

router.delete('/todos/:id', (req, res) => {
  db.deleteTodo(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

module.exports = router;
