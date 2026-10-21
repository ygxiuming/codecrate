export function compareVersions(a: string, b: string): number {
  const [aMain, aPre] = splitVersion(a);
  const [bMain, bPre] = splitVersion(b);
  const length = Math.max(aMain.length, bMain.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (aMain[index] ?? 0) - (bMain[index] ?? 0);
    if (diff !== 0) return diff;
  }
  if (aPre && !bPre) return -1;
  if (!aPre && bPre) return 1;
  if (aPre && bPre) return aPre.localeCompare(bPre);
  return 0;
}

function splitVersion(value: string): [number[], string] {
  const trimmed = value.trim();
  const dash = trimmed.indexOf('-');
  const main = dash >= 0 ? trimmed.slice(0, dash) : trimmed;
  const pre = dash >= 0 ? trimmed.slice(dash + 1) : '';
  const parts = main.split('.').map((part) => {
    const digits = part.replace(/[^0-9]/g, '');
    return digits ? Number.parseInt(digits, 10) : 0;
  });
  return [parts, pre];
}

export function sortVersionsDesc(versions: string[]): string[] {
  return [...new Set(versions)].sort((a, b) => compareVersions(b, a));
}

export function isValidVSCodeVersion(value: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}(-[A-Za-z0-9.]+)?$/.test(value) && value.length <= 40;
}

export function isExtensionVersion(value: string): boolean {
  return /^\d+(\.\d+){1,3}(-[A-Za-z0-9.]+)?$/.test(value) && value.length <= 64;
}
