import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-paths-'));
process.env.STORAGE_DIR = storageDir;
process.env.DATA_DIR = storageDir;

const { resolveWithin, safeFilename, contentDisposition, hashFile, removeIfExists } = await import(
  '../src/storage/paths'
);

describe('storage path guards', () => {
  it('resolves normal relative paths inside the storage root', () => {
    const absolute = resolveWithin('vscode/stable/1.95.0/file.exe');
    expect(absolute.startsWith(path.resolve(storageDir) + path.sep)).toBe(true);
  });

  it('blocks traversal and absolute paths', () => {
    expect(() => resolveWithin('../etc/passwd')).toThrow();
    expect(() => resolveWithin('vscode/../../etc/passwd')).toThrow();
    expect(() => resolveWithin('/etc/passwd')).toThrow();
  });

  it('sanitizes filenames', () => {
    expect(safeFilename('../../evil name.exe', 'fallback')).toBe('evil_name.exe');
    expect(safeFilename('..', 'fallback')).toBe('fallback');
    expect(safeFilename('中文 包.vsix', 'fallback')).toBe('____.vsix');
  });

  it('builds RFC 5987 content disposition', () => {
    const value = contentDisposition('中文 包.vsix');
    expect(value).toContain('filename="');
    expect(value).toContain("filename*=UTF-8''");
    expect(value).toContain(encodeURIComponent('中文 包.vsix'));
  });

  it('hashes files and removes them', async () => {
    const file = path.join(storageDir, 'hash.txt');
    fs.writeFileSync(file, 'abc');
    const hash = await hashFile(file);
    expect(hash).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(await removeIfExists(file)).toBe(true);
    expect(await removeIfExists(file)).toBe(false);
  });
});

describe('semver helpers', () => {
  it('sorts versions descending and compares prereleases', async () => {
    const { sortVersionsDesc, compareVersions, isValidVSCodeVersion } = await import(
      '../src/utils/semver'
    );
    expect(sortVersionsDesc(['1.9.0', '1.10.0', '1.95.0', '1.100.0'])).toEqual([
      '1.100.0',
      '1.95.0',
      '1.10.0',
      '1.9.0',
    ]);
    expect(compareVersions('1.95.0', '1.95.0-insider')).toBeGreaterThan(0);
    expect(isValidVSCodeVersion('1.95.0')).toBe(true);
    expect(isValidVSCodeVersion('1.95')).toBe(false);
  });
});
