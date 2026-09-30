# 实时聊天应用

一个基于 Cloudflare Workers 和 Pages 的实时聊天应用。

## 功能

- 用户注册/登录
- 公共聊天室（所有注册用户可见）
- 好友系统（通过 ID 添加好友）
- 群聊（创建和管理群组）
- 实时消息推送（WebSocket）

## 技术栈

- **前端**: React + TypeScript + Vite + Tailwind CSS
- **后端**: Cloudflare Workers + Hono + D1 数据库
- **实时通信**: WebSocket (Durable Objects)
- **部署**: Cloudflare Pages + Workers

## 本地开发

### 后端

```bash
cd backend
npm install
npm run dev
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

## 部署到 Cloudflare

### 1. 创建 D1 数据库

```bash
wrangler d1 create chat-db
```

将返回的 database_id 填入 `backend/wrangler.toml`

### 2. 设置环境变量

在 Cloudflare Workers 设置中添加 `JWT_SECRET` 环境变量

### 3. 部署后端

```bash
cd backend
npm run deploy
```

### 4. 部署前端

```bash
cd frontend
npm run build
npx wrangler pages deploy dist
```

## 项目结构

```
chat/
├── backend/           # Cloudflare Workers 后端
│   ├── src/
│   │   ├── handlers/  # API 路由处理
│   │   ├── db/        # 数据库操作
│   │   ├── middleware/# 中间件
│   │   ├── types/     # 类型定义
│   │   ├── utils/     # 工具函数
│   │   └── ws/        # WebSocket 处理
│   └── wrangler.toml  # Workers 配置
└── frontend/          # React 前端
    ├── src/
    │   ├── components/# React 组件
    │   ├── pages/     # 页面组件
    │   ├── contexts/  # React Context
    │   ├── types/     # 类型定义
    │   └── utils/     # 工具函数
    └── wrangler.toml  # Pages 配置
```