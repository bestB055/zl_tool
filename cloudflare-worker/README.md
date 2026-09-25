# Cloudflare Worker 安全部署

该 Worker 同时提供：

- `POST /doubao-search`
- `POST /deepseek-json`
- `GET /auth-check`

## 1. 轮换 DeepSeek Key

已经进入 GitHub Pages 构建产物的 DeepSeek Key 必须视为泄露：

1. 在 DeepSeek 控制台撤销旧 Key。
2. 创建仅供 Worker 使用的新 Key。
3. 在 GitHub 仓库 `Settings > Secrets and variables > Actions > Secrets` 中添加：

```text
DEEPSEEK_API_KEY
```

不要把新 Key 放入 GitHub Variables、`app-config.js` 或 `wrangler.toml`。

## 2. 配置非敏感变量

在 GitHub Actions Variables 中设置：

```text
ALLOWED_ORIGIN=https://<你的 GitHub Pages 域名>
```

必须填写精确 Origin，不包含路径和末尾 `/`。

## 3. 配置 Worker 自定义域名

为 Worker 配置自定义域名，例如：

```text
https://api.example.com
```

GitHub Pages 的 `DEEPSEEK_PROXY_API_URL` 应设置为：

```text
https://api.example.com/deepseek-json
```

禁用默认 `*.workers.dev` 地址，或者将其纳入同一 Access 保护范围，避免绕过 Access。

## 4. 配置 Cloudflare Access

在 Cloudflare Zero Trust 中：

1. 新建 Self-hosted Application，覆盖 Worker 自定义域名的全部路径。
2. 建立 Allow Policy，仅允许指定邮箱、邮箱域或企业 SSO 用户。
3. 建议会话有效期设置为 8 小时。
4. 配置 CORS/预检，允许 GitHub Pages Origin 发起 `OPTIONS`。
5. 确保浏览器请求可以携带 Access 会话 Cookie。

前端登录入口会打开：

```text
https://api.example.com/auth-check
```

登录成功应返回：

```json
{"ok":true}
```

## 5. 配置限流

在 Cloudflare Dashboard 为 `/deepseek-json` 配置速率限制和额度告警。建议：

- 按 Access 用户或客户端 IP 限制每分钟请求数。
- 设置每日请求量或费用告警。
- 对短时间大量 4xx、429、5xx 请求告警。

Worker 已限制：

- 只允许固定 operation。
- 请求体最大 128 KB。
- operation 级输入上限。
- DeepSeek 请求 60 秒超时。
- 固定模型、温度、JSON 输出和最大输出 token。

## 6. 验证

部署后检查：

1. 未登录访问 `/auth-check` 时由 Access 拦截。
2. 已授权用户访问 `/auth-check` 返回 `{"ok":true}`。
3. 非 GitHub Pages Origin 调用业务接口返回 `403`。
4. 非白名单 operation 返回 `400`。
5. 超大请求返回 `413`。
6. Worker 日志中不存在 DeepSeek Key、Authorization 或完整业务输入。

CORS 不是身份认证。只有 Access、自定义域名保护和禁用公开旁路共同生效时，代理接口才不会成为公开的 DeepSeek 转发器。
