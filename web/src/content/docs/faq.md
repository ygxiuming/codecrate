# 常见问题

## 部署与启动

### `docker compose up` 后容器不断重启？

先看日志：

```bash
docker compose logs -f registry
```

常见原因：

- `data/` 目录没有写权限。容器以 UID 1000 运行，可执行
  `sudo chown -R 1000:1000 ./data`。
- 端口 3000 被占用，修改 `APP_PORT` 或 compose 中的端口映射。
- 数据库文件损坏或由旧版本创建，查看迁移日志并恢复备份。

### 健康检查失败？

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

返回 `status: "ok"` 即正常；同时检查 `checks.db`、`checks.storage`。若存储检查失败，确认挂载卷可写。

### 如何在没有外网的机器上部署？

在联网机器上构建并导出镜像：

```bash
docker compose build
docker save codecrate:latest | gzip > registry-image.tar.gz
```

拷贝镜像与 `docker-compose.yml`、`.env` 到内网，执行：

```bash
gunzip -c registry-image.tar.gz | docker load
docker compose up -d
```

### 修改了端口/环境变量不生效？

`.env` 仅在 `docker compose up` 时读取。修改后执行 `docker compose up -d` 重建容器。不要直接编辑运行中容器的配置。

## 管理员账号

### 初始密码在哪里？

- 首次启动日志；
- 或 `data/initial-admin-password`（权限 600）。

### 忘记管理员密码怎么办？

在项目目录执行：

```bash
ADMIN_USERNAME=admin ADMIN_PASSWORD='新的强密码至少10位' npm run reset-admin
```

Docker 部署：

```bash
docker compose exec -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD='新的强密码至少10位' registry node dist/cli/reset-admin.js
```

该命令会直接更新数据库中的密码哈希；所有旧会话仍需在后台「退出登录」或修改密码后失效。

### 登录提示「用户名或密码不正确」

- 用户名不区分大小写，但只允许小写字母、数字、点、下划线、短横线；
- 连续失败 5 次会触发 15 分钟限流，查看容器日志中的 `auth.login_failed` 审计记录；
- 确认没有启用访问码（访问码只影响前台）。

## 前台访问

### 页面提示「需要访问码」

管理员在「系统设置 → 访问控制」开启了下载校验，请向管理员索取共用访问码。访问码验证成功后有效 12 小时。

### 接口返回 401 / 403

- `401 ACCESS_REQUIRED`：需要访问码。
- `401 UNAUTHORIZED`：管理会话过期，请重新登录。
- `403` 且提示跨站请求：使用 `curl` 等工具调用写接口时，需要带 `X-Requested-With: XMLHttpRequest` 头。

### 下载中断后能续传吗？

可以。下载接口支持 `Range`，浏览器或下载工具会自动续传。若使用 `curl`：

```bash
curl -C - -O http://registry.local/api/download/vscode/1
```

同一 IP 的并发下载数默认限制为 4，超限返回 `429` 与 `Retry-After`。

### 下载的文件名和页面显示不一致？

系统使用 RFC 5987 的 `Content-Disposition` 返回原始文件名；个别旧浏览器会使用 ASCII 回退名或 URL 末段。文件内容不受影响，可用 SHA256 核对。

### 页面看不到新缓存的资源？

缓存是异步任务：

1. 到「任务中心」确认状态为「成功」；
2. 前台刷新页面；
3. 若任务失败，查看失败原因并重试。

## VS Code 与插件

### 安装插件提示引擎不兼容

页面上的「VS Code ^1.95.0」表示插件要求 VS Code ≥ 1.95.0。请升级客户端到已缓存的新版本，或在插件详情中选择更旧的版本。

### 插件安装成功但没有生效

- 重新加载窗口（`Developer: Reload Window`）；
- Remote-SSH 场景插件必须安装在远端；
- 检查插件是否依赖其他插件或需要特定设置。

### 如何完全禁用更新检查？

```json
{
  "update.mode": "none",
  "extensions.autoUpdate": false,
  "extensions.autoCheckUpdates": false
}
```

## Remote-SSH

### 一直卡在 `Downloading VS Code Server`

离线环境无法下载 server。请：

1. 确认下载的 server 版本与客户端 commit 完全一致；
2. 按「Remote-SSH」文档预置到远端 `<installPath>/bin/<commit>`；
3. 设置 `remote.SSH.localServerDownload: "off"`；
4. 检查远端目录权限与 glibc 版本。

### `Server install path is not writable`

```bash
sudo chown -R "$USER":"$USER" ~/.vscode-server
```

如果使用共享目录，确保运行用户对 `bin/<commit>` 有读与执行权限。

### `vscode-server` 启动即退出

查看日志：

```bash
ls ~/.vscode-server/data/logs/
tail -n 200 ~/.vscode-server/data/logs/*/remoteagent.log
```

常见原因：架构不匹配（x64 机器装了 arm64 包）、glibc 过旧、磁盘满、端口限制。

### 升级 VS Code 后连不上了

客户端 commit 已变化。下载新版本的 server 包，放到新的 `<commit>` 目录，再重连。

## 数据与运维

### 数据库和文件如何备份？

停机后复制整个 `data/` 目录即可，包含 SQLite（WAL 模式）与所有缓存文件。

```bash
docker compose stop && tar -czf backup.tar.gz data/ && docker compose start
```

### 存储占用越来越大怎么办？

- 「存储管理」按类型查看占用；
- 删除不再需要的旧版本；
- 清理临时文件（上传残留与超期 `.part`）；
- 在设置中调整访问日志保留期（默认 90 天）。

### 访问分析里的时间是 UTC 还是本地时间？

数据库以 UTC ISO 时间存储，前台展示按浏览器本地时区格式化。趋势图按 UTC 日期聚合。

### 修改数据源后无法下载

- 用「系统设置 → 测试」检查连通性；
- 内网镜像地址默认被 SSRF 防护拒绝，需要在部署时设置
  `NETWORK_ALLOWED_PRIVATE_HOSTS=mirror.corp.local`；
- 公网数据源仅允许 80/443 端口。

### 可否只允许特定用户下载？

当前版本提供「共用访问码」模式（匿名 + 访问码），不提供多用户账号体系。如需按人审计，可在反向代理层接入 SSO，并保留本系统的访问日志。

## 安全

### 管理后台可以直接暴露公网吗？

不建议。请放在 VPN/内网，并通过反向代理启用 HTTPS：

- 设置 `TRUST_PROXY=1`（仅信任一层代理）；
- 设置 `COOKIE_SECURE=auto` 或 `always`；
- 限制 `/admin` 来源 IP。

### 系统会把我的数据上传到哪里？

不会。系统没有遥测，所有数据保存在本地卷。仅管理员触发的采集任务会访问配置的数据源。

### 官方 Marketplace 的合规风险？

官方 gallery 接口主要服务于 VS Code 客户端，第三方使用可能存在服务条款限制。对合规敏感的环境请切换 Open VSX，或仅使用手工上传的 vsix。项目与 Microsoft 无关联。

## 新增功能相关

### 前台找不到管理入口？

前台右上角有「管理登录」按钮，也可以直接访问 `/admin` 或 `/admin/login`。未登录时会跳转到登录页。

### 按 commit 查找版本很慢或找不到？

- commit 必须来自 VS Code「帮助 → 关于」，长度为 7–40 位十六进制；
- 系统先查已缓存索引，再在最近 150 个官方稳定版中探测，因此需要访问官方源并等待数秒；
- 更早的版本请直接按版本号搜索；也可以先缓存该版本，之后按 commit 查询会立即命中本地索引。

### 修改 product.json 后 VS Code 提示损坏 / 扩展市场不可用？

- 确认 JSON 语法正确，`extensionsGallery` 只出现一次；
- 确认客户端能访问「VS Code 接入外部地址」；
- Windows/macOS 的官方安装包对签名较敏感，建议在便携版或内部定制版测试；
- VS Code 升级可能覆盖 `product.json`，需要重新写入；
- 失败时回退到「下载 vsix → 从 VSIX 安装」的稳定方式。

### 为什么 VS Code 里搜不到某个插件？

本网关只返回已缓存到内网的插件与版本。请管理员先在「市场浏览」或「插件管理」中缓存。

### 公告不显示？

- 检查公告是否为「已发布」；
- 检查生效时间是否已开始、是否已过期；
- 前台最多展示 3 条，用户关闭后会记住关闭状态（清除浏览器本地存储可恢复）；
- 公告被置顶时会优先展示。

### 官方版本源不可达，提示 `198.18.x.x 属于环回/私有/保留地址`？

这通常不是官方源故障，而是本机使用了 Clash/Surge 等代理的 **fake-IP 模式**：公网域名被解析到 `198.18.0.0/15` 保留网段，触发了 SSRF 防护。

默认策略不会放行任何私网/保留地址。若确认需要经代理访问官方源，请在启动环境（或 `.env`）中显式放行相关主机后重启：

```bash
NETWORK_ALLOWED_PRIVATE_HOSTS=update.code.visualstudio.com,*.microsoft.com,*.visualstudio.com,*.vsassets.io,*.open-vsx.org,*.eclipsecontent.org
```

- 这些主机覆盖版本源、安装包 CDN、官方 Marketplase 与 Open VSX。
- 使用内网镜像时，把镜像主机也加入（支持 `*.example.com`）。
- 放行列表为空时，系统继续拒绝私网/保留地址；这是预期的安全默认值。
- 修改后可在后台「系统设置 → 数据源」点击「测试版本源」验证。

若不想调整放行列表，可将系统部署在可正常解析公网地址的管理网段，或由管理员在联网机器采集后导入。


### 登录时提示「跨站请求被拒绝」？

这是写操作的 CSRF 同源校验未通过，常见于反向代理改写了 Host，或端口/域名与浏览器地址不一致。

- 现代浏览器同源请求会带 `Sec-Fetch-Site: same-origin`，系统会直接放行；
- 若仍失败，设置对外地址：
  ```bash
  PUBLIC_ORIGIN=https://registry.corp.local
  # 或追加允许来源
  ALLOWED_ORIGINS=https://registry.corp.local,http://localhost:5173
  ```
- 反向代理场景同时设置 `TRUST_PROXY=1`，并确保代理传递 `Host` 或 `X-Forwarded-Host`；
- 修改后重启服务，再尝试登录。
