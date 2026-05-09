import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_PATH = path.resolve('config/keywords.json');

export async function loadKeywords(filePath: string = DEFAULT_PATH): Promise<string[]> {
	const raw = await fs.readFile(filePath, 'utf8');
	const list = JSON.parse(raw);
	if (!Array.isArray(list) || !list.every((s) => typeof s === 'string')) {
		throw new Error(`${filePath} must be a JSON array of strings`);
	}
	return list;
}

const META = /[.*+?^${}()|[\]\\]/g;
function escapeRegex(s: string): string {
	return s.replace(META, '\\$&');
}

export function scanKeywords(text: string, keywords: readonly string[]): Map<string, number> {
	const hits = new Map<string, number>();
	if (!text || keywords.length === 0) return hits;
	for (const kw of keywords) {
		// Whole-word, case-insensitive. \b only treats ASCII word chars; for our English-only corpus that's fine.
		const re = new RegExp(`\\b${escapeRegex(kw)}\\b`, 'gi');
		const matches = text.match(re);
		if (matches && matches.length > 0) hits.set(kw, matches.length);
	}
	return hits;
}
