import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import { Chat, Message, Friend } from '../types';
import { formatTime, getChatDisplayName, getChatIcon } from '../utils/helpers';
import FriendsPanel from '../components/FriendsPanel';
import CreateGroupModal from '../components/CreateGroupModal';

export default function ChatRoom() {
  const { user, token, logout } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [showFriends, setShowFriends] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [showDissolveConfirm, setShowDissolveConfirm] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const connectWebSocket = useCallback(() => {
    if (!user || !token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${token}&userId=${user.id}`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'message' && data.chat_id === activeChat?.id) {
          setMessages(prev => [...prev, {
            id: data.id || Date.now().toString(),
            chat_id: data.chat_id!,
            chat_type: data.chat_type || 'public',
            sender_id: data.user_id!,
            sender_username: data.username!,
            content: data.content!,
            created_at: data.timestamp || new Date().toISOString(),
          }]);
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message', e);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error', error);
    };
  }, [user, token, activeChat]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      wsRef.current?.close();
    };
  }, [connectWebSocket]);

  useEffect(() => {
    const fetchChats = async () => {
      try {
        const [chatsRes, friendsRes] = await Promise.all([
          api.get('/api/chats'),
          api.get('/api/friends'),
        ]);
        setChats(chatsRes.data.chats || []);
        setFriends(friendsRes.data.friends || []);
      } catch (error) {
        console.error('Failed to fetch chats', error);
      } finally {
        setLoading(false);
      }
    };
    fetchChats();
  }, []);

  useEffect(() => {
    if (activeChat) {
      const fetchMessages = async () => {
        try {
          const res = await api.get(`/api/chats/${activeChat.id}/messages`);
          setMessages(res.data.messages || []);
        } catch (error) {
          console.error('Failed to fetch messages', error);
        }
      };
      fetchMessages();
    }
  }, [activeChat]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !activeChat) return;

    const content = newMessage.trim();
    setNewMessage('');

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'message',
        chat_id: activeChat.id,
        content,
        user_id: user?.id,
        username: user?.username,
        timestamp: new Date().toISOString(),
      }));
    }

    try {
      await api.post(`/api/chats/${activeChat.id}/messages`, { content });
    } catch (error) {
      console.error('Failed to send message', error);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleCreateGroup = async (name: string, memberIds: string[]) => {
    try {
      const res = await api.post('/api/chats/group', { name, memberIds });
      setChats(prev => [res.data.chat, ...prev]);
      setShowCreateGroup(false);
    } catch (error) {
      console.error('Failed to create group', error);
    }
  };

  const startPrivateChat = async (friendId: string) => {
    try {
      const res = await api.post('/api/chats/private', { friendId });
      const chat = res.data.chat;
      setChats(prev => {
        const exists = prev.find(c => c.id === chat.id);
        if (exists) return prev;
        return [chat, ...prev];
      });
      setActiveChat(chat);
      setShowFriends(false);
    } catch (error) {
      console.error('Failed to start private chat', error);
    }
  };

  const dissolveGroup = async () => {
    if (!activeChat || activeChat.type !== 'group') return;
    try {
      await api.delete(`/api/chats/${activeChat.id}`);
      setChats(prev => prev.filter(c => c.id !== activeChat.id));
      setActiveChat(null);
      setShowDissolveConfirm(false);
    } catch (error) {
      console.error('Failed to dissolve group', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">加载中...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-slate-900">
      <div className="w-80 bg-slate-800 border-r border-slate-700 flex flex-col">
        <div className="p-4 border-b border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white">聊天</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setShowFriends(!showFriends)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                title="好友"
              >
                👤
              </button>
              <button
                onClick={() => setShowCreateGroup(true)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                title="创建群聊"
              >
                👥
              </button>
              <button
                onClick={logout}
                className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded-lg transition-colors"
                title="退出登录"
              >
                🚪
              </button>
            </div>
          </div>
          <div className="text-sm text-slate-400">
            欢迎, <span className="text-blue-400">{user?.username}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {chats.map(chat => (
            <button
              key={chat.id}
              onClick={() => setActiveChat(chat)}
              className={`w-full p-4 flex items-center gap-3 hover:bg-slate-700/50 transition-colors text-left ${
                activeChat?.id === chat.id ? 'bg-slate-700/50' : ''
              }`}
            >
              <span className="text-2xl">{getChatIcon(chat)}</span>
              <div className="flex-1 min-w-0">
                <div className="text-white font-medium truncate">
                  {getChatDisplayName(chat, user?.id || '')}
                </div>
                <div className="text-sm text-slate-400">
                  {chat.type === 'group' && `${chat.member_count || 0} 成员`}
                  {chat.type === 'public' && '所有人可见'}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {activeChat ? (
          <>
            <div className="p-4 border-b border-slate-700 bg-slate-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{getChatIcon(activeChat)}</span>
                  <div>
                    <h3 className="text-white font-medium">
                      {getChatDisplayName(activeChat, user?.id || '')}
                    </h3>
                    <p className="text-sm text-slate-400">
                      {activeChat.type === 'public' ? '公共聊天室' : 
                       activeChat.type === 'group' ? `${activeChat.member_count || 0} 名成员` : '私聊'}
                    </p>
                  </div>
                </div>
                {activeChat.type === 'group' && activeChat.created_by === user?.id && (
                  <button
                    onClick={() => setShowDissolveConfirm(true)}
                    className="px-3 py-1 text-sm text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded-lg transition-colors"
                  >
                    解散群聊
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg, index) => {
                const isOwn = msg.sender_id === user?.id;
                const showAvatar = index === 0 || messages[index - 1].sender_id !== msg.sender_id;
                
                return (
                  <div key={msg.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%] ${isOwn ? 'order-2' : 'order-1'}`}>
                      {showAvatar && (
                        <div className={`text-xs text-slate-400 mb-1 ${isOwn ? 'text-right' : 'text-left'}`}>
                          {msg.sender_username}
                        </div>
                      )}
                      <div className={`px-4 py-2 rounded-2xl ${
                        isOwn 
                          ? 'bg-blue-600 text-white rounded-br-md' 
                          : 'bg-slate-700 text-white rounded-bl-md'
                      }`}>
                        <p className="break-words">{msg.content}</p>
                      </div>
                      <div className={`text-xs text-slate-500 mt-1 ${isOwn ? 'text-right' : 'text-left'}`}>
                        {formatTime(msg.created_at)}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 border-t border-slate-700 bg-slate-800">
              <div className="flex gap-3">
                <input
                  ref={inputRef}
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="输入消息..."
                  className="flex-1 px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  onClick={sendMessage}
                  disabled={!newMessage.trim()}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  发送
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            <div className="text-center">
              <div className="text-6xl mb-4">💬</div>
              <p className="text-xl">选择一个聊天开始对话</p>
            </div>
          </div>
        )}
      </div>

      {showFriends && (
        <FriendsPanel
          friends={friends}
          onClose={() => setShowFriends(false)}
          onFriendAdded={() => {
            api.get('/api/friends').then(res => setFriends(res.data.friends || []));
          }}
          onStartChat={startPrivateChat}
        />
      )}

      {showCreateGroup && (
        <CreateGroupModal
          friends={friends}
          onClose={() => setShowCreateGroup(false)}
          onCreate={handleCreateGroup}
        />
      )}

      {showDissolveConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDissolveConfirm(false)}>
          <div 
            className="bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-white mb-2">确认解散群聊</h3>
            <p className="text-slate-400 mb-6">解散后所有聊天记录将被删除，此操作不可恢复。</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDissolveConfirm(false)}
                className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={dissolveGroup}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                确认解散
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}