# VS Code 安装与内网更新指南

> 适用对象：内网普通用户。所有文件均来自内网离线源，安装过程不需要访问外网。

![离线部署流程](/docs/offline-flow.svg)

## 1. 选择正确的安装包

打开「VS Code 安装包」页面，按你的操作系统和架构选择对应文件。平台较多时可按平台筛选。

| 操作系统 | 推荐文件 | 说明 |
| --- | --- | --- |
| Windows x64 | `VSCodeUserSetup-x64-<版本>.exe` | 用户安装，无需管理员权限 |
| Windows ARM64 | `VSCodeUserSetup-arm64-<版本>.exe` | 适用于骁龙等 ARM 设备 |
| Windows（系统级） | `VSCodeSetup-x64-<版本>.exe` | 安装到 Program Files，需要管理员权限 |
| macOS Intel | `VSCode-darwin.zip` | 解压后把应用拖入「应用程序」 |
| macOS Apple Silicon | `VSCode-darwin-arm64.zip` | M1/M2/M3/M4 芯片 |
| Linux x64（通用） | `code-stable-x64-<时间戳>.tar.gz` | 免安装，解压即用 |
| Debian / Ubuntu | `code_<版本>_amd64.deb` | x64；ARM64 选 `arm64.deb` |
| RHEL / CentOS / Fedora | `code-<版本>.el8.x86_64.rpm` | ARM64 选 `aarch64.rpm` |

> 页面上的「构建时间」来自官方产物时间戳，可作为判断版本新旧的参考。

## 2. 校验文件完整性（推荐）

每个平台行都显示了 SHA256。也可以点击「SHA256 校验文件」下载完整的校验清单。

**Windows（PowerShell / CMD）**

```powershell
certutil -hashfile "VSCodeUserSetup-x64-1.95.0.exe" SHA256
```

**macOS / Linux**

```bash
shasum -a 256 VSCode-darwin-arm64.zip
sha256sum code-stable-x64-1730152418.tar.gz
```

将输出与页面显示的 64 位十六进制值逐位比对。不一致说明文件损坏或被篡改，请重新下载。

## 3. 安装

### Windows

双击 `.exe`，按向导完成安装。用户安装版默认位于 `%LOCALAPPDATA%\Programs\Microsoft VS Code`。

如果需要在命令行使用 `code` 命令，请在安装向导中勾选「添加到 PATH」，或在 VS Code 中执行「Shell 命令：在 PATH 中安装 code 命令」。

### macOS

```bash
unzip VSCode-darwin-arm64.zip
mv "Visual Studio Code.app" /Applications/
```

离线拷贝的应用可能带有隔离属性，首次打开若提示「无法验证开发者」，可执行：

```bash
xattr -dr com.apple.quarantine "/Applications/Visual Studio Code.app"
```

### Linux（.deb）

```bash
sudo dpkg -i code_1.95.0-1730153583_amd64.deb
sudo apt-get -f install   # 如提示缺少依赖
```

### Linux（.rpm）

```bash
sudo rpm -Uvh code-1.95.0-1730153639.el8.x86_64.rpm
```

### Linux（tar.gz，免安装）

```bash
tar -xzf code-stable-x64-1730152418.tar.gz
./VSCode-linux-x64/bin/code --version
```

可将解压目录移动到 `/opt/vscode`，并创建软链接：

```bash
sudo ln -s /opt/vscode/bin/code /usr/local/bin/code
```

## 4. 关闭自动更新（离线环境必做）

离线环境无法访问更新服务器，建议关闭自动更新，避免反复失败提示与版本漂移。

打开命令面板（`Ctrl+Shift+P` / `Cmd+Shift+P`），执行「Preferences: Open User Settings (JSON)」，加入：

```json
{
  "update.mode": "none",
  "extensions.autoUpdate": false,
  "extensions.autoCheckUpdates": false
}
```

- `update.mode: none`：不检查 VS Code 更新。
- `extensions.autoUpdate: false`：不自动更新插件。
- 需要升级时，回到本页下载新版本安装包，覆盖安装即可；插件与配置会保留。

## 5. 版本升级建议

1. 先确认内网已缓存目标版本（页面可见）。
2. 记录当前版本（帮助 → 关于），升级后如需回退可重新安装旧版。
3. 使用 Remote-SSH 的用户，升级客户端后必须同步更新远端的 server（见「Remote-SSH」标签页），否则会一直卡在下载 server。

## 6. 接下来

- 安装离线插件：[插件离线安装](/docs?tab=extension-install)
- 配置远程开发：[Remote-SSH 离线配置](/docs?tab=remote-ssh)
- 遇到问题：[常见问题](/docs?tab=faq)
