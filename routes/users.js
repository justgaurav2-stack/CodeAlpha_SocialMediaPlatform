const express = require('express');
const db = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

router.put('/me', requireAuth, (req, res) => {
  const bio = (req.body.bio || '').trim().slice(0, 160);
  db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, req.user.id);
  res.json({ bio });
});

router.get('/:username', optionalAuth, (req, res) => {
  const me = req.user ? req.user.id : 0;
  const user = db
    .prepare('SELECT id, username, bio, created_at FROM users WHERE username = ?')
    .get(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const followers = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE following_id = ?').get(user.id).n;
  const following = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?').get(user.id).n;
  const isFollowing = !!db
    .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?')
    .get(me, user.id);

  const posts = db
    .prepare(
      `SELECT p.id, p.content, p.created_at, u.id AS user_id, u.username,
        (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
        EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.user_id = ? ORDER BY p.created_at DESC, p.id DESC`
    )
    .all(me, user.id)
    .map((p) => ({ ...p, liked: !!p.liked }));

  res.json({ ...user, followers, following, isFollowing, isMe: me === user.id, posts });
});

router.post('/:id/follow', requireAuth, (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.user.id) return res.status(400).json({ error: "You can't follow yourself" });

  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const existing = db
    .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?')
    .get(req.user.id, targetId);
  if (existing) {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.user.id, targetId);
  } else {
    db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)').run(req.user.id, targetId);
  }
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE following_id = ?').get(targetId);
  res.json({ following: !existing, followers: n });
});

module.exports = router;