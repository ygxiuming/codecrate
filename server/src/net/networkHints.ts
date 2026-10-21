const PROXY_ALLOWLIST =
  'update.code.visualstudio.com,*.microsoft.com,*.visualstudio.com,*.vsassets.io,*.open-vsx.org,*.eclipsecontent.org';

/**
 * 将 SSRF 拦截错误转成可执行的运维提示。
 * 常见于 Clash/Surge 等代理的 fake-IP 模式：公网域名被解析到 198.18.0.0/15。
 */
export function networkErrorHint(message: string): string | undefined {
  if (!/198\.18\.|100\.64\.|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\./i.test(message)) {
    return undefined;
  }
  if (!/保留|私有|环回|SSRF|内网/i.test(message)) return undefined;
  return [
    '检测到目标被解析到私网/保留地址。若使用 Clash/Surge 等代理的 fake-IP 模式（198.18.0.0/15），',
    '且确认需要经代理访问官方源，请在部署环境设置：',
    `NETWORK_ALLOWED_PRIVATE_HOSTS=${PROXY_ALLOWLIST}`,
    '然后重启服务。若使用内网镜像，请把镜像主机一并加入（支持 *.example.com）。',
    '默认放行列表为空，未显式配置前系统会继续拒绝私网/保留地址。',
  ].join('\n');
}
