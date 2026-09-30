import { Chat, Message } from '../types';

export function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days}天前`;
  return date.toLocaleDateString('zh-CN');
}

export function getChatDisplayName(chat: Chat, currentUserId: string): string {
  if (chat.type === 'public') return '公共聊天';
  if (chat.type === 'group') return chat.name || '群聊';
  return '私聊';
}

export function getChatIcon(chat: Chat): string {
  switch (chat.type) {
    case 'public': return '🌐';
    case 'group': return '👥';
    case 'private': return '💬';
    default: return '💬';
  }
}