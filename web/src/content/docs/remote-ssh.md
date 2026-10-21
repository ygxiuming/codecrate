# Remote-SSH 离线配置

> 适用对象：需要在隔离内网使用 VS Code Remote-SSH 的开发与运维人员。

![Remote-SSH 离线工作方式](/docs/remote-ssh.svg)

## 1. 原理：commit 必须一致

Remote-SSH 连接远端时，会在远端安装一个与**客户端 VS Code commit** 完全一致的 `vscode-server`。离线环境无法下载，因此需要提前把 server 包放到远端正确位置。

- 客户端版本与 commit：VS Code「帮助 → 关于」中查看，本系统的 Remote-SSH 页面也会显示每个版本的 commit。
- server 包平台：由**远端主机**决定（通常是 Linux x64/ARM64），不是客户端系统。
- 客户端升级后 commit 变化，必须重新预置对应版本的 server。

## 2. 准备文件

在本系统「Remote-SSH」页面：

1. 找到与客户端完全一致的 VS Code 版本（页面会显示该版本的 commit）；
2. 按远端主机架构下载 server 包（Linux 为 `.tar.gz`，Windows/macOS 为 `.zip`）；
3. 核对页面显示的 commit 与 SHA256。

如果页面还没有你的版本，请联系管理员在后台「Remote-SSH 缓存」中：

- **自动缓存**：配置镜像源后按版本自动下载；
- **手动上传**：在可联网机器下载标准 server 包后，通过「手动上传 server 包」导入。

server 包内的 `product.json` 包含版本与 commit，导入时系统会自动识别并校验。

如果希望连接时由 VS Code 自动下载 server，而不是手动预置，请直接看第 8 节「让 VS Code 自动从本源下载 server」。

## 3. 在远端预置 server（推荐方案）

以下以 Linux x64 为例。假设 commit 为 `912bb683695358a54ae0c670461738984cbb5b95`。

```bash
# 1. 在远端创建 commit 目录
mkdir -p ~/.vscode-server/bin/912bb683695358a54ae0c670461738984cbb5b95

# 2. 解压 server 包（压缩包内顶层目录会被剥离）
tar -xzf vscode-server-linux-x64.tar.gz \
  -C ~/.vscode-server/bin/912bb683695358a54ae0c670461738984cbb5b95 \
  --strip-components=1

# 3. 确认关键文件存在且可执行
ls -l ~/.vscode-server/bin/912bb683695358a54ae0c670461738984cbb5b95/bin/code-server
~/.vscode-server/bin/912bb683695358a54ae0c670461738984cbb5b95/bin/code-server --version
```

如果使用共享目录（例如 `/opt/vscode-server`），结构必须是：

```text
/opt/vscode-server/
└── bin/
    └── <commit>/
        ├── bin/code-server
        ├── node
        └── ...
```

Windows 远端：把 zip 解压到 `%USERPROFILE%\.vscode-server\bin\<commit>`。
macOS 远端（Apple Silicon）：解压到 `~/.vscode-server/bin/<commit>`。

> 目录权限归属必须是实际登录用户。用 root 预置后被普通用户连接，常导致「Server install path is not writable」。

## 4. 客户端设置

打开用户设置 JSON（`Ctrl+Shift+P` → Preferences: Open User Settings (JSON)），加入：

```json
{
  "remote.SSH.localServerDownload": "off",
  "remote.SSH.serverInstallPath": {
    "10.0.0.12": "/opt/vscode-server"
  },
  "remote.SSH.remotePlatform": {
    "10.0.0.12": "linux"
  },
  "remote.SSH.useLocalServer": true
}
```

说明：

| 设置 | 作用 |
| --- | --- |
| `remote.SSH.localServerDownload: "off"` | 禁止客户端尝试本地下载 server，避免离线环境卡在下载阶段 |
| `remote.SSH.serverInstallPath` | 按主机指定 server 安装根目录；最终路径为 `<根目录>/bin/<commit>` |
| `remote.SSH.remotePlatform` | 明确远端系统类型，避免自动探测失败（linux / windows / darwin） |
| `remote.SSH.useLocalServer` | 使用本地 SSH 客户端建立连接，通常保持默认开启 |

如果你把 server 放在默认位置 `~/.vscode-server`，可以省略 `serverInstallPath`。

## 5. 安装 Remote-SSH 扩展

Remote-SSH 扩展本身也要离线安装：

1. 在「离线插件」页面搜索 `remote-ssh`，下载 `.vsix`；
2. 在本地 VS Code 用「从 VSIX 安装」；
3. 重新加载窗口。

如果扩展包还依赖 `remote-explorer` 等插件，请一并下载安装。

## 6. 连接与验证

1. 配置 `~/.ssh/config`，确保可以 `ssh user@host` 登录。
2. 命令面板执行「Remote-SSH: Connect to Host…」。
3. 首次连接时观察输出面板「Remote-SSH」日志。
4. 连接成功后，远端应出现 `~/.vscode-server/data/logs/`。

调试命令：

```bash
ssh user@host
~/.vscode-server/bin/<commit>/bin/code-server --version
tail -n 100 ~/.vscode-server/data/logs/*/remoteagent.log
```

## 7. 常见错误与处理

| 错误 | 原因 | 处理 |
| --- | --- | --- |
| `Downloading VS Code Server ...` 长时间卡住 | 未预置 server，客户端或远端在尝试官方下载 | 按本文预置；或使用第 8 节的 `ossDownloadUrl` / `manual-bootstrap`；也可设置 `localServerDownload: "off"` |
| `Server install path is not writable` | 目录权限不对 | `chown -R user:user ~/.vscode-server` 或改用共享目录并授权 |
| `bash: .../bin/code-server: No such file or directory` | commit 不匹配或解压层级错误 | 检查 `<commit>` 目录与 `bin/code-server` 是否存在 |
| `Remote host does not meet prerequisites` | 远端 glibc 版本过低 | 升级到 glibc ≥ 2.28，或更换受支持的发行版 |
| `The remote platform ... could not be detected` | 自动探测失败 | 设置 `remote.SSH.remotePlatform` |
| `Bad owner or permissions on ~/.ssh/config` | 权限过宽 | `chmod 600 ~/.ssh/config` |
| `vscode-server quit unexpectedly` | server 崩溃/架构不匹配 | 查看远端日志；确认下载的是远端架构的包 |
| 连接成功后扩展缺失 | 插件装在本地而非远端 | 在远程窗口重新安装 .vsix |
| 升级 VS Code 后无法连接 | 客户端 commit 已变化 | 下载新版本 server，放入新的 `<commit>` 目录 |

## 8. 让 VS Code 自动从本源下载 server（可选）

前面的章节是「手动预置」的稳定方案。如果希望连接时自动获取 server，本源提供了与官方 update 服务兼容的下载路径：

```text
__BASE_URL__/api/vscode-update/commit:<commit>/server-<platform>/stable
```

该路径**不要求访问码**，按完整 40 位 commit 与平台精确匹配已缓存的 server 包；未缓存的 commit 会返回 404。管理员需要先在「Remote-SSH 缓存」中缓存对应版本，或手动上传 server 包。

### 8.1 方式 A：远端主机直接下载（推荐）

适用于远端主机能访问本源。Remote-SSH 支持两个隐藏设置 `remote.SSH.useOSS` 与 `remote.SSH.ossDownloadUrl`：

```json
{
  "remote.SSH.useOSS": true,
  "remote.SSH.ossDownloadUrl": "__BASE_URL__/api/vscode-update",
  "remote.SSH.localServerDownload": "off",
  "remote.SSH.useExecServer": false
}
```

连接时，远端主机会执行 wget/curl，从本源下载 `commit:<commit>/server-<platform>/stable`，并安装到 `~/.vscode-server/bin/<commit>/`。这条路径不需要客户端下载，也不需要手动 SCP。

注意：

- `useOSS` / `ossDownloadUrl` 是 Remote-SSH 的隐藏设置，不同版本行为可能变化；设置后如果 VS Code 提示未知配置项，可以忽略，或升级 Remote-SSH 后再试。
- 远端主机必须能访问 `__BASE_URL__`；使用内网域名时请确认远端 DNS 可解析。
- 建议同时设置 `remote.SSH.useExecServer: false`，避免扩展尝试下载额外的 CLI 组件。
- 客户端与服务端 commit 必须一致；本源上没有对应 commit 时会返回 404。

### 8.2 方式 B：客户端下载后由扩展 SCP 推送

如果远端主机不能访问本源，但客户端可以，使用 Remote-SSH 的高级值 `manual-bootstrap`：

1. 在客户端下载匹配的 server 包到 bootstrap 目录：

```bash
mkdir -p ~/vscode-remote-ssh-bootstrap
curl -fL "__BASE_URL__/api/vscode-update/commit:<commit>/server-<platform>/stable" \
  -o ~/vscode-remote-ssh-bootstrap/vscode-server.tar.gz
```

Windows 客户端的路径是 `%USERPROFILE%\vscode-remote-ssh-bootstrap\vscode-server.tar.gz`；`manual-bootstrap` 不支持 Windows 远端主机。

2. 客户端设置：

```json
{
  "remote.SSH.localServerDownload": "manual-bootstrap",
  "remote.SSH.useExecServer": false,
  "remote.SSH.remotePlatform": {
    "10.0.0.12": "linux"
  }
}
```

3. 正常连接主机。扩展会自动把 tarball SCP 到远端并解压安装，不需要登录远端手动操作。

说明：`remote.SSH.localServerDownload: "always"` 的客户端下载地址在当前 Remote-SSH 版本中硬编码为 `https://update.code.visualstudio.com`，不会读取 `ossDownloadUrl`；离线环境请使用 `manual-bootstrap`。

### 8.3 commit 与平台对照

- commit：客户端「帮助 → 关于」中的 commit，必须与本源缓存的 server 一致。
- 平台：由**远端主机**决定，例如 `linux-x64`、`linux-arm64`、`linux-armhf`、`darwin-arm64`、`win32-x64`。
- 可在本源「Remote-SSH」页面找到对应版本并复制 commit。若版本尚未缓存，请管理员先缓存或手动上传 server 包。
- 可用命令行验证下载路径：

```bash
curl -I "__BASE_URL__/api/vscode-update/commit:<commit>/server-linux-x64/stable"
```

返回 `200` 表示可直接被 Remote-SSH 使用。

## 9. 安全与运维建议

- 只开放必要的 SSH 端口，使用密钥登录，禁用密码登录。
- server 包同样建议做 SHA256 校验后再分发。
- 多台远端主机可共享只读的 `/opt/vscode-server/bin/<commit>`，但需保证运行用户可读可执行。
- 定期清理不再使用的 commit 目录，避免磁盘膨胀。
- `/api/vscode-update` 为兼容 VS Code 而豁免访问码，且只按 commit + 平台返回已缓存文件；请通过内网 ACL、防火墙或反向代理限制来源。
