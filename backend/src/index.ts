import { Hono } from 'hono';
import { cors } from 'hono/cors';
import authHandler from './handlers/auth';
import chatHandler from './handlers/chat';
import friendsHandler from './handlers/friends';
export { ChatRoom } from './ws/chat-room';

const app = new Hono();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.get('/', (c) => {
  return c.json({ name: 'Chat API', version: '1.0.0' });
});

app.route('/api', authHandler);
app.route('/api', chatHandler);
app.route('/api', friendsHandler);

export default app;