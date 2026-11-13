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
	assessmentIndex?: number;
	// Set when the source file could not be retrieved (e.g. deleted upstream); no file is stored.
	missingAt?: string;
}

interface MimeProfile {
	extensions: string[];
	matchesMagic: (buf: Buffer) => boolean;
}

const MIME_PROFILES: Record<string, MimeProfile> = {
	'application/pdf': {
		extensions: ['.pdf'],
		matchesMagic: (b) => b.length >= 4 && b.slice(0, 4).toString('ascii') === '%PDF'
	},
	'image/jpeg': {
		extensions: ['.jpg', '.jpeg'],
		matchesMagic: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
	},
	'image/png': {
		extensions: ['.png'],
		matchesMagic: (b) =>
			b.length >= 8 &&
			b[0] === 0x89 &&
			b[1] === 0x50 &&
			b[2] === 0x4e &&
			b[3] === 0x47 &&
			b[4] === 0x0d &&
			b[5] === 0x0a &&
			b[6] === 0x1a &&
			b[7] === 0x0a
	},
	'image/heic': {
		// HEIC: bytes 4..12 contain 'ftyp' + brand (heic/heix/hevc/mif1 etc.).
		extensions: ['.heic'],
		matchesMagic: (b) => b.length >= 12 && b.slice(4, 8).toString('ascii') === 'ftyp'
	},
	'application/msword': {
		// CFB / OLE2: D0 CF 11 E0 A1 B1 1A E1
		extensions: ['.doc'],
		matchesMagic: (b) =>
			b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0
	},
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
		// DOCX is a zip: PK\x03\x04
		extensions: ['.docx'],
		matchesMagic: (b) =>
			b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
	}
};

function sanitiseFilename(raw: string): string {
	// eslint-disable-next-line no-control-regex -- strip control chars from filenames
	const base = path.basename(raw).replace(/[\x00-\x1f\\/]/g, '_');
	return base.length > 0 ? base : 'attachment';
}

function endsWithAllowedExtension(filename: string, profile: MimeProfile): boolean {
	const lower = filename.toLowerCase();
	return profile.extensions.some((ext) => lower.endsWith(ext));
}

function hasDoubleExtension(filename: string, profile: MimeProfile): boolean {
	// Reject when the basename has additional extension-like suffixes beyond the
	// one that matches the claimed MIME. e.g. "evil.pdf.exe" with mime=pdf.
	const lower = filename.toLowerCase();
	const matched = profile.extensions.find((ext) => lower.endsWith(ext));
	if (!matched) return false;
	const stem = lower.slice(0, lower.length - matched.length);
	// Any further "." inside the stem implies stacked extensions / spoofing.
	return /\.[a-z0-9]{1,8}$/i.test(stem);
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

		const safeName = sanitiseFilename(f.name);
		const profile = MIME_PROFILES[f.type];

		if (profile) {
			if (!endsWithAllowedExtension(safeName, profile)) {
				throw new Error(`Filename extension does not match claimed mime ${f.type}: ${safeName}`);
			}
			if (hasDoubleExtension(safeName, profile)) {
				throw new Error(`Filename has stacked extensions; reject: ${safeName}`);
			}
		}

		const buf = Buffer.from(await f.arrayBuffer());

		if (profile && !profile.matchesMagic(buf)) {
			throw new Error(`File content does not match claimed mime ${f.type} (magic-byte mismatch)`);
		}

		const sha256 = createHash('sha256').update(buf).digest('hex');
		const stored = path.join(dir, safeName);
		await writeFile(stored, buf);
		out.push({
			originalFilename: safeName,
			storedPath: stored,
			sizeBytes: f.size,
			mimeType: f.type,
			sha256
		});
	}
	return out;
}
