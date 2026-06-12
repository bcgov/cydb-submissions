import { describe, it, expect } from 'vitest';
import { auditLog } from '$lib/server/audit';
import { createLogger } from '$lib/server/log';

function captureLogger() {
	const lines: string[] = [];
	const log = createLogger({
		stream: {
			write: (s: string) => {
				lines.push(s);
				return true;
			}
		} as never
	});
	return { log, lines };
}

describe('auditLog', () => {
	it('emits with the expected base shape', () => {
		const { log, lines } = captureLogger();
		auditLog(
			'submission_viewed',
			{
				submissionUuid: 'sub-1',
				actorUserId: 'u-1',
				actorRole: 'cfd_worker',
				route: '/submissions/sub-1',
				requestId: 'req-1'
			},
			log
		);
		expect(lines).toHaveLength(1);
		const entry = JSON.parse(lines[0]);
		expect(entry).toMatchObject({
			event: 'submission_viewed',
			submissionUuid: 'sub-1',
			actorUserId: 'u-1',
			actorRole: 'cfd_worker'
		});
		expect(entry.msg).toBe('audit');
	});

	it('throws when called with an event name not on the allow-list', () => {
		const { log } = captureLogger();
		expect(() =>
			auditLog(
				// @ts-expect-error — intentional unknown event
				'totally_made_up',
				{ actorUserId: 'u', actorRole: 'admin', route: '/', requestId: 'r' },
				log
			)
		).toThrow(/unknown audit event/i);
	});
});

describe('role revocation events', () => {
	it('accepts role_revoked / role_restored with a target user + role', () => {
		const { log, lines } = captureLogger();
		auditLog(
			'role_revoked',
			{
				actorUserId: 'a1',
				actorRole: 'admin',
				targetUserId: 'u1',
				targetRole: 'admin',
				route: '/admin/users',
				requestId: 'r1'
			},
			log
		);
		auditLog(
			'role_restored',
			{
				actorUserId: 'a1',
				actorRole: 'admin',
				targetUserId: 'u1',
				targetRole: 'admin',
				route: '/admin/users',
				requestId: 'r1'
			},
			log
		);
		expect(lines).toHaveLength(2);
		expect((JSON.parse(lines[0]) as { event: string }).event).toBe('role_revoked');
		expect((JSON.parse(lines[0]) as { targetUserId: string }).targetUserId).toBe('u1');
		expect((JSON.parse(lines[1]) as { event: string }).event).toBe('role_restored');
	});
});

describe('chefs events', () => {
	const events = [
		'chefs_config_saved',
		'chefs_token_rotated',
		'chefs_test_connection',
		'chefs_sync_started',
		'chefs_sync_completed',
		'chefs_submission_ingested',
		'chefs_poller_halted'
	] as const;

	for (const ev of events) {
		it(`accepts ${ev}`, () => {
			const { log } = captureLogger();
			expect(() =>
				auditLog(ev, { actorUserId: 'u', route: '/x', requestId: 'r' }, log)
			).not.toThrow();
		});
	}
});

describe('submission decision + reason events', () => {
	it('accepts the new decision/reason audit events', () => {
		const { log, lines } = captureLogger();
		for (const event of [
			'submission_decided',
			'submission_decision_reset',
			'reason_added',
			'reason_edited',
			'reason_deactivated',
			'reason_reactivated'
		] as const) {
			auditLog(event, { route: '/x', requestId: 'r' }, log);
		}
		expect(lines).toHaveLength(6);
	});
});
