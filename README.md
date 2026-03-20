# 图片转 3D 生成器 · Meshy AI

基于 [Meshy Image-to-3D API](https://docs.meshy.ai/zh/api/image-to-3d) 的本地图片转 3D 网页工具。上传一张图片，AI 自动生成 3D 模型，支持在线预览与多格式下载。

---

## 功能特性

- **图片上传**：点击选择或拖拽上传，支持 JPG / PNG / WEBP
- **自动压缩**：上传前自动压缩大图（最大边 2048px，≤5MB）
- **参数配置**：艺术风格、拓扑结构、多边形数量、PBR 材质、重新拓扑
- **实时进度**：优先 SSE 长连接接收进度推送，自动降级为轮询（4s 间隔）
- **3D 预览**：Three.js r168 加载 GLB，支持鼠标旋转 / 滚轮缩放 / 平移
- **URL 展示**：生成完成后直接在页面展示所有格式的原始 URL，一键复制
- **调试预览**：可直接粘贴已有模型 URL 预览，无需重新生成
- **本地日志**：所有关键日志自动写入 `app.log`，方便事后查阅模型 URL 等信息
- **多格式下载**：GLB / FBX / OBJ / USDZ 等格式直接下载

---

## 目录结构

```
meshy-image-to-3d/
├── index.html    # 主页面，完整 UI 结构
├── style.css     # 样式，玻璃拟态设计风格
├── app.js        # 核心逻辑（API / Three.js / 事件处理）
├── server.js     # 本地开发服务器（静态文件 + CORS 代理 + 日志落盘）
├── app.log       # 运行时日志（自动生成，.gitignore 排除）
└── README.md
```

> `app.log` 由 `server.js` 自动创建，记录每次运行的完整日志，可直接搜索历史模型 URL。

---

## 快速开始

### 1. 获取 API Key

前往 [Meshy 控制台](https://app.meshy.ai/account/api-keys) 创建并复制您的 API Key。

### 2. 配置 API Key

启动服务后，在页面右侧"生成配置"区域顶部的 API Key 输入框中填入你的 Key，填写后会自动保存到浏览器 `localStorage`，下次打开无需重填。

> 也可以直接修改 `app.js` 顶部 `CONFIG.API_KEY` 字段作为默认值。

### 3. 启动本地服务器

项目使用 Node.js 内置服务器（含 CORS 代理，**必须使用**，否则 GLB 模型因跨域无法加载）：

```bash
node server.js
```

访问 `http://localhost:8765`。

> ⚠️ 不可用 `python -m http.server` 或直接双击打开，CDN 模型文件会被浏览器 CORS 策略拦截。

---

## 使用说明

| 步骤 | 操作 |
|------|------|
| ① | 在左侧上传区拖入或点击选择图片 |
| ② | 在"生成配置"中按需调整参数 |
| ③ | 点击"开始生成 3D 模型"按钮 |
| ④ | 右侧进度区实时显示生成状态（通常需 1~5 分钟） |
| ⑤ | 生成完成后，3D 模型自动加载到预览区 |
| ⑥ | "下载模型"区域展示各格式 URL 及下载按钮 |

### 参数说明

| 参数 | 选项 | 说明 |
|------|------|------|
| 艺术风格 | 写实 / 卡通 | 影响模型贴图风格 |
| 拓扑结构 | 三角面 / 四边面 | 四边面更适合后期编辑 |
| 多边形数量 | 自动 / 10K / 30K / 100K | 数值越高细节越多，生成越慢 |
| PBR 材质 | 开 / 关 | 生成金属度、粗糙度等物理材质贴图 |
| 重新拓扑 | 开 / 关 | 优化网格结构，适合动画制作 |

### 调试预览

在页面右侧占位区底部有"调试：粘贴 GLB URL 直接预览"输入框，可将 `app.log` 中历史记录的模型 URL 粘贴进去直接渲染，无需重新生成模型。

---

## 生成流程

```
用户上传图片
     │
     ▼
图片读取 & 压缩
(FileReader + Canvas，最大 2048px / 5MB，转 Base64)
     │
     ▼
POST /openapi/v1/image-to-3d          ← Meshy API
(携带 Base64 图片 + 配置参数)
     │
     ▼
获得 task_id
     │
     ├─────────────────────────────────────────────────┐
     ▼                                                 ▼
SSE 长连接（优先）                              轮询兜底（3s 后启动）
GET /image-to-3d/{id}/stream             GET /image-to-3d/{id}
fetch + ReadableStream 读取               setInterval 4000ms
     │                                                 │
     └──────────────┬──────────────────────────────────┘
                    ▼
          handleTaskUpdate(data)
          解析 status / progress / model_urls
                    │
          ┌─────────┼──────────┐
          ▼         ▼          ▼
       PENDING  IN_PROGRESS  SUCCEEDED / FAILED
       更新进度条  更新进度条   停止 SSE + 轮询
                              │
                              ▼
                    onTaskSucceeded(model_urls)
                              │
                 ┌────────────┼────────────┐
                 ▼            ▼            ▼
           渲染下载按钮   展示原始 URL   loadModelInViewer(glbUrl)
           (各格式下载)  (一键复制)           │
                                            ▼
                                   toProxyUrl(rawUrl)
                                   外部 URL → /proxy?url=...
                                   （绕过 CORS）
                                            │
                                            ▼
                                   GLTFLoader.load(proxyUrl)
                                   → 服务端转发 assets.meshy.ai
                                            │
                                            ▼
                                   Three.js 场景渲染
                                   (PerspectiveCamera + OrbitControls
                                    + 自动适配包围盒 + 环境光)
```

### CORS 代理流程

```
浏览器                      server.js (localhost:8765)           assets.meshy.ai
   │                               │                                    │
   │  GET /proxy?url=https://...   │                                    │
   │──────────────────────────────▶│                                    │
   │                               │  GET https://assets.meshy.ai/...  │
   │                               │──────────────────────────────────▶│
   │                               │◀──────────────────────────────────│
   │                               │  添加 Access-Control-Allow-Origin:*│
   │◀──────────────────────────────│                                    │
   │  GLB 二进制数据（无跨域限制）   │                                    │
```

### 日志落盘流程

```
app.js log()
     │
     ├── console.log(...)          ← 浏览器 DevTools 可见
     │
     └── fetch POST /log           ← 发往 server.js
              │
              ▼
         server.js /log 端点
              │
              ▼
         fs.appendFile('app.log')  ← 追加写入本地文件
```

---

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| HTML5 + CSS3 | — | UI 结构与玻璃拟态样式 |
| Vanilla JavaScript | ES2020+ | 核心业务逻辑 |
| [Three.js](https://threejs.org/) | r168 | 3D 模型渲染 |
| GLTFLoader | r168 | GLB / GLTF 模型加载 |
| OrbitControls | r168 | 鼠标交互控制 |
| Fetch API + ReadableStream | — | SSE 进度推送（手动读流） |
| FileReader + Canvas API | — | 图片读取与压缩 |
| Node.js `http` / `https` / `fs` | ≥16 | 本地服务器 + CORS 代理 + 日志落盘 |

---

## API 接口

基于 [Meshy Image-to-3D API](https://docs.meshy.ai/zh/api/image-to-3d)：

| 方法 | 端点 | 说明 |
|------|------|------|
| `POST` | `/openapi/v1/image-to-3d` | 创建生成任务，返回 `task_id` |
| `GET` | `/openapi/v1/image-to-3d/{id}` | 查询任务状态（轮询） |
| `GET` | `/openapi/v1/image-to-3d/{id}/stream` | SSE 实时进度流 |

本地服务器额外端点：

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/proxy?url=<encoded>` | CORS 代理，转发外部 CDN 请求 |
| `POST` | `/log` | 接收前端日志，追加写入 `app.log` |

---

## 调试经验

### 问题 1：`Cannot access 'x' before initialization`

**原因**：`let`/`const` 存在暂时性死区（TDZ），在变量声明之前使用会报错，即使是同一作用域内写在前面的语句也不例外。  
**表现**：`initThree` 中日志语句写在 `const w` / `const h` 声明之前，导致运行时崩溃。  
**解决**：确保所有引用变量的语句都在对应 `const`/`let` 声明**之后**。

### 问题 2：CORS 拦截 CDN 模型文件

**原因**：`assets.meshy.ai` 的 CDN 响应不携带 `Access-Control-Allow-Origin` 头，浏览器拒绝 Three.js 的 `fetch` 请求。  
**表现**：控制台报 `ERR_FAILED 200 (OK)`，模型实际已返回 200 但被浏览器拦截。  
**解决**：Node.js 服务器增加 `/proxy` 端点，由服务端转发请求并补充 CORS 头；前端所有外部 GLB URL 通过 `toProxyUrl()` 转为代理路径。

### 问题 3：无法复用已生成的模型 URL

**背景**：每次调试 Three.js 渲染都需要重新调用 API 生成模型，耗时且消耗配额。  
**解决**：  
1. 页面底部增加调试输入框，可直接粘贴 URL 预览。  
2. `app.log` 自动记录每次生成的 `model_urls`，历史 URL 随时可查。  
3. 生成完成后页面直接展示所有格式原始 URL，一键复制。

---

## 模型数据存储机制

### 模型存放在哪里？

网页上展示的模型来源有两种情况：

#### 情况一：通过 API 生成的模型（远程 URL）

模型文件存放在 **Meshy 的云端服务器**（`assets.meshy.ai`）。加载流程如下：

```
Meshy API 返回 model_urls
  └─ glbUrl = model_urls.glb（例如 https://assets.meshy.ai/xxx.glb）
       └─ loadModelInViewer(glbUrl)
            └─ 经过本地代理 /proxy?url=... 转发
                 └─ GLTFLoader 加载渲染
```

#### 情况二：本地文件加载

模型文件存放在**本地磁盘**，通过拖拽或点击选择进入。加载流程如下：

```
用户选择本地文件（.glb / .gltf / .obj / .fbx）
  └─ URL.createObjectURL(file) 生成临时内存 URL
       └─ GLTFLoader / OBJLoader / FBXLoader 加载渲染
            └─ 加载完毕后 URL.revokeObjectURL() 释放内存
```

### 模型是实时从云端拉取还是下载到本地？

通过 API 生成的模型展示时，**不会将文件写入本地磁盘**。浏览器通过代理把远程 GLB 文件流式读取到内存，交给 Three.js 解析渲染，全程数据只存在于浏览器内存和 GPU 显存中：

```
Meshy 云端 .glb 文件
      ↓  HTTP 请求（经过 /proxy 转发）
  浏览器内存（ArrayBuffer）
      ↓  GLTFLoader 解析
  Three.js 场景（GPU 显存）
      ↓  WebGL 渲染
  屏幕上的画面
```

关闭页面或刷新后，模型数据即消失。

### 三种存储方式对比

| 存储方式 | 关闭页面后 | 用途 |
|----------|-----------|------|
| 浏览器内存（渲染模型） | 消失 | Three.js 实时渲染 |
| `localStorage` | **保留** | API Key 持久化存储 |
| 本地磁盘文件 | **保留** | 需主动点击下载才会保存 |

> 如需永久保存模型，请点击页面上的**下载按钮**，将 `.glb` 等格式文件保存到本地磁盘。

---

## 注意事项

- ⚠️ API Key 存储在本地文件中，**请勿将包含 Key 的代码提交到公共仓库**
- `app.log` 中含有模型 URL（带签名 token），同样不建议提交，建议加入 `.gitignore`
- 图片建议主体清晰、背景简单，生成效果更佳
- 免费账户有 API 调用次数限制，参考 [Meshy 定价](https://www.meshy.ai/pricing)
- 生成时间受模型复杂度和服务器负载影响，一般为 1~5 分钟
- 必须通过 `node server.js` 启动服务，不支持直接双击 `index.html`

---

## 相关链接

- [Meshy 官网](https://www.meshy.ai/)
- [API 文档](https://docs.meshy.ai/zh)
- [Image-to-3D API](https://docs.meshy.ai/zh/api/image-to-3d)
- [API Key 管理](https://app.meshy.ai/account/api-keys)
- [Three.js 文档](https://threejs.org/docs/)
