import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { createVsix } from './vsix';

export interface MockSource {
  baseUrl: string;
  port: number;
  uploadVsix: Buffer;
  marketVsix: Buffer;
  openVsxVsix: Buffer;
  binary: Buffer;
  serverBinary: Buffer;
  close: () => Promise<void>;
}

const COMMIT = '912bb683695358a54ae0c670461738984cbb5b95';

function serveBuffer(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  buffer: Buffer,
  contentType: string,
): void {
  const rangeHeader = req.headers.range;
  if (typeof rangeHeader === 'string') {
    const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), buffer.length - 1) : buffer.length - 1;
      if (start >= 0 && start <= end && start < buffer.length) {
        res.writeHead(206, {
          'Content-Type': contentType,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${buffer.length}`,
          'Accept-Ranges': 'bytes',
        });
        res.end(req.method === 'HEAD' ? undefined : buffer.subarray(start, end + 1));
        return;
      }
    }
  }
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': String(buffer.length),
    'Accept-Ranges': 'bytes',
  });
  res.end(req.method === 'HEAD' ? undefined : buffer);
}

function sendJson(res: http.ServerResponse, data: unknown, status = 200): void {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
  });
  res.end(body);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

function vscodeFilename(version: string, platform: string): string {
  if (platform === 'darwin') return 'VSCode-darwin.zip';
  if (platform === 'darwin-arm64') return 'VSCode-darwin-arm64.zip';
  if (platform === 'win32-x64-user') return `VSCodeUserSetup-x64-${version}.exe`;
  if (platform === 'win32-arm64-user') return `VSCodeUserSetup-arm64-${version}.exe`;
  if (platform === 'linux-deb-x64') return `code_${version}-1730153583_amd64.deb`;
  if (platform === 'linux-deb-arm64') return `code_${version}-1730153583_arm64.deb`;
  if (platform === 'linux-rpm-x64') return `code-${version}-1730153639.el8.x86_64.rpm`;
  if (platform === 'linux-rpm-arm64') return `code-${version}-1730153639.el8.aarch64.rpm`;
  return `code-stable-${platform}-1730152418.tar.gz`;
}

export async function startMockSource(): Promise<MockSource> {
  const uploadVsix = await createVsix({
    publisher: 'demo',
    name: 'demo-ext',
    version: '1.0.0',
    displayName: 'Demo Uploaded Extension',
    description: 'Uploaded via the admin API',
    engine: '^1.95.0',
    categories: ['Other', 'Testing'],
    dependencies: ['demo.publisher.dep-ext'],
    extensionPack: ['demo.publisher.pack-ext'],
  });
  const marketVsix = await createVsix({
    publisher: 'demo',
    name: 'market-ext',
    version: '1.0.1',
    displayName: 'Demo Market Extension',
    description: 'Cached from the mock marketplace',
    engine: '^1.95.0',
    categories: ['Themes'],
  });
  const openVsxVsix = await createVsix({
    publisher: 'demo',
    name: 'open-ext',
    version: '1.0.0',
    displayName: 'Demo Open VSX Extension',
    description: 'Cached from mock Open VSX',
    engine: '^1.95.0',
    categories: ['Tools'],
  });

  const binary = Buffer.alloc(1024 * 1024);
  for (let index = 0; index < binary.length; index += 1) binary[index] = index % 251;
  const serverBinary = Buffer.alloc(512 * 1024, 0x62);

  const marketSha = crypto.createHash('sha256').update(marketVsix).digest('hex');
  const openVsxSha = crypto.createHash('sha256').update(openVsxVsix).digest('hex');
  const marketGzip = gzipSync(marketVsix);

  let port = 0;
  const base = (): string => `http://127.0.0.1:${port}`;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', base());
    const pathname = url.pathname;

    if (pathname === '/api/releases/stable' && req.method === 'GET') {
      sendJson(res, ['1.95.0', '1.94.0']);
      return;
    }

    const vscodeMatch = pathname.match(/^\/(\d+\.\d+\.\d+)\/([^/]+)\/stable$/);
    if (vscodeMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      const version = vscodeMatch[1];
      const platform = vscodeMatch[2];
      if (platform === 'win32-x64-system') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(302, {
        Location: `/cdn/stable/${COMMIT}/${vscodeFilename(version, platform)}`,
      });
      res.end();
      return;
    }

    const remoteMatch = pathname.match(/^\/commit:([0-9a-f]{40})\/server-([^/]+)\/stable$/);
    if (remoteMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      const commit = remoteMatch[1];
      const platform = remoteMatch[2];
      const extension = platform.startsWith('linux') ? 'tar.gz' : 'zip';
      res.writeHead(302, {
        Location: `/cdn/stable/${commit}/vscode-server-${platform}.${extension}`,
      });
      res.end();
      return;
    }

    const cdnMatch = pathname.match(/^\/cdn\/stable\/[0-9a-f]{40}\/(.+)$/);
    if (cdnMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      const filename = decodeURIComponent(cdnMatch[1]);
      const buffer = filename.includes('server') ? serverBinary : binary;
      serveBuffer(req, res, buffer, 'application/octet-stream');
      return;
    }

    if (
      pathname === '/marketplace/_apis/public/gallery/extensionquery' &&
      req.method === 'POST'
    ) {
      const body = JSON.parse((await readBody(req)) || '{}') as {
        filters?: Array<{ criteria?: Array<{ filterType?: number; value?: string }> }>;
        flags?: number;
      };
      const criteria = body.filters?.[0]?.criteria ?? [];
      const idFilter = criteria.find((item) => item.filterType === 7);
      if (idFilter && idFilter.value !== 'demo.market-ext') {
        sendJson(res, {
          results: [
            {
              extensions: [],
              resultMetadata: [
                { metadataType: 'ResultCount', metadataItems: [{ name: 'TotalCount', count: 0 }] },
              ],
            },
          ],
        });
        return;
      }
      const properties = [
        { key: 'Microsoft.VisualStudio.Code.Engine', value: '^1.95.0' },
        { key: 'Microsoft.VisualStudio.Code.ExtensionDependencies', value: '' },
        { key: 'Microsoft.VisualStudio.Code.ExtensionPack', value: '' },
        { key: 'Microsoft.VisualStudio.Services.VsixSha256', value: marketSha },
      ];
      const allVersions = [
        {
          version: '1.0.1',
          lastUpdated: '2026-10-20T00:00:00.000Z',
          properties,
          files: [
            {
              assetType: 'Microsoft.VisualStudio.Code.Manifest',
              source: `${base()}/marketplace/manifest`,
            },
          ],
        },
        {
          version: '1.0.0',
          lastUpdated: '2026-10-19T00:00:00.000Z',
          properties,
          files: [
            {
              assetType: 'Microsoft.VisualStudio.Code.Manifest',
              source: `${base()}/marketplace/manifest`,
            },
          ],
        },
      ];
      // 与官方 gallery 一致：flags 包含 IncludeLatestVersionOnly（512）时只返回最新版本。
      const versions = ((body.flags ?? 0) & 512) !== 0
        ? allVersions.filter((item) => item.version === '1.0.1')
        : allVersions;
      const extension = {
        publisher: { publisherName: 'demo', displayName: 'Demo' },
        extensionName: 'market-ext',
        displayName: 'Demo Market Extension',
        shortDescription: 'Marketplace demo extension',
        lastUpdated: '2026-10-20T00:00:00.000Z',
        versions,
        statistics: [{ statisticName: 'install', value: 1234 }],
      };
      sendJson(res, {
        results: [
          {
            extensions: [extension],
            resultMetadata: [
              { metadataType: 'ResultCount', metadataItems: [{ name: 'TotalCount', count: 1 }] },
            ],
          },
        ],
      });
      return;
    }

    if (pathname === '/marketplace/manifest') {
      sendJson(res, {
        categories: ['Themes'],
        keywords: ['demo'],
        license: 'MIT',
        repository: { url: 'https://example.com/market' },
        homepage: 'https://example.com/market',
      });
      return;
    }

    if (
      pathname ===
        '/marketplace/_apis/public/gallery/publishers/demo/vsextensions/market-ext/1.0.1/vspackage' &&
      (req.method === 'GET' || req.method === 'HEAD')
    ) {
      res.writeHead(200, {
        'Content-Type': 'application/vsix',
        'Content-Encoding': 'gzip',
        'Content-Length': String(marketGzip.length),
        'Content-Disposition':
          'attachment; filename="demo.market-ext-1.0.1.vsix"',
      });
      res.end(req.method === 'HEAD' ? undefined : marketGzip);
      return;
    }

    if (pathname === '/openvsx/api/-/search') {
      sendJson(res, {
        extensions: [
          {
            namespace: 'demo',
            name: 'open-ext',
            version: '1.0.0',
            displayName: 'Demo Open VSX Extension',
            description: 'Open VSX demo',
            downloadCount: 42,
            timestamp: '2026-10-19T00:00:00.000Z',
            files: {
              download: `${base()}/openvsx/api/demo/open-ext/1.0.0/file/demo.open-ext-1.0.0.vsix`,
            },
          },
        ],
        offset: 0,
        totalSize: 1,
      });
      return;
    }

    if (pathname === '/openvsx/api/demo/open-ext' || pathname === '/openvsx/api/demo/open-ext/latest') {
      sendJson(res, {
        namespace: 'demo',
        name: 'open-ext',
        version: '1.0.0',
        displayName: 'Demo Open VSX Extension',
        description: 'Open VSX demo',
        downloadCount: 42,
        timestamp: '2026-10-19T00:00:00.000Z',
        categories: ['Tools'],
        license: 'MIT',
        repository: 'https://example.com/open',
        homepage: 'https://example.com/open',
        engines: { vscode: '^1.95.0' },
        files: {
          download: `${base()}/openvsx/api/demo/open-ext/1.0.0/file/demo.open-ext-1.0.0.vsix`,
          sha256: `${base()}/openvsx/api/demo/open-ext/1.0.0/file/demo.open-ext-1.0.0.sha256`,
        },
        allVersions: {
          latest: `${base()}/openvsx/api/demo/open-ext`,
          '1.0.0': `${base()}/openvsx/api/demo/open-ext/1.0.0`,
        },
        dependencies: [],
        bundledExtensions: [],
      });
      return;
    }

    if (pathname === '/openvsx/api/demo/open-ext/1.0.0/file/demo.open-ext-1.0.0.vsix') {
      serveBuffer(req, res, openVsxVsix, 'application/octet-stream');
      return;
    }

    if (pathname === '/openvsx/api/demo/open-ext/1.0.0/file/demo.open-ext-1.0.0.sha256') {
      const body = Buffer.from(`${openVsxSha}\n`, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': String(body.length) });
      res.end(body);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;

  return {
    baseUrl: base(),
    port,
    uploadVsix,
    marketVsix,
    openVsxVsix,
    binary,
    serverBinary,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
