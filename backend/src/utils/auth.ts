export function generateId(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'chat-app-salt-2024');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const computedHash = await hashPassword(password);
  return computedHash === hash;
}

export function generateToken(payload: { id: string; username: string }, secret: string): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify({ ...payload, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 }));
  const signature = btoa(header + '.' + body + '.' + secret);
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token: string, secret: string): { id: string; username: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const body = JSON.parse(atob(parts[1]));
    if (body.exp < Date.now()) return null;
    
    const expectedSignature = btoa(parts[0] + '.' + parts[1] + '.' + secret);
    if (parts[2] !== expectedSignature) return null;
    
    return { id: body.id, username: body.username };
  } catch {
    return null;
  }
}