import { badRequest } from '../http/errors';
import { getSetting } from '../services/settings';
import { officialMarketplaceAdapter } from './marketplaceOfficial';
import { openVsxAdapter } from './marketplaceOpenVsx';
import type { MarketplaceAdapter } from './types';

const ADAPTERS: Record<string, MarketplaceAdapter> = {
  official: officialMarketplaceAdapter,
  openvsx: openVsxAdapter,
};

export function getMarketplaceAdapter(provider?: string): MarketplaceAdapter {
  const id = (provider ?? getSetting<string>('marketplace.provider')).toLowerCase();
  const adapter = ADAPTERS[id];
  if (!adapter) {
    throw badRequest(`未知的插件市场数据源：${id}，可选 official 或 openvsx`);
  }
  return adapter;
}

export function listMarketplaceAdapters(): Array<{ id: string; label: string }> {
  return Object.values(ADAPTERS).map((adapter) => ({ id: adapter.id, label: adapter.label }));
}

export { MARKETPLACE_CATEGORIES } from './platforms';
