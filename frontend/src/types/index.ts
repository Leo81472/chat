export interface User {
  id: string;
  username: string;
  avatar?: string;
  status?: 'online' | 'offline' | 'away';
  last_seen?: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
}

export interface Chat {
  id: string;
  type: 'public' | 'private' | 'group';
  name?: string;
  avatar?: string;
  created_by: string;
  created_at: string;
  member_count?: number;
  other_user?: { id: string; username: string };
  my_role?: 'owner' | 'admin' | 'member';
}

export interface Message {
  id: string;
  chat_id: string;
  chat_type: 'public' | 'private' | 'group';
  sender_id: string;
  sender_username: string;
  content: string;
  original_content?: string;
  edited_at?: string;
  is_deleted?: boolean;
  created_at: string;
}

export interface Friend {
  id: string;
  username: string;
  status?: 'online' | 'offline' | 'away';
  created_at: string;
}

export interface WebSocketMessage {
  type: 'message' | 'join' | 'leave' | 'typing' | 'ping' | 'pong' | 'status' | 'delete' | 'edit';
  chat_id?: string;
  content?: string;
  user_id?: string;
  username?: string;
  timestamp?: string;
  message_id?: string;
  status?: 'online' | 'offline' | 'away';
}