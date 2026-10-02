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
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showMembersPanel, setShowMembersPanel] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editContent, setEditContent] = useState('');
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyMessage, setHistoryMessage] = useState<Message | null>(null);
  const [contextMenu, setContextMenu] = useState<{ msg: Message; x: number; y: number } | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const [isMobile, setIsMobile] = useState(false);
  const [showMobileChatList, setShowMobileChatList] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeChatRef = useRef<Chat | null>(null);

  activeChatRef.current = activeChat;

  // 检测设备类型
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 移动端选择聊天后自动隐藏列表
  const handleSelectChat = (chat: Chat) => {
    setActiveChat(chat);
    if (isMobile) {
      setShowMobileChatList(false);
    }
  };

  // 移动端返回聊天列表
  const handleBackToList = () => {
    setShowMobileChatList(true);
    setActiveChat(null);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const connectWebSocket = useCallback(() => {
    if (!user || !token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//quickchat-api.cc.cd/ws?token=${token}&userId=${user.id}`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      if (activeChatRef.current) {
        ws.send(JSON.stringify({ type: 'join', chat_id: activeChatRef.current.id }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'message') {
          const newMsg: Message = {
            id: data.id || Date.now().toString(),
            chat_id: data.chat_id!,
            chat_type: data.chat_type || 'public',
            sender_id: data.user_id!,
            sender_username: data.username!,
            content: data.content!,
            created_at: data.timestamp || new Date().toISOString(),
          };
          setMessages(prev => {
            const tempId = data.tempId;
            if (tempId) {
              const tempIndex = prev.findIndex(m => m.id === tempId);
              if (tempIndex !== -1) {
                const updated = [...prev];
                updated[tempIndex] = newMsg;
                return updated;
              }
            }
            const exists = prev.some(m => m.id === newMsg.id);
            if (exists) return prev;
            return [...prev, newMsg];
          });
          
          // 发送桌面通知（如果不是自己发的消息，且当前不在该聊天窗口）
          if (data.user_id !== user?.id && data.chat_id !== activeChatRef.current?.id) {
            // 检查页面是否可见
            const isPageVisible = document.visibilityState === 'visible';
            
            // 如果页面不可见（在后台），或者用户不在该聊天窗口，则发送通知
            if (!isPageVisible || data.chat_id !== activeChatRef.current?.id) {
              sendNotification(`${data.username}`, data.content);
            }
          }
        } else if (data.type === 'edit') {
          setMessages(prev => prev.map(m => m.id === data.id ? { ...m, content: data.content, original_content: data.original_content, edited_at: data.edited_at } : m));
        } else if (data.type === 'delete') {
          setMessages(prev => prev.map(m => m.id === data.message_id ? { ...m, content: '此消息已被删除', is_deleted: true } : m));
        } else if (data.type === 'status') {
          setOnlineUsers(prev => {
            const next = new Set(prev);
            if (data.status === 'online') {
              next.add(data.user_id);
            } else {
              next.delete(data.user_id);
            }
            return next;
          });
          
          // 同时更新好友列表中的状态
          setFriends(prev => prev.map(f => 
            f.id === data.user_id ? { ...f, status: data.status as 'online' | 'offline' } : f
          ));
        } else if (data.type === 'unread') {
          setUnreadCounts(prev => ({
            ...prev,
            [data.chat_id]: (prev[data.chat_id] || 0) + 1,
          }));
        } else if (data.type === 'pong') {
          console.log('Pong received');
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message', e);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected, reconnecting...');
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error', error);
    };
  }, [user, token]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (activeChatRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'leave', chat_id: activeChatRef.current.id }));
      }
      wsRef.current?.close();
    };
  }, [connectWebSocket]);

  useEffect(() => {
    if (activeChat && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'join', chat_id: activeChat.id }));
      api.post(`/api/unread/${activeChat.id}/read`).then(() => {
        setUnreadCounts(prev => {
          const next = { ...prev };
          delete next[activeChat.id];
          return next;
        });
      });
    }
  }, [activeChat]);

  useEffect(() => {
    // 请求通知权限
    if ('Notification' in window && notificationPermission === 'default') {
      Notification.requestPermission().then(permission => {
        setNotificationPermission(permission);
      });
    }
    
    // 重新获取好友列表以获取最新在线状态
    const refreshFriendsStatus = async () => {
      try {
        const friendsRes = await api.get('/api/friends');
        const friendsData = friendsRes.data.friends || [];
        setFriends(friendsData);
        
        // 更新在线用户列表（包括自己）
        const onlineUserIds = new Set<string>();
        if (user?.id) {
          onlineUserIds.add(user.id); // 自己始终在线
        }
        friendsData.forEach((f: Friend) => {
          if (f.status === 'online') {
            onlineUserIds.add(f.id);
          }
        });
        setOnlineUsers(onlineUserIds);
      } catch (error) {
        console.error('Failed to refresh friends status', error);
      }
    };
    
    // 在WebSocket连接后延迟刷新，确保后端已更新状态
    const timer = setTimeout(refreshFriendsStatus, 1000);
    return () => clearTimeout(timer);
  }, []);

  const sendNotification = (title: string, body: string) => {
    if ('Notification' in window && notificationPermission === 'granted') {
      new Notification(title, {
        body,
        icon: '/vite.svg',
      });
    }
  };

  // 后台轮询机制：当页面在后台时，定期检查新消息
  useEffect(() => {
    let pollingInterval: number | null = null;
    let lastUnreadCount = 0;

    const checkForNewMessages = async () => {
      try {
        const unreadRes = await api.get('/api/unread');
        const unreadList = unreadRes.data.unread || [];
        const totalCount = unreadList.reduce((sum: number, u: any) => sum + u.count, 0);
        
        // 如果未读消息数量增加，说明有新消息
        if (totalCount > lastUnreadCount && lastUnreadCount > 0) {
          // 获取最新的未读消息详情
          for (const unread of unreadList) {
            if (unread.count > 0) {
              const chat = chats.find(c => c.id === unread.chat_id);
              if (chat) {
                sendNotification(
                  `新消息 - ${getChatDisplayName(chat, user?.id || '')}`,
                  `您有 ${unread.count} 条未读消息`
                );
                break; // 只发送一个通知避免刷屏
              }
            }
          }
        }
        
        lastUnreadCount = totalCount;
      } catch (error) {
        console.error('Failed to check for new messages', error);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // 页面进入后台，启动轮询（每10秒检查一次）
        pollingInterval = setInterval(checkForNewMessages, 10000);
      } else {
        // 页面回到前台，停止轮询
        if (pollingInterval) {
          clearInterval(pollingInterval);
          pollingInterval = null;
        }
        // 重置未读计数
        lastUnreadCount = 0;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [chats, user]);

  useEffect(() => {
    const fetchChats = async () => {
      try {
        const [chatsRes, friendsRes, unreadRes] = await Promise.all([
          api.get('/api/chats'),
          api.get('/api/friends'),
          api.get('/api/unread'),
        ]);
        setChats(chatsRes.data.chats || []);
        const friendsData = friendsRes.data.friends || [];
        setFriends(friendsData);
        
        // 初始化在线用户列表
        const onlineUserIds = new Set<string>();
        friendsData.forEach((f: Friend) => {
          if (f.status === 'online') {
            onlineUserIds.add(f.id);
          }
        });
        setOnlineUsers(onlineUserIds);
        
        const unreadMap: Record<string, number> = {};
        (unreadRes.data.unread || []).forEach((u: any) => {
          unreadMap[u.chat_id] = u.count;
        });
        setUnreadCounts(unreadMap);
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
    } else {
      setMessages([]);
    }
  }, [activeChat]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !activeChat || !user) return;

    const content = newMessage.trim();
    setNewMessage('');

    const tempId = `temp-${Date.now()}`;
    const tempMsg: Message = {
      id: tempId,
      chat_id: activeChat.id,
      chat_type: activeChat.type,
      sender_id: user.id,
      sender_username: user.username,
      content,
      created_at: new Date().toISOString(),
    };

    setMessages(prev => [...prev, tempMsg]);
    scrollToBottom();

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'message',
        chat_id: activeChat.id,
        chat_type: activeChat.type,
        content,
        user_id: user.id,
        username: user.username,
        timestamp: new Date().toISOString(),
        tempId,
      }));
    } else {
      try {
        const res = await api.post(`/api/chats/${activeChat.id}/messages`, { content });
        setMessages(prev => prev.map(m => m.id === tempId ? res.data.message : m));
      } catch (error) {
        console.error('Failed to send message', error);
        setMessages(prev => prev.filter(m => m.id !== tempId));
      }
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

  const dissolveGroup = async () => {
    if (!activeChat || activeChat.type !== 'group') return;
    try {
      await api.delete(`/api/chats/${activeChat.id}`);
      
      // 本地移除群聊
      setChats(prev => prev.filter(c => c.id !== activeChat.id));
      setActiveChat(null);
      setShowDissolveConfirm(false);
    } catch (error: any) {
      console.error('Failed to dissolve group', error);
      alert(error.response?.data?.error || '解散群聊失败，请重试');
    }
  };

  const leaveGroup = async () => {
    if (!activeChat) return;
    try {
      await api.post(`/api/chats/${activeChat.id}/leave`);
      setChats(prev => prev.filter(c => c.id !== activeChat.id));
      setActiveChat(null);
      setShowLeaveConfirm(false);
      
      // 重新获取聊天列表以确保状态同步
      const chatsRes = await api.get('/api/chats');
      setChats(chatsRes.data.chats || []);
    } catch (error) {
      console.error('Failed to leave group', error);
    }
  };

  const deleteAccount = async () => {
    if (!deletePassword.trim()) {
      setDeleteError('请输入密码');
      return;
    }
    try {
      await api.post('/api/auth/delete', { password: deletePassword });
      setDeleteError('');
      localStorage.removeItem('token');
      window.location.href = '/login';
    } catch (error: any) {
      setDeleteError(error.response?.data?.error || '注销失败，请检查密码');
    }
  };

  const openEditModal = (msg: Message) => {
    setEditingMessage(msg);
    setEditContent(msg.content);
    setShowEditModal(true);
    setContextMenu(null);
  };

  const saveEdit = async () => {
    if (!editingMessage || !editContent.trim()) return;
    try {
      const res = await api.put(`/api/messages/${editingMessage.id}`, { content: editContent.trim() });
      setMessages(prev => prev.map(m => m.id === editingMessage.id ? res.data.message : m));
      setShowEditModal(false);
      setEditingMessage(null);
    } catch (error) {
      console.error('Failed to edit message', error);
    }
  };

  const deleteMessage = async (msg: Message) => {
    try {
      await api.delete(`/api/messages/${msg.id}`);
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: '此消息已被删除', is_deleted: true } : m));
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'delete',
          message_id: msg.id,
          chat_id: msg.chat_id,
        }));
      }
    } catch (error) {
      console.error('Failed to delete message', error);
    }
    setContextMenu(null);
  };

  const viewHistory = (msg: Message) => {
    setHistoryMessage(msg);
    setShowHistoryModal(true);
    setContextMenu(null);
  };

  const handleContextMenu = (e: React.MouseEvent, msg: Message) => {
    e.preventDefault();
    if (msg.sender_id === user?.id) {
      setContextMenu({ msg, x: e.clientX, y: e.clientY });
    }
  };

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">加载中...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-slate-900">
      {/* 聊天列表侧边栏 - 桌面端固定显示，移动端根据状态显示 */}
      <div className={`${
        isMobile 
          ? (showMobileChatList ? 'w-full' : 'hidden') 
          : 'w-80'
      } bg-slate-800 border-r border-slate-700 flex flex-col ${isMobile ? '' : 'flex-shrink-0'}`}>
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
                onClick={async () => {
                  if (!('Notification' in window)) {
                    alert('您的浏览器不支持通知功能');
                    return;
                  }
                  
                  if (notificationPermission === 'granted') {
                    alert('通知已启用！');
                    return;
                  }
                  
                  if (notificationPermission === 'denied') {
                    alert('通知已被拒绝，请在浏览器设置中手动开启');
                    return;
                  }
                  
                  try {
                    const permission = await Notification.requestPermission();
                    setNotificationPermission(permission);
                    if (permission === 'granted') {
                      new Notification('通知已启用！', {
                        body: '您现在可以接收消息通知了',
                        icon: '/vite.svg',
                      });
                    }
                  } catch (error) {
                    console.error('Failed to request notification permission', error);
                  }
                }}
                className={`p-2 hover:bg-slate-700 rounded-lg transition-colors ${
                  notificationPermission === 'granted' ? 'text-green-400' : 'text-slate-400 hover:text-white'
                }`}
                title={notificationPermission === 'granted' ? '通知已启用' : notificationPermission === 'denied' ? '通知已拒绝' : '启用通知'}
              >
                🔔
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
            <span className={`ml-2 inline-block w-2 h-2 rounded-full ${onlineUsers.has(user?.id || '') ? 'bg-green-500' : 'bg-gray-500'}`}></span>
          </div>
        </div>

        {/* 设置按钮 - 左下角 */}
        <div className="p-3 border-t border-slate-700">
          <button
            onClick={() => setShowSettings(true)}
            className="w-full flex items-center gap-3 px-3 py-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <span className="text-lg">⚙️</span>
            <span className="text-sm">设置</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {chats.map(chat => (
            <button
              key={chat.id}
              onClick={() => handleSelectChat(chat)}
              className={`w-full p-4 flex items-center gap-3 hover:bg-slate-700/50 transition-colors text-left ${
                activeChat?.id === chat.id ? 'bg-slate-700/50' : ''
              }`}
            >
              <span className="text-2xl">{getChatIcon(chat)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="text-white font-medium truncate">
                    {getChatDisplayName(chat, user?.id || '')}
                  </div>
                  {unreadCounts[chat.id] ? (
                    <span className="ml-2 px-1.5 py-0.5 text-xs bg-red-500 text-white rounded-full">
                      {unreadCounts[chat.id]}
                    </span>
                  ) : null}
                </div>
                <div className="text-sm text-slate-400">
                  {chat.type === 'group' && `${chat.member_count || 0} 成员`}
                  {chat.type === 'public' && '所有人可见'}
                  {chat.type === 'private' && '私聊'}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 聊天主区域 */}
      <div className={`${
        isMobile 
          ? (showMobileChatList ? 'hidden' : 'w-full') 
          : 'flex-1'
      } flex flex-col`}>
        {activeChat ? (
          <>
            {/* 聊天头部 - 移动端显示返回按钮 */}
            <div className="p-4 border-b border-slate-700 bg-slate-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {isMobile && (
                    <button
                      onClick={handleBackToList}
                      className="p-1 text-slate-400 hover:text-white mr-1"
                    >
                      ←
                    </button>
                  )}
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
                <div className="flex gap-2">
                  {activeChat.type === 'group' && (
                    <button
                      onClick={() => setShowMembersPanel(true)}
                      className="px-3 py-1 text-sm text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                    >
                      成员
                    </button>
                  )}
                  {activeChat.type === 'group' && activeChat.created_by === user?.id && (
                    <button
                      onClick={() => setShowDissolveConfirm(true)}
                      className="px-3 py-1 text-sm text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded-lg transition-colors"
                    >
                      解散群聊
                    </button>
                  )}
                  {activeChat.type === 'group' && activeChat.created_by !== user?.id && (
                    <button
                      onClick={() => setShowLeaveConfirm(true)}
                      className="px-3 py-1 text-sm text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                    >
                      退出群聊
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* 消息区域 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg) => {
                const isOwn = msg.sender_id === user?.id;
                
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
                    onContextMenu={(e) => handleContextMenu(e, msg)}
                  >
                    <div className={`max-w-[70%] ${isMobile ? 'max-w-[85%]' : ''} ${isOwn ? 'order-2' : 'order-1'}`}>
                      <div className={`text-xs text-slate-400 mb-1 ${isOwn ? 'text-right' : 'text-left'}`}>
                        {msg.sender_username || '未知用户'}
                      </div>
                      <div className={`px-4 py-2 rounded-2xl ${
                        isOwn 
                          ? 'bg-blue-600 text-white rounded-br-md' 
                          : 'bg-slate-700 text-white rounded-bl-md'
                      } ${msg.is_deleted ? 'opacity-50 italic' : ''}`}>
                        <p className="break-words">{msg.content}</p>
                        {msg.edited_at && (
                          <span className="text-xs opacity-60 ml-1">(已编辑)</span>
                        )}
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

            {/* 输入区域 */}
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

      {contextMenu && (
        <div
          className="fixed bg-slate-700 rounded-lg shadow-xl py-1 z-50 min-w-[120px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => openEditModal(contextMenu.msg)}
            className="w-full px-4 py-2 text-left text-sm text-white hover:bg-slate-600"
          >
            ✏️ 编辑
          </button>
          {contextMenu.msg.original_content && (
            <button
              onClick={() => viewHistory(contextMenu.msg)}
              className="w-full px-4 py-2 text-left text-sm text-white hover:bg-slate-600"
            >
              📜 查看历史
            </button>
          )}
          <button
            onClick={() => deleteMessage(contextMenu.msg)}
            className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-slate-600"
          >
            🗑️ 删除
          </button>
        </div>
      )}

      {showEditModal && editingMessage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowEditModal(false)}>
          <div className="bg-slate-800 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-4">编辑消息</h3>
            <div className="mb-4 p-3 bg-slate-700 rounded-lg">
              <p className="text-xs text-slate-400 mb-1">原消息</p>
              <p className="text-white">{editingMessage.original_content || editingMessage.content}</p>
            </div>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4 resize-none"
              rows={3}
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowEditModal(false)}
                className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={saveEdit}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {showHistoryModal && historyMessage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowHistoryModal(false)}>
          <div className="bg-slate-800 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-4">📜 消息历史</h3>
            <div className="space-y-3">
              <div className="p-3 bg-slate-700 rounded-lg border-l-4 border-green-500">
                <p className="text-xs text-green-400 mb-1">原始消息</p>
                <p className="text-white">{historyMessage.original_content || historyMessage.content}</p>
              </div>
              <div className="p-3 bg-slate-700 rounded-lg border-l-4 border-blue-500">
                <p className="text-xs text-blue-400 mb-1">当前消息</p>
                <p className="text-white">{historyMessage.content}</p>
              </div>
              {historyMessage.edited_at && (
                <p className="text-xs text-slate-500">编辑时间: {formatTime(historyMessage.edited_at)}</p>
              )}
            </div>
            <button
              onClick={() => setShowHistoryModal(false)}
              className="mt-4 w-full py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {showMembersPanel && activeChat && (
        <MembersPanel
          chat={activeChat}
          onClose={() => setShowMembersPanel(false)}
          onMembersChange={() => {
            api.get('/api/chats').then(res => setChats(res.data.chats || []));
          }}
        />
      )}

      {showFriends && (
        <FriendsPanel
          friends={friends}
          onClose={() => setShowFriends(false)}
          onFriendAdded={() => {
            api.get('/api/friends').then(res => setFriends(res.data.friends || []));
            api.get('/api/chats').then(res => setChats(res.data.chats || []));
          }}
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

      {showLeaveConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowLeaveConfirm(false)}>
          <div 
            className="bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-white mb-2">确认退出群聊</h3>
            <p className="text-slate-400 mb-6">退出后将无法再接收该群聊的消息。</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowLeaveConfirm(false)}
                className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={leaveGroup}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                确认退出
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 设置面板 */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowSettings(false)}>
          <div 
            className="bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">设置</h3>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white text-xl">
                ✕
              </button>
            </div>
            <div className="p-4">
              <button
                onClick={() => {
                  setShowSettings(false);
                  setShowDeleteConfirm(true);
                  setDeletePassword('');
                  setDeleteError('');
                }}
                className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium"
              >
                注销账号
              </button>
              <p className="text-xs text-slate-500 mt-2 text-center">注销后所有数据将被永久删除，不可恢复</p>
            </div>
          </div>
        </div>
      )}

      {/* 注销账号确认 */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setShowDeleteConfirm(false); setDeleteError(''); }}>
          <div 
            className="bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-white mb-2">注销账号</h3>
            <p className="text-slate-400 mb-4">请输入密码以确认注销账号。此操作不可恢复，所有聊天记录、好友关系将被永久删除。</p>
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => { setDeletePassword(e.target.value); setDeleteError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && deleteAccount()}
              placeholder="输入密码..."
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 mb-3"
              autoFocus
            />
            {deleteError && (
              <p className="text-sm text-red-400 mb-3">{deleteError}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => { setShowDeleteConfirm(false); setDeleteError(''); }}
                className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={deleteAccount}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                确认注销
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MembersPanel({ chat, onClose, onMembersChange }: { chat: Chat; onClose: () => void; onMembersChange: () => void }) {
  const { user } = useAuth();
  const [members, setMembers] = useState<any[]>([]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [friends, setFriends] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMembers = async () => {
      try {
        const [membersRes, friendsRes] = await Promise.all([
          api.get(`/api/chats/${chat.id}/members`),
          api.get('/api/friends'),
        ]);
        setMembers(membersRes.data.members || []);
        setFriends(friendsRes.data.friends || []);
      } catch (error) {
        console.error('Failed to fetch members', error);
      } finally {
        setLoading(false);
      }
    };
    fetchMembers();
  }, [chat.id]);

  const addMember = async (friendId: string) => {
    try {
      await api.post(`/api/chats/${chat.id}/members`, { userId: friendId });
      const res = await api.get(`/api/chats/${chat.id}/members`);
      setMembers(res.data.members || []);
      onMembersChange();
      setShowAddMember(false);
    } catch (error: any) {
      alert(error.response?.data?.error || '添加失败');
    }
  };

  const removeMember = async (memberId: string) => {
    if (!confirm('确定要移除该成员吗？')) return;
    try {
      await api.delete(`/api/chats/${chat.id}/members/${memberId}`);
      const res = await api.get(`/api/chats/${chat.id}/members`);
      setMembers(res.data.members || []);
      onMembersChange();
    } catch (error: any) {
      alert(error.response?.data?.error || '移除失败');
    }
  };

  const isOwner = chat.created_by === user?.id;
  const isAdmin = members.find(m => m.id === user?.id)?.role === 'admin';
  const canManage = isOwner || isAdmin;

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-slate-800 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
          <p className="text-white text-center">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-slate-800 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">群成员 ({members.length})</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">&times;</button>
        </div>

        {canManage && (
          <button
            onClick={() => setShowAddMember(!showAddMember)}
            className="mb-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm"
          >
            + 添加成员
          </button>
        )}

        {showAddMember && (
          <div className="mb-4 p-3 bg-slate-700 rounded-lg max-h-40 overflow-y-auto">
            {friends
              .filter(f => !members.some(m => m.id === f.id))
              .map(friend => (
                <button
                  key={friend.id}
                  onClick={() => addMember(friend.id)}
                  className="w-full text-left px-3 py-2 text-white hover:bg-slate-600 rounded transition-colors text-sm"
                >
                  {friend.username}
                </button>
              ))}
            {friends.filter(f => !members.some(m => m.id === f.id)).length === 0 && (
              <p className="text-slate-400 text-sm text-center py-2">没有可添加的好友</p>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-2">
          {members.map(member => (
            <div key={member.id} className="flex items-center justify-between p-3 bg-slate-700 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
                  {member.username?.[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="text-white text-sm font-medium">{member.username}</p>
                  <p className="text-xs text-slate-400">
                    {member.role === 'owner' ? '群主' : member.role === 'admin' ? '管理员' : '成员'}
                    <span className={`ml-2 inline-block w-2 h-2 rounded-full ${member.status === 'online' ? 'bg-green-500' : 'bg-gray-500'}`}></span>
                  </p>
                </div>
              </div>
              {canManage && member.role !== 'owner' && member.id !== user?.id && (
                <button
                  onClick={() => removeMember(member.id)}
                  className="text-red-400 hover:text-red-300 text-sm"
                >
                  移除
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}