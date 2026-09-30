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

app.use('*', verifyAuth);

app.get('/api/chats/public', async (c) => {
  const chat = await c.env.DB.prepare(
    "SELECT * FROM chats WHERE type = 'public'"
  ).first();
  return c.json({ chat });
});

app.get('/api/chats', async (c) => {
  const userId = c.get('userId');
  
  const chats = await c.env.DB.prepare(
    `SELECT c.*, 
     (SELECT COUNT(*) FROM chat_members cm WHERE cm.chat_id = c.id) as member_count
     FROM chats c 
     JOIN chat_members cm ON c.id = cm.chat_id 
     WHERE cm.user_id = ?
     ORDER BY c.created_at DESC`
  ).bind(userId).all();
  
  return c.json({ chats: chats.results });
});

const createGroupSchema = z.object({
  name: z.string().min(1).max(50),
  memberIds: z.array(z.string()).min(1),
});

app.post('/api/chats/group', zValidator('json', createGroupSchema), async (c) => {
  const userId = c.get('userId');
  const { name, memberIds } = c.req.valid('json');
  
  const id = generateId();
  
  await c.env.DB.prepare(
    "INSERT INTO chats (id, type, name, created_by) VALUES (?, 'group', ?, ?)"
  ).bind(id, name, userId).run();
  
  await c.env.DB.prepare(
    "INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)"
  ).bind(id, userId).run();
  
  for (const memberId of memberIds) {
    await c.env.DB.prepare(
      "INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)"
    ).bind(id, memberId).run();
  }
  
  const chat = await c.env.DB.prepare("SELECT * FROM chats WHERE id = ?").bind(id).first();
  
  return c.json({ chat });
});

app.get('/api/chats/:chatId/messages', async (c) => {
  const chatId = c.req.param('chatId');
  const limit = parseInt(c.req.query('limit') || '50');
  
  const messages = await c.env.DB.prepare(
    `SELECT m.*, u.username 
     FROM messages m 
     JOIN users u ON m.sender_id = u.id 
     WHERE m.chat_id = ? 
     ORDER BY m.created_at DESC 
     LIMIT ?`
  ).bind(chatId, limit).all();
  
  return c.json({ messages: messages.results.reverse() });
});

const sendMessageSchema = z.object({
  content: z.string().min(1).max(2000),
});

app.post('/api/chats/:chatId/messages', zValidator('json', sendMessageSchema), async (c) => {
  const userId = c.get('userId');
  const chatId = c.req.param('chatId');
  const { content } = c.req.valid('json');
  
  const chat = await c.env.DB.prepare("SELECT * FROM chats WHERE id = ?").bind(chatId).first();
  if (!chat) {
    return c.json({ error: '聊天不存在' }, 404);
  }
  
  const isMember = await c.env.DB.prepare(
    "SELECT * FROM chat_members WHERE chat_id = ? AND user_id = ?"
  ).bind(chatId, userId).first();
  
  if (!isMember && chat.type !== 'public') {
    return c.json({ error: '无权访问此聊天' }, 403);
  }
  
  const id = generateId();
  
  await c.env.DB.prepare(
    "INSERT INTO messages (id, chat_id, chat_type, sender_id, content) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, chatId, chat.type, userId, content).run();
  
  const message = await c.env.DB.prepare(
    "SELECT m.*, u.username FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?"
  ).bind(id).first();
  
  return c.json({ message });
});

export default app;