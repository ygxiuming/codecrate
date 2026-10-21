# 插件离线安装

> 适用对象：需要在内网安装 VS Code 插件的用户。文件格式为 `.vsix`。

![插件离线安装流程](/docs/extension-install.svg)

## 1. 下载 .vsix

打开「离线插件」页面，搜索插件名或 Publisher，点击卡片查看可用版本，选择与你的 VS Code 引擎范围匹配的版本下载。

- 页面会显示插件支持的 VS Code 版本范围，例如 `^1.95.0`。
- 依赖插件或插件包（Extension Pack）不会自动一起下载，请一并搜索并下载。
- 下载后建议核对 SHA256。

## 2. 安装方式

### 方式一：命令行（推荐，适合批量部署）

Windows 在 PowerShell 中执行，macOS/Linux 在终端执行：

```bash
code --install-extension /path/to/ms-python.python-2025.10.0.vsix
```

如果提示找不到 `code` 命令：

- Windows：重新运行安装程序，勾选「添加到 PATH」；或使用完整路径
  `%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd`。
- macOS：执行「Shell 命令：在 PATH 中安装 code 命令」。
- Linux：确认 `/usr/bin/code` 或 `/usr/local/bin/code` 存在。

批量安装目录下的所有 vsix：

```bash
for f in ./vsix/*.vsix; do code --install-extension "$f"; done
```

### 方式二：图形界面

1. 打开扩展视图（`Ctrl+Shift+X` / `Cmd+Shift+X`）。
2. 点击右上角 `···`。
3. 选择「从 VSIX 安装…」（Install from VSIX）。
4. 选择下载的 `.vsix` 文件，等待右下角提示安装成功。

### 方式三：Remote-SSH 远程窗口

使用 Remote-SSH 时，插件通常需要安装在**远端**而不是本地：

1. 先连接远端窗口。
2. 在远程窗口中打开扩展视图，选择「从 VSIX 安装…」，选择你拷贝到远端主机的 vsix。
3. 或者在远端主机上执行：

```bash
~/.vscode-server/bin/<commit>/bin/code-server --install-extension /path/to/xxx.vsix
```

部分插件同时需要本地与远端组件（例如语言服务），请分别在两侧安装。

## 3. 验证安装

```bash
code --list-extensions --show-versions
```

输出中应出现类似：

```text
ms-python.python@2025.10.0
```

也可以在扩展面板中搜索插件，查看「已安装」状态与版本号。

## 4. 常见安装失败

| 提示 | 原因 | 处理 |
| --- | --- | --- |
| `Cannot install extension because it is not compatible with VS Code` | 插件引擎范围与当前 VS Code 不匹配 | 升级 VS Code 到缓存中的新版本，或下载旧版插件 |
| `Unable to install extension ... because it depends on ...` | 缺少依赖插件 | 在插件页搜索并下载依赖，先安装依赖 |
| `End of central directory record signature not found` | vsix 下载不完整或被修改 | 重新下载并核对 SHA256 |
| 安装成功但功能不生效 | 插件需要远端组件或重载窗口 | 重新加载窗口；Remote-SSH 场景在远端安装 |
| `EACCES` / 权限错误 | 安装目录不可写 | 使用用户安装版，或修正 `~/.vscode/extensions` 权限 |

## 5. 插件包（Extension Pack）说明

插件包本身只是一个依赖集合。离线环境需要：

1. 安装插件包对应的 `.vsix`；
2. 再逐个安装其中列出的插件（页面详情会显示依赖列表）。

否则 VS Code 会提示「扩展包中的某些扩展未安装」。

## 6. 关闭插件自动更新

在用户设置中加入：

```json
{
  "extensions.autoUpdate": false,
  "extensions.autoCheckUpdates": false
}
```

需要升级时，重新下载新版本 vsix 覆盖安装即可。
