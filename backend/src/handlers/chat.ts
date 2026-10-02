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
  Variables: {
    userId: string;
    username: string;
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
    `SELECT c.*, cm.role as my_role,
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
    "INSERT INTO chat_members (chat_id, user_id, role) VALUES (?, ?, 'owner')"
  ).bind(id, userId).run();
  
  for (const memberId of memberIds) {
    await c.env.DB.prepare(
      "INSERT INTO chat_members (chat_id, user_id, role) VALUES (?, ?, 'member')"
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
    "INSERT INTO chats (id, type, name, created_by) VALUES (?, 'private', '', ?)"
  ).bind(id, userId).run();
  
  await c.env.DB.prepare(
    "INSERT INTO chat_members (chat_id, user_id, role) VALUES (?, ?, 'owner')"
  ).bind(id, userId).run();
  
  await c.env.DB.prepare(
    "INSERT INTO chat_members (chat_id, user_id, role) VALUES (?, ?, 'member')"
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
    `SELECT m.id, m.chat_id, m.chat_type, m.sender_id, m.content, m.original_content, m.edited_at, m.is_deleted, m.created_at, u.username as sender_username
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
    "SELECT m.id, m.chat_id, m.chat_type, m.sender_id, m.content, m.original_content, m.edited_at, m.is_deleted, m.created_at, u.username as sender_username FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?"
  ).bind(id).first();
  
  return c.json({ message });
});

const editMessageSchema = z.object({
  content: z.string().min(1).max(2000),
});

app.put('/api/messages/:messageId', zValidator('json', editMessageSchema), async (c) => {
  const userId = c.get('userId');
  const messageId = c.req.param('messageId');
  const { content } = c.req.valid('json');
  
  const message = await c.env.DB.prepare("SELECT * FROM messages WHERE id = ?").bind(messageId).first<any>();
  if (!message) {
    return c.json({ error: '消息不存在' }, 404);
  }
  
  if (message.sender_id !== userId) {
    return c.json({ error: '只能编辑自己的消息' }, 403);
  }
  
  const originalContent = message.original_content || message.content;
  
  await c.env.DB.prepare(
    "UPDATE messages SET content = ?, original_content = ?, edited_at = datetime('now') WHERE id = ?"
  ).bind(content, originalContent, messageId).run();
  
  const updated = await c.env.DB.prepare(
    "SELECT m.id, m.chat_id, m.chat_type, m.sender_id, m.content, m.original_content, m.edited_at, m.created_at, u.username as sender_username FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?"
  ).bind(messageId).first();
  
  return c.json({ message: updated });
});

app.delete('/api/messages/:messageId', async (c) => {
  const userId = c.get('userId');
  const messageId = c.req.param('messageId');
  
  const message = await c.env.DB.prepare("SELECT * FROM messages WHERE id = ?").bind(messageId).first<any>();
  if (!message) {
    return c.json({ error: '消息不存在' }, 404);
  }
  
  if (message.sender_id !== userId) {
    return c.json({ error: '只能删除自己的消息' }, 403);
  }
  
  await c.env.DB.prepare(
    "UPDATE messages SET is_deleted = 1, content = '此消息已被删除' WHERE id = ?"
  ).bind(messageId).run();
  
  return c.json({ success: true, messageId });
});

app.get('/api/chats/:chatId/members', async (c) => {
  const chatId = c.req.param('chatId');
  
  const members = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.status, cm.role, cm.joined_at
     FROM chat_members cm
     JOIN users u ON cm.user_id = u.id
     WHERE cm.chat_id = ?
     ORDER BY cm.role DESC, cm.joined_at ASC`
  ).bind(chatId).all();
  
  return c.json({ members: members.results });
});

const addMemberSchema = z.object({
  userId: z.string(),
});

app.post('/api/chats/:chatId/members', zValidator('json', addMemberSchema), async (c) => {
  const userId = c.get('userId');
  const chatId = c.req.param('chatId');
  const { userId: newMemberId } = c.req.valid('json');
  
  const chat = await c.env.DB.prepare("SELECT * FROM chats WHERE id = ?").bind(chatId).first<any>();
  if (!chat) {
    return c.json({ error: '聊天不存在' }, 404);
  }
  
  if (chat.type !== 'group') {
    return c.json({ error: '只能添加成员到群聊' }, 400);
  }
  
  const myRole = await c.env.DB.prepare(
    "SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?"
  ).bind(chatId, userId).first<any>();
  
  if (!myRole || (myRole.role !== 'owner' && myRole.role !== 'admin')) {
    return c.json({ error: '只有群主和管理员可以添加成员' }, 403);
  }
  
  const alreadyMember = await c.env.DB.prepare(
    "SELECT * FROM chat_members WHERE chat_id = ? AND user_id = ?"
  ).bind(chatId, newMemberId).first();
  
  if (alreadyMember) {
    return c.json({ error: '该用户已在群聊中' }, 400);
  }
  
  await c.env.DB.prepare(
    "INSERT INTO chat_members (chat_id, user_id, role) VALUES (?, ?, 'member')"
  ).bind(chatId, newMemberId).run();
  
  return c.json({ success: true });
});

app.delete('/api/chats/:chatId/members/:memberId', async (c) => {
  const userId = c.get('userId');
  const chatId = c.req.param('chatId');
  const memberId = c.req.param('memberId');
  
  const chat = await c.env.DB.prepare("SELECT * FROM chats WHERE id = ?").bind(chatId).first<any>();
  if (!chat) {
    return c.json({ error: '聊天不存在' }, 404);
  }
  
  if (chat.type !== 'group') {
    return c.json({ error: '只能移除群聊成员' }, 400);
  }
  
  const myRole = await c.env.DB.prepare(
    "SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?"
  ).bind(chatId, userId).first<any>();
  
  if (!myRole || (myRole.role !== 'owner' && myRole.role !== 'admin')) {
    return c.json({ error: '只有群主和管理员可以移除成员' }, 403);
  }
  
  if (memberId === chat.created_by) {
    return c.json({ error: '不能移除群主' }, 400);
  }
  
  await c.env.DB.prepare(
    "DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?"
  ).bind(chatId, memberId).run();
  
  return c.json({ success: true });
});

app.put('/api/chats/:chatId', zValidator('json', z.object({ name: z.string().min(1).max(50) })), async (c) => {
  const userId = c.get('userId');
  const chatId = c.req.param('chatId');
  const { name } = c.req.valid('json');
  
  const chat = await c.env.DB.prepare("SELECT * FROM chats WHERE id = ?").bind(chatId).first<any>();
  if (!chat) {
    return c.json({ error: '聊天不存在' }, 404);
  }
  
  if (chat.type !== 'group') {
    return c.json({ error: '只能修改群聊名称' }, 400);
  }
  
  if (chat.created_by !== userId) {
    return c.json({ error: '只有群主可以修改群聊名称' }, 403);
  }
  
  await c.env.DB.prepare(
    "UPDATE chats SET name = ? WHERE id = ?"
  ).bind(name, chatId).run();
  
  return c.json({ success: true, name });
});

app.post('/api/chats/:chatId/leave', async (c) => {
  const userId = c.get('userId');
  const chatId = c.req.param('chatId');
  
  const chat = await c.env.DB.prepare("SELECT * FROM chats WHERE id = ?").bind(chatId).first<any>();
  if (!chat) {
    return c.json({ error: '聊天不存在' }, 404);
  }
  
  if (chat.type !== 'group') {
    return c.json({ error: '只能退出群聊' }, 400);
  }
  
  if (chat.created_by === userId) {
    return c.json({ error: '群主不能退出群聊，请先转让群主或解散群聊' }, 400);
  }
  
  await c.env.DB.prepare(
    "DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?"
  ).bind(chatId, userId).run();
  
  return c.json({ success: true });
});

app.get('/api/unread', async (c) => {
  const userId = c.get('userId');
  
  const counts = await c.env.DB.prepare(
    "SELECT chat_id, count FROM unread_counts WHERE user_id = ? AND count > 0"
  ).bind(userId).all();
  
  return c.json({ unread: counts.results });
});

app.post('/api/unread/:chatId/read', async (c) => {
  const userId = c.get('userId');
  const chatId = c.req.param('chatId');
  
  await c.env.DB.prepare(
    "INSERT INTO unread_counts (user_id, chat_id, count) VALUES (?, ?, 0) ON CONFLICT(user_id, chat_id) DO UPDATE SET count = 0"
  ).bind(userId, chatId).run();
  
  return c.json({ success: true });
});

export default app;