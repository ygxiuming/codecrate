export interface ResolvedArtifact {
  url: string;
  filename: string;
  sizeBytes: number;
  contentType?: string;
  sha256?: string;
  commitHash?: string;
  buildTime?: string;
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
}

export interface MarketplaceVersion {
  version: string;
  /** 空字符串表示通用包（universal）。 */
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

export interface MarketplaceSearchParams {
  q: string;
  category?: string;
  sort: 'relevance' | 'downloads' | 'updated';
  page: number;
  pageSize: number;
}

export interface MarketplacePage {
  items: MarketplaceSummary[];
  total: number;
  page: number;
  pageSize: number;
  provider: string;
}

export interface ResolvedMarketplacePackage {
  provider: 'official' | 'openvsx';
  id: string;
  publisher: string;
  name: string;
  displayName: string;
  description?: string;
  version: string;
  targetPlatform: string;
  engineRange?: string;
  categories: string[];
  dependencies: string[];
  extensionPack: string[];
  downloadUrl: string;
  sha256?: string;
  publishedAt?: string;
}

export interface MarketplaceAdapter {
  id: 'official' | 'openvsx';
  label: string;
  search(params: MarketplaceSearchParams): Promise<MarketplacePage>;
  detail(id: string): Promise<MarketplaceDetail>;
  resolvePackage(
    id: string,
    version?: string,
    targetPlatform?: string,
  ): Promise<ResolvedMarketplacePackage>;
}
