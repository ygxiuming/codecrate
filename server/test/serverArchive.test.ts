import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inferPlatformFromFilename, inspectServerArchive } from '../src/services/serverArchive';
import { createServerTarGz, createServerZip } from './helpers/serverArchive';

const COMMIT = 'a'.repeat(40);

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-archive-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('server archive inspection', () => {
  it('reads version and commit from product.json in a tar.gz', async () => {
    const file = path.join(tmpDir, 'vscode-server-linux-x64.tar.gz');
    fs.writeFileSync(
      file,
      createServerTarGz({
        version: '1.95.0',
        commit: COMMIT,
        platform: 'linux-x64',
      }),
    );
    const info = await inspectServerArchive(file);
    expect(info?.version).toBe('1.95.0');
    expect(info?.commit).toBe(COMMIT);
    expect(info?.quality).toBe('stable');
    expect(info?.buildTime).toBe('2026-10-20T21:31:47.000Z');
  });

  it('reads version and commit from product.json in a zip', async () => {
    const file = path.join(tmpDir, 'vscode-server-win32-x64.zip');
    fs.writeFileSync(
      file,
      await createServerZip({
        version: '1.96.0',
        commit: COMMIT,
        platform: 'win32-x64',
      }),
    );
    const info = await inspectServerArchive(file);
    expect(info?.version).toBe('1.96.0');
    expect(info?.commit).toBe(COMMIT);
  });

  it('returns null when the archive has no product.json', async () => {
    const file = path.join(tmpDir, 'empty.tar.gz');
    const empty = Buffer.alloc(1024);
    const { gzipSync } = await import('node:zlib');
    fs.writeFileSync(file, gzipSync(empty));
    expect(await inspectServerArchive(file)).toBeNull();
  });

  it('rejects files that are not gzip or zip', async () => {
    const file = path.join(tmpDir, 'bad.bin');
    fs.writeFileSync(file, Buffer.from('not an archive'));
    await expect(inspectServerArchive(file)).rejects.toMatchObject({
      code: 'INVALID_ARCHIVE',
    });
  });

  it('infers the platform from a standard filename', () => {
    expect(inferPlatformFromFilename('vscode-server-linux-arm64.tar.gz')).toBe('linux-arm64');
    expect(inferPlatformFromFilename('vscode-server-darwin-arm64.zip')).toBe('darwin-arm64');
    expect(inferPlatformFromFilename('random.tar.gz')).toBeUndefined();
  });
});
