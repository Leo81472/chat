export class ChatRoom implements DurableObject {
  private storage: DurableObjectStorage;
  private sessions: Map<string, WebSocket>;
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

    this.sessions.set(userId, ws);

    ws.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data as string);
        
        if (data.type === 'message') {
          await this.storage.put(`message:${Date.now()}`, data);
          
          this.sessions.forEach((session, sessionId) => {
            if (sessionId !== userId && session.readyState === WebSocket.OPEN) {
              session.send(JSON.stringify({
                type: 'message',
                id: Date.now().toString(),
                chat_id: data.chat_id,
                chat_type: data.chat_type || 'public',
                user_id: data.user_id,
                username: data.username,
                content: data.content,
                timestamp: data.timestamp || new Date().toISOString(),
              }));
            }
          });
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

interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  CHAT_ROOM: DurableObjectNamespace;
}