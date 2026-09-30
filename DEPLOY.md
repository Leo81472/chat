# Cloudflare Pages 部署指南

## 前置准备

1. 注册 [Cloudflare](https://dash.cloudflare.com/sign-up) 账号
2. 安装 Wrangler CLI：
   ```bash
   npm install -g wrangler
   wrangler login
   ```

## 部署步骤

### 1. 推送到 GitHub

```bash
cd d:\vstrae\chat
git remote add origin https://github.com/你的用户名/仓库名.git
git branch -M main
git push -u origin main
```

### 2. 部署后端 (Cloudflare Workers)

#### 2.1 创建 D1 数据库

```bash
cd backend
npx wrangler d1 create chat-db
```

记录返回的 `database_id`，然后更新 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "chat-db"
database_id = "这里填入你的database_id"
```

#### 2.2 设置环境变量

```bash
npx wrangler secret put JWT_SECRET
```

输入一个安全的密钥（至少32个字符），例如：
```
my-super-secret-jwt-key-2024-chat-app
```

#### 2.3 部署 Workers

```bash
npx wrangler deploy
```

部署成功后会返回一个 URL，类似：
```
https://chat-backend.你的子域名.workers.dev
```

**记录这个 URL，后面会用到！**

### 3. 部署前端 (Cloudflare Pages)

#### 方式 A：通过 Cloudflare Dashboard（推荐）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 点击左侧 **Workers & Pages**
3. 点击 **Create Application** → **Pages** → **Connect to Git**
4. 授权并选择你的 GitHub 仓库
5. 配置构建设置：

   | 设置项 | 值 |
   |--------|-----|
   | Framework preset | Vite |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory (advanced) | `frontend` |

6. 点击 **Environment Variables (advanced)** 添加：
   - **Variable name**: `VITE_API_URL`
   - **Value**: `https://chat-backend.你的子域名.workers.dev`（替换为你的 Workers URL）

7. 点击 **Save and Deploy**

#### 方式 B：通过命令行

```bash
cd frontend

# 创建 .env.production 文件
echo "VITE_API_URL=https://你的workers子域名.workers.dev" > .env.production

# 构建并部署
npm run build
npx wrangler pages deploy dist --project-name=chat-app
```

### 4. 验证部署

1. 访问 Pages 提供的 URL（类似 `https://chat-app.pages.dev`）
2. 注册一个新账号
3. 登录并测试聊天功能

## 常见问题

### Q: 如何更新代码？

推送代码到 GitHub 后，Cloudflare Pages 会自动重新构建和部署。

### Q: 如何查看日志？

- **前端**: Cloudflare Dashboard → Pages → 你的项目 → Deployments → 点击部署 → View logs
- **后端**: Cloudflare Dashboard → Workers → 你的项目 → Logs

### Q: 如何添加自定义域名？

1. Cloudflare Dashboard → Pages → 你的项目 → Custom domains
2. 点击 **Set up a custom domain**
3. 输入你的域名并按照提示配置 DNS

### Q: WebSocket 连接失败？

确保：
1. Workers 的 URL 正确配置在前端的 `VITE_API_URL`
2. 使用 `wss://` 协议（生产环境自动使用 HTTPS）
3. 检查浏览器控制台是否有 CORS 错误

## 项目结构

```
chat/
├── backend/           # Cloudflare Workers (后端 API + WebSocket)
│   ├── src/
│   │   ├── handlers/  # API 路由
│   │   ├── db/        # D1 数据库
│   │   └── ws/        # WebSocket (Durable Objects)
│   ── wrangler.toml  # Workers 配置
└── frontend/          # Cloudflare Pages (React 前端)
    ├── src/
    └── wrangler.toml  # Pages 配置
```

## 技术栈

- **前端**: React + TypeScript + Vite + Tailwind CSS
- **后端**: Cloudflare Workers + Hono + D1 数据库
- **实时通信**: WebSocket (Durable Objects)
- **部署**: Cloudflare Pages + Workers