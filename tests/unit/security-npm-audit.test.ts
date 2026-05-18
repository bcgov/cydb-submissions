import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

interface AuditJSON {
	metadata?: {
		vulnerabilities?: {
			critical?: number;
			high?: number;
			moderate?: number;
			low?: number;
			info?: number;
			total?: number;
		};
	};
}

function runNpmAudit(): AuditJSON | null {
	try {
		const out = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		});
		return JSON.parse(out) as AuditJSON;
	} catch (e) {
		// npm audit exits non-zero when vulnerabilities are found; stdout still
		// carries the JSON. execFileSync attaches it to error.stdout.
		const err = e as { stdout?: Buffer | string };
		if (err.stdout) {
			const s = typeof err.stdout === 'string' ? err.stdout : err.stdout.toString('utf8');
			try {
				return JSON.parse(s) as AuditJSON;
			} catch {
				return null;
			}
		}
		return null;
	}
}

describe('npm audit — production-dep vulnerability gate (11.2)', () => {
	const audit = runNpmAudit();

	it('produces parseable JSON when run with --omit=dev', () => {
		expect(audit).toBeTruthy();
		expect(audit?.metadata?.vulnerabilities).toBeTruthy();
	});

	it('reports zero critical advisories on production deps', () => {
		expect(audit?.metadata?.vulnerabilities?.critical ?? -1).toBe(0);
	});

	it('reports zero high advisories on production deps', () => {
		expect(audit?.metadata?.vulnerabilities?.high ?? -1).toBe(0);
	});
});
