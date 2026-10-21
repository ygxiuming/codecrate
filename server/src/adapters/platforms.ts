export interface DownloadPlatform {
  id: string;
  label: string;
  os: 'win32' | 'darwin' | 'linux';
  arch: 'x64' | 'arm64' | 'armhf' | 'universal';
  format: 'exe' | 'zip' | 'tar.gz' | 'deb' | 'rpm';
  defaultSelected: boolean;
  note?: string;
}

/** 平台 ID 与官方 update.code.visualstudio.com 的路径段一一对应（已实测）。 */
export const VSCODE_PLATFORMS: DownloadPlatform[] = [
  { id: 'win32-x64-user', label: 'Windows x64 · 用户安装', os: 'win32', arch: 'x64', format: 'exe', defaultSelected: true },
  { id: 'win32-arm64-user', label: 'Windows ARM64 · 用户安装', os: 'win32', arch: 'arm64', format: 'exe', defaultSelected: true },
  { id: 'darwin', label: 'macOS Intel', os: 'darwin', arch: 'x64', format: 'zip', defaultSelected: true },
  { id: 'darwin-arm64', label: 'macOS Apple Silicon', os: 'darwin', arch: 'arm64', format: 'zip', defaultSelected: true },
  { id: 'linux-x64', label: 'Linux x64 · tar.gz', os: 'linux', arch: 'x64', format: 'tar.gz', defaultSelected: true },
  { id: 'linux-arm64', label: 'Linux ARM64 · tar.gz', os: 'linux', arch: 'arm64', format: 'tar.gz', defaultSelected: true },
  { id: 'linux-deb-x64', label: 'Linux x64 · .deb', os: 'linux', arch: 'x64', format: 'deb', defaultSelected: true },
  { id: 'linux-deb-arm64', label: 'Linux ARM64 · .deb', os: 'linux', arch: 'arm64', format: 'deb', defaultSelected: true },
  { id: 'linux-rpm-x64', label: 'Linux x64 · .rpm', os: 'linux', arch: 'x64', format: 'rpm', defaultSelected: true },
  { id: 'linux-rpm-arm64', label: 'Linux ARM64 · .rpm', os: 'linux', arch: 'arm64', format: 'rpm', defaultSelected: true },
  { id: 'win32-x64', label: 'Windows x64 · 系统安装', os: 'win32', arch: 'x64', format: 'exe', defaultSelected: false },
  { id: 'win32-arm64', label: 'Windows ARM64 · 系统安装', os: 'win32', arch: 'arm64', format: 'exe', defaultSelected: false },
  { id: 'win32-x64-archive', label: 'Windows x64 · 便携 zip', os: 'win32', arch: 'x64', format: 'zip', defaultSelected: false },
  { id: 'win32-arm64-archive', label: 'Windows ARM64 · 便携 zip', os: 'win32', arch: 'arm64', format: 'zip', defaultSelected: false },
  { id: 'darwin-universal', label: 'macOS · 通用包', os: 'darwin', arch: 'universal', format: 'zip', defaultSelected: false },
  { id: 'linux-armhf', label: 'Linux ARMHF · tar.gz', os: 'linux', arch: 'armhf', format: 'tar.gz', defaultSelected: false },
  { id: 'linux-deb-armhf', label: 'Linux ARMHF · .deb', os: 'linux', arch: 'armhf', format: 'deb', defaultSelected: false },
  { id: 'linux-rpm-armhf', label: 'Linux ARMHF · .rpm', os: 'linux', arch: 'armhf', format: 'rpm', defaultSelected: false },
];

export const DEFAULT_VSCODE_PLATFORMS = VSCODE_PLATFORMS.filter((item) => item.defaultSelected).map(
  (item) => item.id,
);

export function findVSCodePlatform(id: string): DownloadPlatform | undefined {
  return VSCODE_PLATFORMS.find((item) => item.id === id);
}

export interface ServerPlatform {
  id: string;
  label: string;
  format: 'tar.gz' | 'zip';
  defaultSelected: boolean;
}

/** Remote-SSH server 平台，路径段为 server-${id}（已实测）。 */
export const REMOTE_SERVER_PLATFORMS: ServerPlatform[] = [
  { id: 'linux-x64', label: 'Linux x64', format: 'tar.gz', defaultSelected: true },
  { id: 'linux-arm64', label: 'Linux ARM64', format: 'tar.gz', defaultSelected: true },
  { id: 'linux-armhf', label: 'Linux ARMHF', format: 'tar.gz', defaultSelected: true },
  { id: 'darwin-arm64', label: 'macOS Apple Silicon', format: 'zip', defaultSelected: false },
  { id: 'win32-x64', label: 'Windows x64', format: 'zip', defaultSelected: false },
];

export const DEFAULT_REMOTE_PLATFORMS = REMOTE_SERVER_PLATFORMS.filter(
  (item) => item.defaultSelected,
).map((item) => item.id);

export function findRemotePlatform(id: string): ServerPlatform | undefined {
  return REMOTE_SERVER_PLATFORMS.find((item) => item.id === id);
}

export const MARKETPLACE_CATEGORIES = [
  'Programming Languages',
  'Snippets',
  'Linters',
  'Themes',
  'Debuggers',
  'Formatters',
  'Keymaps',
  'SCM Providers',
  'Extension Packs',
  'Language Packs',
  'Data Science',
  'Machine Learning',
  'Visualization',
  'Testing',
  'Notebooks',
  'Education',
  'Tools',
  'Other',
];
