import { Context, MiddlewareHandler } from 'hono';
import { verifyToken } from '../utils/auth';

export const verifyAuth: MiddlewareHandler<{
  Bindings: { JWT_SECRET: string };
  Variables: { userId: string; username: string };
}> = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: '未授权' }, 401);
  }
  
  const token = authHeader.slice(7);
  const payload = verifyToken(token, c.env.JWT_SECRET);
  
  if (!payload) {
    return c.json({ error: '令牌无效' }, 401);
  }
  
  c.set('userId', payload.id);
  c.set('username', payload.username);
  
  await next();
};