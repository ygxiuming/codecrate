export interface PublicConfig {
  siteName: string;
  siteDescription: string;
  requireLogin: boolean;
  marketplaceProvider: string;
  accessLogEnabled: boolean;
  galleryBaseUrl: string;
  version: string;
}

export interface PlatformInfo {
  id: string;
  label: string;
  os: string;
  arch: string;
  format: string;
  defaultSelected: boolean;
  note?: string;
}

export interface VscodeArtifact {
  id: string;
  label: string;
  artifactId: number;
  filename: string;
  sizeBytes: number;
  sha256: string;
  downloadCount: number;
}

export interface VscodeVersion {
  version: string;
  channel: string;
  buildTime: string | null;
  commitHash: string | null;
  totalSize: number;
  downloadCount: number;
  platforms: VscodeArtifact[];
}

export interface ExtensionItem {
  id: string;
  publisher: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  engineRange?: string | null;
  categories: string[];
  dependencies: string[];
  extensionPack: string[];
  downloadCount: number;
  updatedAt?: string;
  versionsCount: number;
  platforms: string[];
  artifactId: number;
  sizeBytes: number;
  iconUrl: string | null;
  targetPlatform: string;
}

export interface ExtensionVersion {
  artifactId: number;
  version: string;
  targetPlatform: string;
  engineRange: string | null;
  sizeBytes: number;
  sha256: string;
  filename: string;
  downloadCount: number;
  publishedAt: string;
}

export interface RemotePlatformArtifact {
  id: string;
  label: string;
  artifactId: number;
  filename: string;
  sizeBytes: number;
  sha256: string;
  downloadCount: number;
  commitHash: string;
}

export interface RemoteVersion {
  version: string;
  commitHash: string;
  totalSize: number;
  downloadCount: number;
  platforms: RemotePlatformArtifact[];
}

export interface Stats {
  vscodeVersions: number;
  vscodePackages: number;
  extensionCount: number;
  extensionVersions: number;
  remoteVersions: number;
  remotePackages: number;
  totalBytes: number;
  downloads: number;
  disk: { totalBytes: number; freeBytes: number; usedBytes: number };
  latestExtensions: Array<{ id: string; name: string | null; version: string; created_at: string }>;
  generatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface VscodeListResponse extends Paginated<VscodeVersion> {
  channel: string;
}

export interface ExtensionListResponse extends Paginated<ExtensionItem> {
  categories: string[];
}

export interface AdminVersionItem {
  version: string;
  cachedPlatforms: string[];
  cachedCount: number;
  remotePlatforms?: string[];
  remoteCount?: number;
  commitHash?: string | null;
}

export interface AdminVersionsResponse extends Paginated<AdminVersionItem> {
  sourceAvailable: boolean;
  warning?: string;
  platforms: PlatformInfo[];
  defaultPlatforms: string[];
  remotePlatforms?: Array<{ id: string; label: string; format: string; defaultSelected: boolean }>;
  defaultRemotePlatforms?: string[];
  remoteDownloadBase?: string;
  remoteUploadMaxBytes?: number;
  vscodeUpdateBase?: string;
}

export interface RemoteUploadResult {
  artifactId: number;
  version: string;
  platform: string;
  commitHash: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  buildTime: string | null;
}

export type TaskStatus = 'queued' | 'running' | 'success' | 'failed' | 'canceled';
export type TaskKind = 'vscode_package' | 'remote_server' | 'extension';

export interface TaskRow {
  id: number;
  kind: TaskKind;
  target_key: string;
  payload: Record<string, unknown> | null;
  status: TaskStatus;
  attempts: number;
  max_attempts: number;
  progress_bytes: number;
  total_bytes: number;
  error_code: string | null;
  error_message: string | null;
  artifact_id: number | null;
  created_by: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

export interface TaskEvent {
  id: number;
  level: string;
  message: string;
  created_at: string;
}

export interface Overview {
  vscodeVersions: number;
  vscodePackages: number;
  extensionCount: number;
  extensionVersions: number;
  remoteVersions: number;
  remotePackages: number;
  tasks: Record<TaskStatus, number>;
  storage: {
    artifacts: {
      vscode: { count: number; bytes: number };
      extensions: { count: number; bytes: number };
      remoteServers: { count: number; bytes: number };
      total: { count: number; bytes: number };
    };
    disk: { totalBytes: number; freeBytes: number; usedBytes: number };
    temp: { count: number; bytes: number };
  };
  today: { pv: number; uv: number; downloads: number };
  recentTasks: TaskRow[];
  recentAudit: Array<{
    id: number;
    actor: string;
    action: string;
    target_type: string | null;
    target_id: string | null;
    ip: string | null;
    created_at: string;
  }>;
  recentDownloads: Array<{
    id: number;
    target: string | null;
    resource_type: string | null;
    resource_id: number | null;
    ip: string | null;
    bytes_sent: number | null;
    created_at: string;
  }>;
}

export interface MarketplaceSummary {
  id: string;
  publisher: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  engineRange?: string;
  downloadCount: number;
  updatedAt?: string;
  categories: string[];
  targetPlatforms: string[];
  source: 'official' | 'openvsx';
  verified?: boolean;
  cached?: boolean;
  cachedVersions?: string[];
}

export interface MarketplaceVersion {
  version: string;
  targetPlatform: string;
  engineRange?: string;
  updatedAt?: string;
  dependencies: string[];
  extensionPack: string[];
  sha256?: string;
  downloadUrl: string;
}

export interface MarketplaceDetail extends MarketplaceSummary {
  versions: MarketplaceVersion[];
  dependencies: string[];
  extensionPack: string[];
  license?: string;
  repositoryUrl?: string;
  homepage?: string;
}

export interface MarketplaceSearchResponse extends Paginated<MarketplaceSummary> {
  provider: string;
  providers: Array<{ id: string; label: string }>;
  categories: string[];
}

export interface AuditRow {
  id: number;
  actor: string;
  actor_id: number | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: unknown;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AccessEventRow {
  id: number;
  event_type: 'page_view' | 'click' | 'download' | 'search';
  path: string | null;
  target: string | null;
  resource_type: string | null;
  resource_id: number | null;
  metadata: unknown;
  ip: string | null;
  ip_family: string | null;
  user_agent: string | null;
  referer: string | null;
  visitor_id: string | null;
  status_code: number | null;
  bytes_sent: number | null;
  duration_ms: number | null;
  created_at: string;
}

export interface AnalyticsOverview {
  days: number;
  current: { pv: number; uv: number; downloads: number; clicks: number; searches: number };
  previous: { pv: number; uv: number; downloads: number; clicks: number; searches: number };
  enabled: boolean;
  retentionDays: number;
}

export interface TimeseriesPoint {
  date: string;
  pv: number;
  uv: number;
  downloads: number;
  clicks: number;
  searches: number;
}

export interface TopContent {
  pages: Array<{ path: string; count: number }>;
  downloads: Array<{
    resource_type: string | null;
    resource_id: number | null;
    target: string | null;
    count: number;
    bytes: number;
  }>;
  searches: Array<{ target: string; count: number }>;
}

export interface StorageArtifact {
  id: number;
  type: 'vscode' | 'extension' | 'remote-server';
  filename: string;
  stored_path: string;
  size_bytes: number;
  sha256: string;
  download_count: number;
  version?: string;
  platform?: string;
  channel?: string;
  extension_id?: string;
  display_name?: string | null;
  target_platform?: string;
  created_at?: string;
  verified_at?: string | null;
}

export interface SettingsResponse {
  settings: Record<string, unknown>;
  accessCodeSet: boolean;
  info: {
    storageDir: string;
    dbPath: string;
    webDist: string;
    dataDir: string;
    allowedPrivateHosts: string[];
    sessionHours: number;
    nodeEnv: string;
    version: string;
    providers: Array<{ id: string; label: string }>;
  };
}

export interface Announcement {
  id: number;
  title: string;
  content: string;
  level: 'info' | 'success' | 'warning' | 'error';
  pinned: boolean;
  published?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
