import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-download-'));
process.env.DATA_DIR = storageDir;
process.env.STORAGE_DIR = storageDir;
process.env.LOG_LEVEL = 'silent';
process.env.NETWORK_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';

const payload = Buffer.alloc(300 * 1024);
for (let index = 0; index < payload.length; index += 1) payload[index] = index % 251;
const gzipPayload = gzipSync(payload);
const expectedSha = crypto.createHash('sha256').update(payload).digest('hex');

let server: http.Server;
let baseUrl = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/file') {
      const range = req.headers.range;
      if (typeof range === 'string') {
        const match = range.match(/^bytes=(\d+)-$/);
        if (match) {
          const start = Number(match[1]);
          const slice = payload.subarray(start);
          res.writeHead(206, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(slice.length),
            'Content-Range': `bytes ${start}-${payload.length - 1}/${payload.length}`,
            'Accept-Ranges': 'bytes',
          });
          res.end(slice);
          return;
        }
      }
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(payload.length),
      });
      res.end(payload);
      return;
    }
    if (req.url === '/gzip') {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'gzip',
        'Content-Length': String(gzipPayload.length),
      });
      res.end(gzipPayload);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(storageDir, { recursive: true, force: true });
});

describe('streaming downloader', () => {
  it('resumes from a .part file using Range and verifies SHA256', async () => {
    const { downloadFile } = await import('../src/services/downloader');
    const destPath = path.join(storageDir, 'downloads', 'file.bin');
    const partPath = `${destPath}.part`;
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(partPath, payload.subarray(0, 100 * 1024));

    const result = await downloadFile({
      url: `${baseUrl}/file`,
      destPath,
      expectedSha256: expectedSha,
    });

    expect(result.resumed).toBe(true);
    expect(result.size).toBe(payload.length);
    expect(result.sha256).toBe(expectedSha);
    expect(fs.readFileSync(destPath).equals(payload)).toBe(true);
    expect(fs.existsSync(partPath)).toBe(false);
  });

  it('decompresses gzip-encoded responses (marketplace vsix)', async () => {
    const { downloadFile } = await import('../src/services/downloader');
    const destPath = path.join(storageDir, 'downloads', 'file-gzip.bin');

    const result = await downloadFile({
      url: `${baseUrl}/gzip`,
      destPath,
      expectedSha256: expectedSha,
    });

    expect(result.size).toBe(payload.length);
    expect(result.sha256).toBe(expectedSha);
    expect(fs.readFileSync(destPath).equals(payload)).toBe(true);
  });

  it('rejects a wrong expected hash and removes the partial file', async () => {
    const { downloadFile } = await import('../src/services/downloader');
    const destPath = path.join(storageDir, 'downloads', 'bad.bin');

    await expect(
      downloadFile({
        url: `${baseUrl}/file`,
        destPath,
        expectedSha256: '0'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'HASH_MISMATCH' });
    expect(fs.existsSync(`${destPath}.part`)).toBe(false);
  });
});
