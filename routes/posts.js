const express = require('express');
const db = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

const POST_SELECT = `
  SELECT p.id, p.content, p.created_at, u.id AS user_id, u.username,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
    (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
    EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = @me) AS liked
  FROM posts p JOIN users u ON u.id = p.user_id
`;

router.get('/', optionalAuth, (req, res) => {
  const me = req.user ? req.user.id : 0;
  let sql = POST_SELECT;
  if (req.query.feed === 'following' && me) {
    sql += ` WHERE p.user_id IN (SELECT following_id FROM follows WHERE follower_id = @me) OR p.user_id = @me`;
  }
  sql += ' ORDER BY p.created_at DESC, p.id DESC LIMIT 50';
  const posts = db.prepare(sql).all({ me });
  res.json(posts.map((p) => ({ ...p, liked: !!p.liked })));
});

router.post('/', requireAuth, (req, res) => {
  const content = (req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Post cannot be empty' });
  if (content.length > 280) return res.status(400).json({ error: 'Max 280 characters' });

  const info = db.prepare('INSERT INTO posts (user_id, content) VALUES (?, ?)').run(req.user.id, content);
  const post = db
    .prepare(POST_SELECT + ' WHERE p.id = @id')
    .get({ me: req.user.id, id: Number(info.lastInsertRowid) });
  res.status(201).json({ ...post, liked: !!post.liked });
});

router.delete('/:id', requireAuth, (req, res) => {
  const result = db
    .prepare('DELETE FROM posts WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Post not found or not yours' });
  res.json({ ok: true });
});

router.post('/:id/like', requireAuth, (req, res) => {
  const postId = Number(req.params.id);
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const existing = db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?').get(req.user.id, postId);
  if (existing) {
    db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?').run(req.user.id, postId);
  } else {
    db.prepare('INSERT INTO likes (user_id, post_id) VALUES (?, ?)').run(req.user.id, postId);
  }
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM likes WHERE post_id = ?').get(postId);
  res.json({ liked: !existing, like_count: count });
});

router.get('/:id/comments', (req, res) => {
  const comments = db
    .prepare(
      `SELECT c.id, c.content, c.created_at, u.username
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ? ORDER BY c.created_at ASC, c.id ASC`
    )
    .all(req.params.id);
  res.json(comments);
});

router.post('/:id/comments', requireAuth, (req, res) => {
  const content = (req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Comment cannot be empty' });
  if (content.length > 200) return res.status(400).json({ error: 'Max 200 characters' });

  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const info = db
    .prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)')
    .run(post.id, req.user.id, content);
  const comment = db
    .prepare(
      `SELECT c.id, c.content, c.created_at, u.username
       FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`
    )
    .get(Number(info.lastInsertRowid));
  res.status(201).json(comment);
});

module.exports = router;