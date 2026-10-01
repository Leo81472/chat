import type { Env } from '../types';

export class ChatRoom implements DurableObject {
  private storage: DurableObjectStorage;
  private sessions: Map<string, { ws: WebSocket; chatIds: Set<string> }>;
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

  private handleWebSocket(ws: WebSocket, userId: string) {
    ws.accept();

    this.sessions.set(userId, { ws, chatIds: new Set() });

    ws.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data as string);
        
        if (data.type === 'message') {
          await this.storage.put(`message:${Date.now()}`, data);
          
          const chatId = data.chat_id;
          
          this.sessions.forEach((session, sessionId) => {
            if (sessionId !== userId && session.ws.readyState === WebSocket.OPEN) {
              if (chatId && session.chatIds.has(chatId)) {
                session.ws.send(JSON.stringify({
                  type: 'message',
                  id: Date.now().toString(),
                  chat_id: chatId,
                  chat_type: data.chat_type || 'public',
                  user_id: data.user_id,
                  username: data.username,
                  content: data.content,
                  timestamp: data.timestamp || new Date().toISOString(),
                }));
              }
            }
          });
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

    ws.addEventListener('close', () => {
      this.sessions.delete(userId);
    });

    ws.addEventListener('error', () => {
      this.sessions.delete(userId);
    });
  }
}