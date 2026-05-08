import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export interface SaveAttachmentsOpts {
  baseDir: string;
  submissionUuid: string;
  maxBytes?: number;
  allowedMime?: Set<string>;
}

export interface SavedAttachment {
  originalFilename: string;
  storedPath: string;
  sizeBytes: number;
  mimeType: string;
  sha256: string;
}

export async function saveAttachments(
  opts: SaveAttachmentsOpts,
  files: File[]
): Promise<SavedAttachment[]> {
  const dir = path.join(opts.baseDir, opts.submissionUuid);
  await mkdir(dir, { recursive: true });

  const out: SavedAttachment[] = [];
  for (const f of files) {
    if (opts.maxBytes != null && f.size > opts.maxBytes) {
      throw new Error(`Attachment too large: ${f.size} > ${opts.maxBytes}`);
    }
    if (opts.allowedMime && !opts.allowedMime.has(f.type)) {
      throw new Error(`Mime type not allowed: ${f.type}`);
    }
    const buf = Buffer.from(await f.arrayBuffer());
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const stored = path.join(dir, f.name);
    await writeFile(stored, buf);
    out.push({
      originalFilename: f.name,
      storedPath: stored,
      sizeBytes: f.size,
      mimeType: f.type,
      sha256
    });
  }
  return out;
}
