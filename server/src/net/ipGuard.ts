import net from 'node:net';

export type IpFamily = 'ipv4' | 'ipv6';

interface ParsedV4 {
  value: number;
}

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function parseV4(input: string): ParsedV4 | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value < 0 || value > 255) return null;
    nums.push(value);
  }
  const value = ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
  return { value };
}

function inCidr4(value: number, base: string, bits: number): boolean {
  const parsed = parseV4(base);
  if (!parsed) return false;
  const mask = (~((1 << (32 - bits)) - 1) >>> 0) >>> 0;
  return ((value & mask) >>> 0) === ((parsed.value & mask) >>> 0);
}

function isPublicV4(value: number): boolean {
  return !BLOCKED_V4.some(([base, bits]) => inCidr4(value, base, bits));
}

function expandV6(input: string): number[] | null {
  let text = input.trim().toLowerCase();
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  if (!text.includes(':')) return null;

  const embedded = text.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (embedded) {
    const v4 = parseV4(embedded[1]);
    if (!v4) return null;
    const high = ((v4.value >>> 16) & 0xffff).toString(16);
    const low = (v4.value & 0xffff).toString(16);
    text = `${text.slice(0, text.length - embedded[1].length)}${high}:${low}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && left.length !== 8) return null;
  if (left.length + right.length > 8) return null;
  const groups = [
    ...left,
    ...Array.from({ length: 8 - left.length - right.length }, () => '0'),
    ...right,
  ];
  const nums: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    nums.push(Number.parseInt(group, 16));
  }
  return nums.length === 8 ? nums : null;
}

function isPublicV6(groups: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const zeroPrefix = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;

  // ::ffff:0:0/96 IPv4-mapped —— 检查内嵌 IPv4
  if (zeroPrefix && g5 === 0xffff) {
    const v4 = ((g6 << 16) | g7) >>> 0;
    return isPublicV4(v4);
  }
  // ::/96（未指定、环回、已废弃的 IPv4-compatible）
  if (zeroPrefix && g5 === 0) return false;
  // 64:ff9b::/96 NAT64 well-known prefix —— 检查内嵌 IPv4
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    const v4 = ((g6 << 16) | g7) >>> 0;
    return isPublicV4(v4);
  }
  if (g0 === 0x0064 && g1 === 0xff9b) return false;
  // 100::/64 discard-only
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return false;
  // 2001::/23 IETF 协议专用（含 Teredo 2001::/32、基准测试 2001:2::/48）
  if (g0 === 0x2001 && g1 <= 0x01ff) return false;
  // 2001:db8::/32 文档地址
  if (g0 === 0x2001 && g1 === 0x0db8) return false;
  // 2002::/16 6to4
  if (g0 === 0x2002) return false;
  // 3fff::/20 文档地址
  if (g0 === 0x3fff && (g1 & 0xf000) === 0) return false;
  // fc00::/7 唯一本地地址
  if ((g0 & 0xfe00) === 0xfc00) return false;
  // fe80::/10 链路本地
  if ((g0 & 0xffc0) === 0xfe80) return false;
  // ff00::/8 组播
  if ((g0 & 0xff00) === 0xff00) return false;
  return true;
}

export function ipFamily(value: string): IpFamily | null {
  const normalized = value.trim().replace(/^\[|\]$/g, '');
  if (net.isIPv4(normalized)) return 'ipv4';
  if (net.isIPv6(normalized)) return 'ipv6';
  return null;
}

export function isPublicAddress(value: string): boolean {
  const normalized = value.trim().replace(/^\[|\]$/g, '');
  if (net.isIPv4(normalized)) {
    const parsed = parseV4(normalized);
    return parsed ? isPublicV4(parsed.value) : false;
  }
  if (net.isIPv6(normalized)) {
    const groups = expandV6(normalized);
    return groups ? isPublicV6(groups) : false;
  }
  return false;
}

export function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

export function isHostAllowlisted(hostname: string, allowlist: string[]): boolean {
  const host = normalizeHost(hostname);
  return allowlist.some((rawEntry) => {
    const entry = normalizeHost(rawEntry);
    if (!entry) return false;
    if (entry.startsWith('*.')) return host.endsWith(entry.slice(1));
    return host === entry;
  });
}

export function isPrivateHostname(hostname: string): boolean {
  const host = normalizeHost(hostname);
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan')
  );
}
