import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { initDB } from '../db/schema';
import { generateId, hashPassword, verifyPassword, generateToken, verifyToken } from '../utils/auth';

const app = new Hono<{
  Bindings: {
    DB: D1Database;
    JWT_SECRET: string;
  };
}>();

const registerSchema = z.object({
  username: z.string().min(3).max(20),
  password: z.string().min(6).max(50),
});

app.post('/api/auth/register', zValidator('json', registerSchema), async (c) => {
  const { username, password } = c.req.valid('json');
  
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  if (existing) {
    return c.json({ error: '用户名已存在' }, 400);
  }
  
  const id = generateId();
  const password_hash = await hashPassword(password);
  
  await c.env.DB.prepare(
    "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)"
  ).bind(id, username, password_hash).run();
  
  await c.env.DB.prepare(
    "INSERT INTO chat_members (chat_id, user_id) VALUES ('public', ?)"
  ).bind(id).run();
  
  const token = generateToken({ id, username }, c.env.JWT_SECRET);
  
  return c.json({
    user: { id, username },
    token,
  });
});

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

app.post('/api/auth/login', zValidator('json', loginSchema), async (c) => {
  const { username, password } = c.req.valid('json');
  
  const user = await c.env.DB.prepare(
    "SELECT id, username, password_hash FROM users WHERE username = ?"
  ).bind(username).first<any>();
  
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: '用户名或密码错误' }, 401);
  }
  
  const token = generateToken({ id: user.id, username: user.username }, c.env.JWT_SECRET);
  
  return c.json({
    user: { id: user.id, username: user.username },
    token,
  });
});

app.get('/api/auth/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: '未授权' }, 401);
  }
  
  const token = authHeader.slice(7);
  const payload = verifyToken(token, c.env.JWT_SECRET);
  
  if (!payload) {
    return c.json({ error: '令牌无效' }, 401);
  }
  
  const user = await c.env.DB.prepare(
    "SELECT id, username FROM users WHERE id = ?"
  ).bind(payload.id).first();
  
  if (!user) {
    return c.json({ error: '用户不存在' }, 404);
  }
  
  return c.json({ user });
});

export default app;