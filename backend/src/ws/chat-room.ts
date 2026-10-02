import type { Env } from '../types';

export class ChatRoom implements DurableObject {
  private storage: DurableObjectStorage;
  private sessions: Map<string, { ws: WebSocket; chatIds: Set<string>; userId: string }>;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.storage = state.storage;
    this.sessions = new Map();
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    const token = url.searchParams.get('token');

    if (!userId || !token) {
      return new Response('Unauthorized', { status: 401 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.handleWebSocket(server, userId);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private async broadcastStatus(userId: string, status: 'online' | 'offline') {
    const statusMsg = JSON.stringify({
      type: 'status',
      user_id: userId,
      status,
      timestamp: new Date().toISOString(),
    });

    this.sessions.forEach((session) => {
      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(statusMsg);
      }
    });
  }

  private handleWebSocket(ws: WebSocket, userId: string) {
    ws.accept();

    this.sessions.set(userId, { ws, chatIds: new Set(), userId });

    // 发送所有已在线用户的状态给新用户
    this.sessions.forEach((session, sessionId) => {
      if (sessionId !== userId && session.ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'status',
          user_id: sessionId,
          status: 'online',
          timestamp: new Date().toISOString(),
        }));
      }
    });

    // 广播新用户上线给所有已连接的用户
    this.broadcastStatus(userId, 'online');

    ws.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data as string);
        
        if (data.type === 'message') {
          const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          
          await this.env.DB.prepare(
            "INSERT INTO messages (id, chat_id, chat_type, sender_id, content) VALUES (?, ?, ?, ?, ?)"
          ).bind(messageId, data.chat_id, data.chat_type || 'public', data.user_id, data.content).run();
          
          const chatId = data.chat_id;
          const broadcastMsg = {
            type: 'message',
            id: messageId,
            chat_id: chatId,
            chat_type: data.chat_type || 'public',
            user_id: data.user_id,
            username: data.username,
            content: data.content,
            timestamp: data.timestamp || new Date().toISOString(),
            tempId: data.tempId,
          };
          
          this.sessions.forEach((session, sessionId) => {
            if (session.ws.readyState === WebSocket.OPEN) {
              if (chatId && session.chatIds.has(chatId)) {
                session.ws.send(JSON.stringify(broadcastMsg));
              } else if (sessionId !== data.user_id) {
                session.ws.send(JSON.stringify({
                  type: 'unread',
                  chat_id: chatId,
                }));
              }
            }
          });
        } else if (data.type === 'edit') {
          const messageId = data.message_id;
          const message = await this.env.DB.prepare("SELECT * FROM messages WHERE id = ?").bind(messageId).first<any>();
          
          if (message && message.sender_id === data.user_id) {
            const originalContent = message.original_content || message.content;
            
            await this.env.DB.prepare(
              "UPDATE messages SET content = ?, original_content = ?, edited_at = datetime('now') WHERE id = ?"
            ).bind(data.content, originalContent, messageId).run();
            
            const updated = await this.env.DB.prepare(
              "SELECT m.id, m.chat_id, m.chat_type, m.sender_id, m.content, m.original_content, m.edited_at, m.created_at, u.username as sender_username FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?"
            ).bind(messageId).first();
            
            const broadcastMsg = {
              type: 'edit',
              ...updated,
              timestamp: new Date().toISOString(),
            };
            
            this.sessions.forEach((session) => {
              if (session.ws.readyState === WebSocket.OPEN && session.chatIds.has(data.chat_id)) {
                session.ws.send(JSON.stringify(broadcastMsg));
              }
            });
          }
        } else if (data.type === 'delete') {
          const messageId = data.message_id;
          const message = await this.env.DB.prepare("SELECT * FROM messages WHERE id = ?").bind(messageId).first<any>();
          
          if (message && message.sender_id === data.user_id) {
            await this.env.DB.prepare(
              "UPDATE messages SET is_deleted = 1, content = '此消息已被删除' WHERE id = ?"
            ).bind(messageId).run();
            
            const broadcastMsg = {
              type: 'delete',
              message_id: messageId,
              chat_id: data.chat_id,
              timestamp: new Date().toISOString(),
            };
            
            this.sessions.forEach((session) => {
              if (session.ws.readyState === WebSocket.OPEN && session.chatIds.has(data.chat_id)) {
                session.ws.send(JSON.stringify(broadcastMsg));
              }
            });
          }
        } else if (data.type === 'join') {
          const session = this.sessions.get(userId);
          if (session && data.chat_id) {
            session.chatIds.add(data.chat_id);
          }
        } else if (data.type === 'leave') {
          const session = this.sessions.get(userId);
          if (session && data.chat_id) {
            session.chatIds.delete(data.chat_id);
          }
        } else if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });

    ws.addEventListener('close', async () => {
      this.sessions.delete(userId);
      await this.broadcastStatus(userId, 'offline');
      
      await this.env.DB.prepare(
        "UPDATE users SET status = 'offline', last_seen = datetime('now') WHERE id = ?"
      ).bind(userId).run();
    });

    ws.addEventListener('error', async () => {
      this.sessions.delete(userId);
      await this.broadcastStatus(userId, 'offline');
    });
  }
}