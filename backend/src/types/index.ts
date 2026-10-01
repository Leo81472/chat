export interface User {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
}

export interface Message {
  id: string;
  chat_id: string;
  chat_type: 'public' | 'private' | 'group';
  sender_id: string;
  content: string;
  created_at: string;
}

export interface Chat {
  id: string;
  type: 'public' | 'private' | 'group';
  name?: string;
  created_by: string;
  created_at: string;
}

export interface ChatMember {
  chat_id: string;
  user_id: string;
  joined_at: string;
}

export interface Friendship {
  id: string;
  user_id: string;
  friend_id: string;
  created_at: string;
}

export interface WebSocketMessage {
  type: 'message' | 'join' | 'leave' | 'typing' | 'ping' | 'pong';
  chat_id?: string;
  content?: string;
  user_id?: string;
  username?: string;
  timestamp?: string;
}

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  CHAT_ROOM: DurableObjectNamespace;
}