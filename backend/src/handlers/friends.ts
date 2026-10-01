import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { generateId } from '../utils/auth';
import { verifyAuth } from '../middleware/auth';

const app = new Hono<{
  Bindings: {
    DB: D1Database;
    JWT_SECRET: string;
  };
}>();

app.use('/api/*', verifyAuth);

app.get('/api/friends', async (c) => {
  const userId = c.get('userId');
  
  const friends = await c.env.DB.prepare(
    `SELECT u.id, u.username, f.created_at 
     FROM friendships f 
     JOIN users u ON f.friend_id = u.id 
     WHERE f.user_id = ?
     ORDER BY f.created_at DESC`
  ).bind(userId).all();
  
  return c.json({ friends: friends.results });
});

const addFriendSchema = z.object({
  friendId: z.string(),
});

app.post('/api/friends', zValidator('json', addFriendSchema), async (c) => {
  const userId = c.get('userId');
  const { friendId } = c.req.valid('json');
  
  if (userId === friendId) {
    return c.json({ error: '不能添加自己为好友' }, 400);
  }
  
  const friend = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(friendId).first();
  if (!friend) {
    return c.json({ error: '用户不存在' }, 404);
  }
  
  const existing = await c.env.DB.prepare(
    "SELECT * FROM friendships WHERE user_id = ? AND friend_id = ?"
  ).bind(userId, friendId).first();
  
  if (existing) {
    return c.json({ error: '已经是好友了' }, 400);
  }
  
  const id = generateId();
  await c.env.DB.prepare(
    "INSERT INTO friendships (id, user_id, friend_id) VALUES (?, ?, ?)"
  ).bind(id, userId, friendId).run();
  
  return c.json({ success: true });
});

app.delete('/api/friends/:friendId', async (c) => {
  const userId = c.get('userId');
  const friendId = c.req.param('friendId');
  
  await c.env.DB.prepare(
    "DELETE FROM friendships WHERE user_id = ? AND friend_id = ?"
  ).bind(userId, friendId).run();
  
  return c.json({ success: true });
});

app.get('/api/users/search', async (c) => {
  const query = c.req.query('q') || '';
  
  if (!query) {
    return c.json({ users: [] });
  }
  
  const users = await c.env.DB.prepare(
    "SELECT id, username FROM users WHERE username LIKE ? LIMIT 10"
  ).bind(`%${query}%`).all();
  
  return c.json({ users: users.results });
});

export default app;