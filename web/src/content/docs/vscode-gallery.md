# 让 VS Code 直接搜索内网插件源

> 目标：在不联网的终端上，打开 VS Code 扩展面板即可搜索、安装已缓存到本源的插件。
>
> 实现方式：本系统提供与 VS Code `extensionsGallery` 兼容的只读网关。通过修改 VS Code 安装目录中的 `product.json`，把插件商店指向本系统。

![插件离线安装流程](/docs/extension-install.svg)

## 1. 前置条件

- 管理端已缓存插件（上传 `.vsix` 或从市场缓存），并能在前台「离线插件」页面看到。
- 客户端能访问本系统地址，例如 `__BASE_URL__`。
- 只支持**已缓存**的插件与版本；未缓存的内容不会出现在搜索结果中。

## 2. 网关地址

| 配置项 | 值 |
| --- | --- |
| `serviceUrl` | `__BASE_URL__/api/gallery` |
| `itemUrl` | `__BASE_URL__/api/gallery/item` |
| `resourceUrlTemplate` | `__BASE_URL__/api/gallery/asset/{publisher}/{name}/{version}/{path}` |
| `controlUrl` | 空 |
| `nlsBaseUrl` | 空 |

> 若系统部署在反向代理之后，请在后台「系统设置 → 数据源 → VS Code 接入外部地址」填写对外地址。文档中的地址会自动使用该配置。

## 3. 修改 product.json

先关闭 VS Code，并备份原文件。

| 系统 | 文件路径 |
| --- | --- |
| Windows（用户安装） | `%LOCALAPPDATA%\Programs\Microsoft VS Code\resources\app\product.json` |
| Windows（系统安装） | `C:\Program Files\Microsoft VS Code\resources\app\product.json` |
| macOS | `/Applications/Visual Studio Code.app/Contents/Resources/app/product.json` |
| Linux（deb/rpm） | `/usr/share/code/resources/app/product.json` |
| Linux（tar.gz） | `<解压目录>/resources/app/product.json` |

在 `product.json` 顶层加入或替换 `extensionsGallery`：

```json
"extensionsGallery": {
  "serviceUrl": "__BASE_URL__/api/gallery",
  "itemUrl": "__BASE_URL__/api/gallery/item",
  "resourceUrlTemplate": "__BASE_URL__/api/gallery/asset/{publisher}/{name}/{version}/{path}",
  "controlUrl": "",
  "nlsBaseUrl": ""
}
```

注意 JSON 语法：如果文件里已有 `extensionsGallery`，替换其内容即可，不要在同一个对象中出现两个同名键。

## 4. 重启并验证

1. 重新启动 VS Code。
2. 打开扩展视图，搜索一个已缓存的插件（例如 `python` 或插件名）。
3. 应能看到插件与版本；点击「安装」会从本系统下载 `.vsix`。
4. 安装完成后，扩展面板显示已安装。

可用命令行快速检查网关：

```bash
curl -s -X POST "__BASE_URL__/api/gallery/extensionquery" \
  -H "Content-Type: application/json" \
  -d '{"filters":[{"criteria":[{"filterType":8,"value":"Microsoft.VisualStudio.Code"},{"filterType":10,"value":"python"}],"pageNumber":1,"pageSize":5,"sortBy":4,"sortOrder":0}],"assetTypes":[],"flags":914}'
```

返回 `results[0].extensions` 即正常。

## 5. 重要限制与风险

- **修改官方安装包可能破坏完整性校验**：Windows/macOS 对应用签名较敏感，修改 `product.json` 后可能提示安装损坏或无法自动更新。建议在 Linux tar.gz 便携版、内部定制版或测试机上先行验证，再由 IT 统一分发。
- 官方 VS Code 的自动更新可能覆盖 `product.json`，升级后需要重新修改。
- 本网关是只读适配层，不提供评分、评论、推荐、遥测等市场功能。
- 市场搜索只返回已缓存插件；版本更新需要管理员先缓存新版本。
- 平台专用插件会根据 `targetPlatform` 返回对应包；若目标平台未缓存，则不会出现在可选版本中。
- 网关接口不要求访问码（便于 VS Code 客户端调用），请通过内网 ACL、防火墙或反向代理限制来源。
- 这是兼容性集成，不同 VS Code 版本行为可能略有差异；若失败，优先使用「下载 vsix + 从 VSIX 安装」的稳定路径。

## 6. 常见问题

| 现象 | 排查 |
| --- | --- |
| 扩展面板一直转圈/搜索无结果 | 检查 `serviceUrl` 是否可访问；用上面的 curl 命令验证；确认插件已缓存 |
| 提示「无法连接到扩展市场」 | `product.json` JSON 语法错误，或地址缺少协议/端口 |
| 能看到插件但安装失败 | 检查 `VSIXPackage` 地址是否可下载；查看本系统任务/日志；核对文件是否被删除 |
| 安装后提示版本不兼容 | 插件引擎范围与当前 VS Code 不匹配，升级客户端或缓存旧版插件 |
| 升级 VS Code 后配置失效 | 更新覆盖了 `product.json`，重新写入并重启 |
| 仅部分插件出现 | 只有已缓存的插件会被返回；请在后台补齐缓存 |

## 7. 替代方案：命令行安装

如果修改 `product.json` 不可接受，仍可使用稳定方式：

```bash
# 从本系统下载 vsix 后
code --install-extension /path/to/extension.vsix
```

或在扩展面板点击 `···` → 「从 VSIX 安装…」。详见「离线安装插件」标签页。
