import { useState } from 'react';
import { Friend } from '../types';
import api from '../utils/api';

interface FriendsPanelProps {
  friends: Friend[];
  onClose: () => void;
  onFriendAdded: () => void;
  onStartChat: (friendId: string) => void;
}

export default function FriendsPanel({ friends, onClose, onFriendAdded, onStartChat }: FriendsPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await api.get(`/api/users/search?q=${encodeURIComponent(searchQuery)}`);
      setSearchResults(res.data.users || []);
    } catch (error) {
      console.error('Search failed', error);
    } finally {
      setSearching(false);
    }
  };

  const handleAddFriend = async (friendId: string) => {
    try {
      await api.post('/api/friends', { friendId });
      setMessage('已添加好友');
      onFriendAdded();
      setTimeout(() => setMessage(''), 2000);
    } catch (err: any) {
      setMessage(err.response?.data?.error || '添加失败');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div 
        className="bg-slate-800 rounded-2xl shadow-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">好友</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">
            ✕
          </button>
        </div>

        <div className="p-4 border-b border-slate-700">
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="搜索用户ID或用户名..."
              className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleSearch}
              disabled={searching}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {searching ? '...' : '搜索'}
            </button>
          </div>
          {message && (
            <p className="text-sm text-green-400 mt-2">{message}</p>
          )}
        </div>

        {searchResults.length > 0 && (
          <div className="p-4 border-b border-slate-700">
            <h4 className="text-sm font-medium text-slate-400 mb-2">搜索结果</h4>
            {searchResults.map((user) => (
              <div key={user.id} className="flex items-center justify-between py-2">
                <div>
                  <span className="text-white">{user.username}</span>
                  <span className="text-xs text-slate-500 ml-2">ID: {user.id}</span>
                </div>
                <button
                  onClick={() => handleAddFriend(user.id)}
                  className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors"
                >
                  添加
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          <h4 className="text-sm font-medium text-slate-400 mb-2">我的好友 ({friends.length})</h4>
          {friends.length === 0 ? (
            <p className="text-slate-500 text-center py-4">暂无好友</p>
          ) : (
            friends.map((friend) => (
              <button
                key={friend.id}
                onClick={() => onStartChat(friend.id)}
                className="w-full flex items-center gap-3 py-3 border-b border-slate-700/50 last:border-0 hover:bg-slate-700/50 rounded-lg px-2 transition-colors text-left"
              >
                <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-medium">
                  {friend.username[0].toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="text-white">{friend.username}</div>
                  <div className="text-xs text-slate-500">点击开始私聊</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}