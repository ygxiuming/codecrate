import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createVsix } from './helpers/vsix';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-vsix-'));
const vsixPath = path.join(tmpDir, 'demo.vsix');
const invalidPath = path.join(tmpDir, 'invalid.vsix');

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('vsix parser', () => {
  it('parses manifest, package.json, dependencies and icon', async () => {
    const buffer = await createVsix({
      publisher: 'demo',
      name: 'demo-ext',
      version: '1.2.3',
      displayName: 'Demo Extension',
      description: 'A demo extension',
      engine: '^1.95.0',
      categories: ['Other', 'Testing'],
      dependencies: ['demo.publisher.dep-ext'],
      extensionPack: ['demo.publisher.pack-ext'],
    });
    fs.writeFileSync(vsixPath, buffer);

    const { parseVsix } = await import('../src/services/vsix');
    const parsed = await parseVsix(vsixPath);
    expect(parsed.metadata.extensionId).toBe('demo.demo-ext');
    expect(parsed.metadata.publisher).toBe('demo');
    expect(parsed.metadata.version).toBe('1.2.3');
    expect(parsed.metadata.engineRange).toBe('^1.95.0');
    expect(parsed.metadata.categories).toEqual(['Other', 'Testing']);
    expect(parsed.metadata.dependencies).toContain('demo.publisher.dep-ext');
    expect(parsed.metadata.extensionPack).toContain('demo.publisher.pack-ext');
    expect(parsed.metadata.repositoryUrl).toBe('https://example.com/repo');
    expect(parsed.icon?.filename).toBe('icon.png');
    expect(parsed.icon?.data.length).toBeGreaterThan(0);
  });

  it('rejects files that are not zip archives', async () => {
    fs.writeFileSync(invalidPath, 'this is not a vsix');
    const { parseVsix } = await import('../src/services/vsix');
    await expect(parseVsix(invalidPath)).rejects.toThrow(/不是有效的 vsix/);
  });
});
