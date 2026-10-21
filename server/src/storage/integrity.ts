import fs from 'node:fs';
import { notFound } from '../http/errors';
import { findArtifact, markVerified, type ArtifactType } from './artifacts';
import { hashFile, resolveWithin } from './paths';

export interface VerifyResult {
  ok: boolean;
  expected: string;
  actual: string;
  filename: string;
  sizeBytes: number;
  verifiedAt: string | null;
}

export async function verifyArtifact(type: ArtifactType, id: number): Promise<VerifyResult> {
  const record = findArtifact(type, id);
  if (!record) throw notFound('资源不存在');
  const absolute = resolveWithin(record.stored_path);
  if (!fs.existsSync(absolute)) {
    return {
      ok: false,
      expected: record.sha256,
      actual: '',
      filename: record.filename,
      sizeBytes: record.size_bytes,
      verifiedAt: null,
    };
  }
  const actual = await hashFile(absolute);
  const ok = actual === record.sha256;
  if (ok) markVerified(type, id);
  return {
    ok,
    expected: record.sha256,
    actual,
    filename: record.filename,
    sizeBytes: record.size_bytes,
    verifiedAt: ok ? new Date().toISOString() : null,
  };
}
