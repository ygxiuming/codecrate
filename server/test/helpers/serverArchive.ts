import { gzipSync } from 'node:zlib';
import yazl from 'yazl';

export interface ServerArchiveOptions {
  version: string;
  commit: string;
  platform: string;
  quality?: string;
  date?: string;
}

function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.write('        ', 148, 8, 'ascii');
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}

function productJson(options: ServerArchiveOptions): Buffer {
  return Buffer.from(
    JSON.stringify(
      {
        nameShort: 'Code',
        nameLong: 'Visual Studio Code',
        quality: options.quality ?? 'stable',
        commit: options.commit,
        date: options.date ?? '2026-10-20T14:31:47-07:00',
        version: options.version,
      },
      null,
      2,
    ),
    'utf8',
  );
}

export function createServerTarGz(options: ServerArchiveOptions): Buffer {
  const product = productJson(options);
  const name = `vscode-server-${options.platform}/product.json`;
  const header = tarHeader(name, product.length);
  const padding = Buffer.alloc((512 - (product.length % 512)) % 512);
  const end = Buffer.alloc(1024);
  return gzipSync(Buffer.concat([header, product, padding, end]));
}

export async function createServerZip(options: ServerArchiveOptions): Promise<Buffer> {
  const product = productJson(options);
  const zip = new yazl.ZipFile();
  zip.addBuffer(product, `vscode-server-${options.platform}/product.json`);
  zip.end();
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
  });
}
