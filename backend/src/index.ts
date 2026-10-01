import { Hono } from 'hono';
import { cors } from 'hono/cors';
import authHandler from './handlers/auth';
import chatHandler from './handlers/chat';
import friendsHandler from './handlers/friends';
import { ChatRoom } from './ws/chat-room';

const app = new Hono<{
  Bindings: {
    DB: D1Database;
    CHAT_ROOM: DurableObjectNamespace;
  };
}>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.get('/', (c) => {
  return c.json({ name: 'Chat API', version: '1.0.0' });
});

app.get('/ws', (c) => {
  const id = c.env.CHAT_ROOM.idFromName('global');
  const obj = c.env.CHAT_ROOM.get(id);
  return obj.fetch(c.req.raw);
});

app.route('/', authHandler);
app.route('/', chatHandler);
app.route('/', friendsHandler);

export default app;
export { ChatRoom };