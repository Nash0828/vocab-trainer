# 背单词助手（Vocab Trainer）

一个基于 Vue 3 + Node.js + SQLite 的个人背单词小工具，支持单词录入、智能抽题、错题本、背诵统计等功能，适合个人学习使用。

## 功能特性

### 单词录入
- 录入字段：中文释义、英文单词、词性
- 重复校验：中文或英文重复时阻止录入并提示
- 词库管理：支持查看、行内编辑、删除、单个重置背诵次数

### 背单词
- **智能抽题**：加权随机算法，熟练程度低（背诵次数少）的单词优先出现
- **反向答题**：显示中文释义，输入对应英文（不区分大小写）
- **自动朗读**：答题后自动朗读正确单词发音（有道词典接口，美音）
- **答错处理**：答错后停在当前题显示正确答案，可重做或手动下一题；按回车也可继续
- **显示答案**：未作答时可点击"显示答案"，按答错处理（记入错题本）
- **出题来源切换**：全部未背熟 / 仅错题本

### 背诵进度
- 可设置背熟阈值（默认 5 次），答对一次累加一次
- 达到阈值的单词自动移出出题池，标记为"已背熟"
- 词库页用进度条和绿色徽标区分已背熟/未背熟
- 支持一键重置所有单词的背诵次数

### 错题本
- 答错的单词自动记入错题本
- 答对后自动移出错题本
- 可单独查看、单个移除、一键清空

### 统计与历史
- **今日统计**：当天正确/错误次数、去重单词数（重复单词只统计一次）
- **历史记录**：按天维度汇总，每天显示正确/错误次数与去重单词数
- 支持清空某天或全部历史记录

### 数据管理
- **导入/导出**：导出 JSON 备份文件（含单词、背诵次数、设置），支持合并或覆盖导入
- **本地迁移**：旧版本 localStorage 数据可一键迁移到 SQLite 数据库

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | Vue 3 + Vue Router + Vite |
| 后端 | Node.js + Express |
| 数据库 | SQLite（better-sqlite3，单文件数据库） |
| 发音 | 有道词典接口 `dict.youdao.com/dictvoice` |

## 本地开发

### 环境要求
- Node.js 22+
- npm

### 安装依赖
```bash
npm install
```

### 启动开发环境（两个终端）

**终端 1：启动后端 API（端口 3000）**
```bash
node server/index.js
```

**终端 2：启动前端开发服务（端口 5173）**
```bash
npm run dev
```

打开浏览器访问 **http://localhost:5173/**

> 前端开发服务已配置代理，`/api/*` 请求会自动转发到后端 3000 端口。

## 生产部署

### 构建并启动
```bash
# 1. 构建前端（输出到 dist/）
npm run build

# 2. 启动服务（同时托管前端页面和 API，端口 3000）
npm start
```

访问 **http://服务器IP:3000/**

### 推荐部署方式（阿里云）

1. 服务器安装 Node.js 22+
2. 上传项目代码（git clone 或 scp）
3. 安装依赖并构建：
   ```bash
   npm install
   npm run build
   ```
4. 用 pm2 守护进程启动：
   ```bash
   npm install -g pm2
   pm2 start server/index.js --name vocab-trainer
   ```
5. （可选）配置 Nginx 反向代理到 3000 端口，配合域名和 HTTPS

## 项目结构

```
vocab-trainer/
├── server/                 # 后端
│   ├── db.js              # SQLite 数据库初始化
│   └── index.js           # Express 路由 + 静态文件托管
├── src/
│   ├── api/
│   │   └── index.js       # 前端 fetch 封装
│   ├── composables/
│   │   ├── useWords.js     # 词库数据层
│   │   ├── useHistory.js   # 背诵历史数据层
│   │   └── useWrongBook.js # 错题本数据层
│   ├── views/
│   │   ├── InputView.vue        # 单词录入页
│   │   ├── PracticeView.vue     # 背单词页
│   │   ├── LibraryView.vue     # 词库管理页
│   │   ├── WrongBookView.vue    # 错题本页
│   │   ├── HistoryView.vue      # 历史记录页
│   │   └── SettingsView.vue     # 设置页
│   ├── router/index.js     # 路由配置
│   ├── App.vue             # 左侧边栏布局
│   └── main.js             # 入口（启动时先加载数据）
├── vocab.db                # SQLite 数据库文件（运行时自动生成）
└── package.json
```

## 数据存储

所有数据存储在项目根目录下的 `vocab.db` 文件中（SQLite 数据库），包括：

- **words**：单词表（中文、英文、词性、背诵次数、录入时间）
- **settings**：设置表（背熟阈值）
- **records**：背诵记录表（按天统计）
- **wrongbook**：错题本表

**备份**：直接复制 `vocab.db` 文件即可。
**迁移到其他服务器**：把 `vocab.db` 文件一起拷过去。

## 从旧版本迁移

如果之前使用过纯前端版本（数据存在浏览器 localStorage），打开设置页底部的"从浏览器本地迁移旧数据"按钮，即可一键将旧数据导入到 SQLite 数据库。

## 开源协议

MIT
