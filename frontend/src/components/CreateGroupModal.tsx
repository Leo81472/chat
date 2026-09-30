import { useState } from 'react';
import { Friend } from '../types';

interface CreateGroupModalProps {
  friends: Friend[];
  onClose: () => void;
  onCreate: (name: string, memberIds: string[]) => void;
}

export default function CreateGroupModal({ friends, onClose, onCreate }: CreateGroupModalProps) {
  const [name, setName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  const toggleMember = (friendId: string) => {
    setSelectedMembers(prev =>
      prev.includes(friendId)
        ? prev.filter(id => id !== friendId)
        : [...prev, friendId]
    );
  };

  const handleCreate = () => {
    if (!name.trim() || selectedMembers.length === 0) return;
    onCreate(name.trim(), selectedMembers);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div 
        className="bg-slate-800 rounded-2xl shadow-xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">创建群聊</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">群聊名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入群聊名称"
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              maxLength={50}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              选择成员 ({selectedMembers.length})
            </label>
            <div className="max-h-48 overflow-y-auto space-y-2">
              {friends.length === 0 ? (
                <p className="text-slate-500 text-center py-4">暂无好友可添加</p>
              ) : (
                friends.map((friend) => (
                  <label
                    key={friend.id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-700 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedMembers.includes(friend.id)}
                      onChange={() => toggleMember(friend.id)}
                      className="w-4 h-4 rounded border-slate-600 text-blue-600 focus:ring-blue-500 bg-slate-700"
                    />
                    <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                      {friend.username[0].toUpperCase()}
                    </div>
                    <span className="text-white">{friend.username}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-700 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || selectedMembers.length === 0}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            创建
          </button>
        </div>
      </div>
    </div>
  );
}