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
  
  const enrichedChats = await Promise.all(
    (chats.results as any[]).map(async (chat) => {
      if (chat.type === 'private') {
        const otherUser = await c.env.DB.prepare(
          `SELECT u.id, u.username FROM users u
           JOIN chat_members cm ON u.id = cm.user_id
           WHERE cm.chat_id = ? AND cm.user_id != ?`
        ).bind(chat.id, userId).first();
        return { ...chat, other_user: otherUser };
      }
      return chat;
    })
  );
  
  return c.json({ chats: enrichedChats });
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

app.post('/api/chats/private', zValidator('json', z.object({ friendId: z.string() })), async (c) => {
  const userId = c.get('userId');
  const { friendId } = c.req.valid('json');
  
  const existing = await c.env.DB.prepare(
    `SELECT c.id FROM chats c
     JOIN chat_members cm1 ON c.id = cm1.chat_id AND cm1.user_id = ?
     JOIN chat_members cm2 ON c.id = cm2.chat_id AND cm2.user_id = ?
     WHERE c.type = 'private'`
  ).bind(userId, friendId).first();
  
  if (existing) {
    const chat = await c.env.DB.prepare("SELECT * FROM chats WHERE id = ?").bind(existing.id).first<any>();
    const otherUser = await c.env.DB.prepare(
      `SELECT u.id, u.username FROM users u
       JOIN chat_members cm ON u.id = cm.user_id
       WHERE cm.chat_id = ? AND cm.user_id != ?`
    ).bind(chat.id, userId).first();
    return c.json({ chat: { ...chat, other_user: otherUser }, existing: true });
  }
  
  const id = generateId();
  
  await c.env.DB.prepare(
    "INSERT INTO chats (id, type, name, created_by) VALUES (?, 'private', ?, ?)"
  ).bind(id, '', userId).run();
  
  await c.env.DB.prepare(
    "INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)"
  ).bind(id, userId).run();
  
  await c.env.DB.prepare(
    "INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)"
  ).bind(id, friendId).run();
  
  const chat = await c.env.DB.prepare("SELECT * FROM chats WHERE id = ?").bind(id).first<any>();
  const friend = await c.env.DB.prepare("SELECT id, username FROM users WHERE id = ?").bind(friendId).first();
  
  return c.json({ chat: { ...chat, other_user: friend }, existing: false });
});

app.delete('/api/chats/:chatId', async (c) => {
  const userId = c.get('userId');
  const chatId = c.req.param('chatId');
  
  const chat = await c.env.DB.prepare("SELECT * FROM chats WHERE id = ?").bind(chatId).first<any>();
  if (!chat) {
    return c.json({ error: '聊天不存在' }, 404);
  }
  
  if (chat.type !== 'group') {
    return c.json({ error: '只能解散群聊' }, 400);
  }
  
  if (chat.created_by !== userId) {
    return c.json({ error: '只有群主可以解散群聊' }, 403);
  }
  
  await c.env.DB.prepare("DELETE FROM messages WHERE chat_id = ?").bind(chatId).run();
  await c.env.DB.prepare("DELETE FROM chat_members WHERE chat_id = ?").bind(chatId).run();
  await c.env.DB.prepare("DELETE FROM chats WHERE id = ?").bind(chatId).run();
  
  return c.json({ success: true });
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