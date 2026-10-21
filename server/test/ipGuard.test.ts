import { describe, expect, it } from 'vitest';
import { networkErrorHint } from '../src/net/networkHints';
import {
  isHostAllowlisted,
  isPrivateHostname,
  isPublicAddress,
  ipFamily,
  normalizeHost,
} from '../src/net/ipGuard';

describe('isPublicAddress (IPv4)', () => {
  it.each(['8.8.8.8', '1.1.1.1', '203.0.114.1'])('allows public address %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '192.0.0.1',
    '192.0.2.10',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
  ])('blocks reserved/private address %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isPublicAddress('999.1.1.1')).toBe(false);
    expect(isPublicAddress('not-an-ip')).toBe(false);
    expect(isPublicAddress('8.8.8.8.8')).toBe(false);
  });
});

describe('isPublicAddress (IPv6)', () => {
  it('allows public IPv6', () => {
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    expect(isPublicAddress('64:ff9b::8.8.8.8')).toBe(true);
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true);
  });

  it('blocks loopback, ULA, link-local, multicast and documentation ranges', () => {
    expect(isPublicAddress('::1')).toBe(false);
    expect(isPublicAddress('::')).toBe(false);
    expect(isPublicAddress('fc00::1')).toBe(false);
    expect(isPublicAddress('fd12::1')).toBe(false);
    expect(isPublicAddress('fe80::1')).toBe(false);
    expect(isPublicAddress('ff02::1')).toBe(false);
    expect(isPublicAddress('2001:db8::1')).toBe(false);
    expect(isPublicAddress('2001::1')).toBe(false);
    expect(isPublicAddress('2002::1')).toBe(false);
    expect(isPublicAddress('100::1')).toBe(false);
  });

  it('blocks IPv4-mapped private addresses', () => {
    expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicAddress('::ffff:192.168.1.10')).toBe(false);
    expect(isPublicAddress('::ffff:10.1.2.3')).toBe(false);
  });

  it('detects families', () => {
    expect(ipFamily('127.0.0.1')).toBe('ipv4');
    expect(ipFamily('::1')).toBe('ipv6');
    expect(ipFamily('localhost')).toBeNull();
  });
});

describe('host helpers', () => {
  it('normalizes hosts', () => {
    expect(normalizeHost('[::1]')).toBe('::1');
    expect(normalizeHost('Example.COM.')).toBe('example.com');
  });

  it('matches exact and wildcard allowlist entries', () => {
    const allowlist = ['mirror.corp.local', '*.internal.example', '127.0.0.1'];
    expect(isHostAllowlisted('mirror.corp.local', allowlist)).toBe(true);
    expect(isHostAllowlisted('a.b.internal.example', allowlist)).toBe(true);
    expect(isHostAllowlisted('evil.internal.example.attacker.com', allowlist)).toBe(false);
    expect(isHostAllowlisted('mirror.corp.local.evil.com', allowlist)).toBe(false);
  });

  it('flags local-only hostnames', () => {
    expect(isPrivateHostname('localhost')).toBe(true);
    expect(isPrivateHostname('foo.localhost')).toBe(true);
    expect(isPrivateHostname('printer.local')).toBe(true);
    expect(isPrivateHostname('example.com')).toBe(false);
  });
});

describe('SSRF URL guard', () => {
  it('rejects non-http protocols, localhost and private IPs without allowlist', async () => {
    const { assertUrlAllowed } = await import('../src/net/safeFetch');
    await expect(assertUrlAllowed('file:///etc/passwd', [])).rejects.toThrow();
    await expect(assertUrlAllowed('http://127.0.0.1/', [])).rejects.toThrow();
    await expect(assertUrlAllowed('http://localhost:8080/', [])).rejects.toThrow();
    await expect(assertUrlAllowed('http://10.0.0.1/', [])).rejects.toThrow();
    await expect(assertUrlAllowed('http://user:pass@example.com/', [])).rejects.toThrow();
  });

  it('allows a private host only when explicitly allowlisted', async () => {
    const { assertUrlAllowed } = await import('../src/net/safeFetch');
    await expect(assertUrlAllowed('http://127.0.0.1:8080/', ['127.0.0.1'])).resolves.toBeInstanceOf(URL);
  });
});

describe('network hints', () => {
  it('explains the fake-IP allowlist fix', () => {
    const hint = networkErrorHint(
      '目标地址 198.18.0.116 属于环回/私有/保留地址，已被 SSRF 防护拒绝',
    );
    expect(hint).toContain('NETWORK_ALLOWED_PRIVATE_HOSTS');
    expect(hint).toContain('198.18.0.0/15');
    expect(networkErrorHint('上游返回 HTTP 404')).toBeUndefined();
  });
});
