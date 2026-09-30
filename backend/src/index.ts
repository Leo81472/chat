import { Hono } from 'hono';
import { cors } from 'hono/cors';
import authHandler from './handlers/auth';
import chatHandler from './handlers/chat';
import friendsHandler from './handlers/friends';

const app = new Hono<{
  Bindings: {
    DB: D1Database;
    JWT_SECRET: string;
    CHAT_ROOM: DurableObjectNamespace;
  };
}>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.route('/', authHandler);
app.route('/', chatHandler);
app.route('/', friendsHandler);

app.get('/', (c) => {
  return c.json({ name: 'Chat API', version: '1.0.0' });
});

export default app;