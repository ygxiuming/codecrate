import yazl from 'yazl';

const ICON_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

export interface VsixOptions {
  publisher: string;
  name: string;
  version: string;
  displayName: string;
  description?: string;
  engine?: string;
  categories?: string[];
  dependencies?: string[];
  extensionPack?: string[];
  withIcon?: boolean;
}

export async function createVsix(options: VsixOptions): Promise<Buffer> {
  const id = `${options.publisher}.${options.name}`;
  const pkg = {
    name: options.name,
    publisher: options.publisher,
    version: options.version,
    displayName: options.displayName,
    description: options.description ?? 'Demo extension for tests',
    engines: { vscode: options.engine ?? '^1.95.0' },
    categories: options.categories ?? ['Other'],
    keywords: ['demo', 'test'],
    extensionDependencies: options.dependencies ?? [],
    extensionPack: options.extensionPack ?? [],
    license: 'MIT',
    repository: { type: 'git', url: 'https://example.com/repo' },
    homepage: 'https://example.com',
    icon: options.withIcon === false ? undefined : 'resources/icon.png',
  };

  const manifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="${id}" Version="${options.version}" Publisher="${options.publisher}" />
    <DisplayName>${options.displayName}</DisplayName>
    <Description xml:space="preserve">${options.description ?? 'Demo extension for tests'}</Description>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
    <Dependencies>
      <Dependency Id="${id}" Version="[${options.version},)" />
    </Dependencies>
  </Installation>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>`;

  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(pkg, null, 2), 'utf8'), 'extension/package.json');
  zip.addBuffer(Buffer.from(manifest, 'utf8'), 'extension.vsixmanifest');
  if (options.withIcon !== false) {
    zip.addBuffer(ICON_PNG, 'extension/resources/icon.png');
  }
  zip.addBuffer(Buffer.from('# Demo\n'), 'extension/README.md');
  zip.end();

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
  });
}
