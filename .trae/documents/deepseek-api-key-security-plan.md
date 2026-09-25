# DeepSeek API Key 安全迁移计划

## Summary

当前 GitHub Pages 部署流程将 `DEEPSEEK_API_KEY` 从 GitHub Variables 写入公开的 `site/app-config.js`。这只能保护构建过程，不能保护构建产物；任何访问网页的人都能从静态资源、DevTools Network、运行时变量或请求头中读取 Key。

在纯浏览器中无法安全保存供多人共用的秘密。采用已确认的方案：

- 复用仓库现有 Cloudflare Worker，不增加传统服务器。
- 将 DeepSeek Key 存为 Cloudflare Worker Secret。
- 使用 Cloudflare Access 的邮箱/SSO 白名单保护 Worker。
- Worker 提供固定 operation 白名单，而不是通用聊天转发接口。
- GitHub Pages 只保存非敏感的 Worker URL。
- 本次只迁移 DeepSeek Key；豆包搜索 Key 暂时仍由前端持有，这是已接受的残余风险。

实施前必须立即撤销并重建当前已发布过的 DeepSeek Key。仅从页面删除旧 Key 不能使已经泄露的 Key 失效。

## Current State Analysis

### 静态页面

- `index.html` 先加载公开资源 `app-config.js`，再加载 `index.js`。
- `app-config.js` 定义 `window.DAIBAN_HOME_CONFIG`，包含：
  - `DOUBAO_SEARCH_API_URL`
  - `DEEPSEEK_API_KEY`
  - `DOUBAO_SEARCH_API_KEY`
- `index.js`：
  - 从 `DEPLOYMENT_CONFIG.DEEPSEEK_API_KEY` 读取共享 Key。
  - `callDeepSeekJson()` 直接请求 `https://api.deepseek.com/chat/completions`。
  - 浏览器请求头直接携带 `Authorization: Bearer <DeepSeek Key>`。
  - 当前活动入口 `generateKeywordCandidates()` 依赖配置中的 DeepSeek Key。
  - 文件中共有 8 个 `callDeepSeekJson()` 业务调用阶段。

### GitHub Pages 部署

- `.github/workflows/deploy-pages.yml` 将 GitHub Variables 中的 `DEEPSEEK_API_KEY` 写入 `site/app-config.js`。
- 生成后的 `app-config.js` 是公开静态文件，因此 Key 必然可读。
- GitHub Variables 不适合秘密；即使改为 GitHub Secrets，只要最终写入 Pages 文件，仍然会泄露。

### Cloudflare Worker

- 仓库已有 `cloudflare-worker/` 和自动部署工作流。
- Worker 当前仅提供 `/doubao-search`，并要求浏览器传入豆包 Key。
- Worker 已有 `ALLOWED_ORIGIN`，但现有 CORS 逻辑不是身份认证，也不能阻止 curl 或伪造 Origin 的直接调用。
- 当前没有 DeepSeek 路由、DeepSeek Secret、Access 配置说明或请求额度约束。

## Proposed Changes

### 1. 立即处置现有密钥

不依赖代码发布，先执行以下人工操作：

1. 在 DeepSeek 控制台撤销当前被注入 Pages 的 Key。
2. 创建新的 DeepSeek Key，仅用于 Worker。
3. 删除 GitHub Pages Environment/Repository Variable 中的 `DEEPSEEK_API_KEY`。
4. 不再将新 Key 放入 GitHub Variables、仓库文件、Pages 构建产物或浏览器存储。
5. 将新 Key 添加为 GitHub Actions Secret `DEEPSEEK_API_KEY`，供 Worker 部署流程写入 Cloudflare Secret。

### 2. 新增 Worker 固定操作定义

新增文件：`cloudflare-worker/src/deepseek-operations.js`

定义 operation 到服务器端 Prompt 的固定映射。覆盖现有全部 8 个 DeepSeek 阶段：

- `event-clue-analysis`
- `evidence-merge`
- `keyword-search-plan`
- `keyword-extraction`
- `candidate-repair`
- `search-plan`
- `sample-classification`
- `boundary-review`

每个 operation 固定：

- 中文业务名称。
- System Prompt。
- DeepSeek 模型 `deepseek-v4-flash`。
- `temperature: 0.15`。
- `response_format: { type: "json_object" }`。
- 输入大小上限和输出 token 上限。

前端不能提交自定义模型、System Prompt、温度或任意 messages，从而避免已认证用户把代理当作通用 DeepSeek API。

### 3. 扩展 Cloudflare Worker

修改：`cloudflare-worker/src/index.js`

保留现有 `/doubao-search` 行为，新增：

#### `POST /deepseek-json`

请求格式：

```json
{
  "operation": "keyword-search-plan",
  "input": {
    "source": "新闻原文"
  }
}
```

响应成功格式：

```json
{
  "result": {}
}
```

实现要求：

- 只允许 `POST` 和 `OPTIONS`。
- Origin 必须精确匹配 `ALLOWED_ORIGIN`；不匹配时直接返回 `403`，不能仅返回 `Access-Control-Allow-Origin: null` 后继续处理。
- 请求体上限 128 KB。
- `operation` 必须存在于服务端白名单。
- `input` 必须是 JSON 对象或数组。
- 使用 `env.DEEPSEEK_API_KEY` 在 Worker 内构造 Authorization。
- 固定 DeepSeek URL、模型和参数。
- 解析 DeepSeek 返回的 JSON 文本，统一返回 `{ result }`。
- 上游非 2xx、无效 JSON、超时分别返回明确的 4xx/5xx 错误。
- 所有响应添加 `Cache-Control: no-store`。
- 日志不得输出 Key、Authorization、完整用户输入或完整模型输出。
- 为 DeepSeek 请求设置超时，建议 60 秒。

#### `GET /auth-check`

用于用户建立/验证 Cloudflare Access 会话，成功返回：

```json
{
  "ok": true
}
```

该路由与 `/deepseek-json` 一样受 Cloudflare Access 保护。

### 4. 配置 Worker Secret 自动部署

修改：`.github/workflows/deploy-worker.yml`

- 从 GitHub Actions Secret 读取 `DEEPSEEK_API_KEY`。
- 使用 `cloudflare/wrangler-action` 的 secrets 输入将其写为 Worker Secret。
- 不将 Key写入 `wrangler.toml`、命令参数、构建文件或日志。
- 保留 `ALLOWED_ORIGIN` 的非敏感配置注入。

修改：`cloudflare-worker/wrangler.toml`

- 仅保留非敏感配置。
- 不新增明文 `DEEPSEEK_API_KEY`。
- 如使用 Worker Custom Domain，在配置或部署文档中明确关闭公开 `workers.dev` 入口，避免绕过 Access。

### 5. 配置 Cloudflare Access

新增：`cloudflare-worker/README.md`

记录必须人工完成的 Cloudflare 设置：

1. 为 Worker 配置自定义域名。
2. 在 Cloudflare Zero Trust 创建 Self-hosted Access Application，覆盖 Worker 的全部路由。
3. 建立 Allow Policy，仅允许指定邮箱、邮箱域或企业 SSO 用户。
4. 设置合理会话时长，例如 8 小时。
5. 配置跨域预检，使 GitHub Pages Origin 能完成 `OPTIONS`。
6. Worker CORS 只允许实际 GitHub Pages Origin，并允许凭据：
   - `Access-Control-Allow-Origin: <精确 Pages Origin>`
   - `Access-Control-Allow-Credentials: true`
   - `Access-Control-Allow-Headers: Content-Type`
7. 禁用或同样保护默认 `*.workers.dev` 地址。
8. 在 Cloudflare Dashboard 为 `/deepseek-json` 配置按 Access 用户/IP 的速率限制和每日告警。

Access 是真正的调用者认证；CORS、隐藏 URL、Referer 校验、代码混淆都不能替代认证。

### 6. 清理 GitHub Pages 密钥注入

修改：`.github/workflows/deploy-pages.yml`

- 删除 Pages 构建环境中的 `DEEPSEEK_API_KEY`。
- 删除生成配置中的 `DEEPSEEK_API_KEY`。
- 新增非敏感变量 `DEEPSEEK_PROXY_API_URL`，值为受 Access 保护的：

```text
https://<worker-custom-domain>/deepseek-json
```

修改：`app-config.js`

- 删除 `DEEPSEEK_API_KEY`。
- 新增空值占位 `DEEPSEEK_PROXY_API_URL`。
- 保留用户已决定暂不迁移的豆包配置。

### 7. 前端改为调用固定代理

修改：`index.js`

#### 配置调整

- 删除 `DEEPSEEK_API_URL`。
- 删除 `DEEPSEEK_API_KEY_STORAGE`。
- 删除 `CONFIGURED_DEEPSEEK_API_KEY`。
- 新增 `DEEPSEEK_PROXY_API_URL`，读取公开配置中的 Worker URL。

#### 请求函数

将：

```js
callDeepSeekJson(apiKey, stage, systemPrompt, input)
```

改为：

```js
callDeepSeekJson(operation, stage, input)
```

新函数：

- 请求 `DEEPSEEK_PROXY_API_URL`。
- 使用 `credentials: "include"` 携带 Cloudflare Access 会话。
- 请求体仅包含 `{ operation, input }`。
- 不设置 DeepSeek Authorization。
- 接收 Worker 的 `{ result }`。
- 收到 Access 登录页、`401` 或 `403` 时给出“请先登录 AI 服务”的明确提示。

#### 调用点迁移

将现有 8 个调用点改成固定 operation，并把当前 `JSON.stringify(...)` 输入改为结构化对象：

- `事件线索分析` → `event-clue-analysis`
- `搜索证据归并` → `evidence-merge`
- `检索计划生成` → `keyword-search-plan`
- `新闻关键词提取` → `keyword-extraction`
- `候选格式修复` → `candidate-repair`
- `搜索计划生成` → `search-plan`
- `样本分类与候选生成` → `sample-classification`
- `临界候选复核` → `boundary-review`

删除前端中的对应 System Prompt，Prompt 只保留在 Worker。

#### 状态和死代码清理

- `generateKeywordCandidates()` 不再读取或校验 DeepSeek Key，只校验代理 URL。
- `updateApiKeyStatus()` 将 DeepSeek 状态改为“AI 服务代理已配置/未配置”。
- 移除已无 DOM 入口、仍尝试从 localStorage 读取 Key 的旧 `generateWithDeepSeek()` 及仅被它使用的 DeepSeek Key 存储逻辑；保留豆包当前逻辑。

### 8. Access 登录体验

修改：`index.html`

- 在 AI 生成区域增加“登录 AI 服务”链接或按钮。
- 链接打开 Worker 同域 `/auth-check`，完成 Cloudflare Access 登录后用户返回页面。
- 不展示、输入或保存 DeepSeek Key。

修改：`index.css`

- 复用现有按钮样式，仅补充登录入口的必要布局。
- 不增加新的卡片层级。

## Assumptions & Decisions

- GitHub Pages 继续作为纯静态站点。
- Cloudflare Worker 是允许使用的“无传统后端”可信执行环境。
- Cloudflare Access 使用邮箱/SSO 白名单。
- Worker 使用自定义域名，默认 `workers.dev` 地址被禁用或同样保护。
- DeepSeek 代理采用固定 operation 白名单，不支持任意聊天请求。
- DeepSeek Key 只存在于 Cloudflare Secret。
- 当前暴露过的 DeepSeek Key 视为已泄露，必须轮换。
- 本次只迁移 DeepSeek Key。
- `DOUBAO_SEARCH_API_KEY` 仍会出现在公开 `app-config.js` 和浏览器请求中，仍可被盗用；这是用户明确选择保留的残余风险。
- 不依赖 Origin、Referer、代码混淆、环境变量名称或前端加密保护秘密。

## Failure Modes

- Access 未登录：前端提示登录，不重试 DeepSeek 请求。
- Access 会话过期：用户重新打开 `/auth-check` 登录。
- Origin 不匹配：Worker 返回 `403`。
- operation 非白名单：Worker 返回 `400`。
- 请求体过大：Worker 返回 `413`。
- DeepSeek Key 未配置：Worker 返回服务配置错误，不泄露变量名或值。
- DeepSeek 限流或额度不足：Worker返回标准化错误，前端显示业务阶段和状态。
- 模型返回非 JSON：Worker 返回上游格式错误，前端沿用阶段错误提示。
- Access 或第三方 Cookie 策略导致凭据未携带：通过目标浏览器实测；必要时将登录入口改为同顶级站点自定义域名，不能回退到前端 Key。

## Verification

### 静态泄密检查

1. 全仓搜索确认 Pages 代码中不存在：
   - `DEEPSEEK_API_KEY`
   - `api.deepseek.com`
   - DeepSeek Authorization 构造
   - DeepSeek Key localStorage 名称
2. 部署后直接访问 `app-config.js`，确认只有代理 URL，没有 DeepSeek Key。
3. 检查 GitHub Pages artifact，不包含新旧 DeepSeek Key。

### Worker 接口验证

1. 未登录访问 `/auth-check` 和 `/deepseek-json`，应由 Access 阻止。
2. 已登录且允许的用户访问 `/auth-check`，返回 `{ "ok": true }`。
3. 非允许 Origin 请求返回 `403`。
4. 非白名单 operation 返回 `400`。
5. 超限请求返回 `413`。
6. 合法 operation 能返回 `{ result }`，响应无缓存。
7. 检查 Worker 日志不出现 Key 和完整输入。

### 前端回归

1. 未登录点击“联网生成关键词”，显示登录提示且 Network 中没有 DeepSeek Key。
2. 完成 Access 登录后，现有关键词生成流程可完整执行。
3. 逐一覆盖 8 个 operation 对应的调用路径或构造测试请求。
4. DeepSeek 上游失败时，页面显示对应阶段错误。
5. 豆包搜索流程保持现状。
6. 在 DevTools Sources、Network、Application/Local Storage 中确认找不到 DeepSeek Key。

### 上线顺序

1. 撤销旧 DeepSeek Key。
2. 创建新 Key，并配置 GitHub Actions Secret/Cloudflare Worker Secret。
3. 部署 Worker 新路由。
4. 配置并验证 Cloudflare Access、自定义域名和 CORS。
5. 配置 Pages 的 `DEEPSEEK_PROXY_API_URL`。
6. 部署前端密钥清理与代理改造。
7. 完成端到端验证。
8. 删除旧 GitHub Variable `DEEPSEEK_API_KEY`，检查公开产物和缓存。
