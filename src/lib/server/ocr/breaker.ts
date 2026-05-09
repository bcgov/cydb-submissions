import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Logger } from 'pino';
import * as schema from '../db/schema';
import { setSystemState, clearSystemState, getSystemState } from './system-state';
import type { Mailer } from '../mail/types';

type Db = BetterSQLite3Database<typeof schema>;

export interface BreakerOpts {
	db: Db;
	mailer: Mailer;
	logger: Logger;
	threshold: number;
	recipients: string[];
	from: string;
	subjectPrefix?: string;
}

interface HaltState {
	trippedAt: string;
	threshold: number;
	jobIds: number[];
	lastErrorClass: string | null;
}

export class Breaker {
	private failedJobIds: number[] = [];
	private lastErrorClass: string | null = null;
	private wasTripped = false;

	constructor(private opts: BreakerOpts) {
		// Rehydrate as tripped if a sentinel was left behind by an earlier process.
		if (getSystemState(opts.db, 'ocr.halted')) {
			this.failedJobIds = new Array(opts.threshold).fill(-1);
			this.wasTripped = true;
		}
	}

	isTripped(): boolean {
		const tripped = getSystemState(this.opts.db, 'ocr.halted') !== null;
		// Detect external clear (admin pressed Resume on /admin/ocr): drop stale
		// rehydrated counters so a single subsequent failure doesn't immediately
		// re-trip the breaker.
		if (this.wasTripped && !tripped) {
			this.failedJobIds = [];
			this.lastErrorClass = null;
		}
		this.wasTripped = tripped;
		return tripped;
	}

	recordSuccess(): void {
		this.failedJobIds = [];
		this.lastErrorClass = null;
	}

	async recordFailure(args: { jobId: number; errorClass: string }): Promise<void> {
		this.failedJobIds.push(args.jobId);
		this.lastErrorClass = args.errorClass;
		if (this.failedJobIds.length >= this.opts.threshold && !this.isTripped()) {
			const state: HaltState = {
				trippedAt: new Date().toISOString(),
				threshold: this.opts.threshold,
				jobIds: this.failedJobIds.slice(-this.opts.threshold),
				lastErrorClass: this.lastErrorClass
			};
			setSystemState(this.opts.db, 'ocr.halted', state);
			this.opts.logger.error(
				{ event: 'queue_halted', threshold: this.opts.threshold, jobIds: state.jobIds },
				'OCR queue halted'
			);
			await this.notify(state);
		}
	}

	clear(): void {
		clearSystemState(this.opts.db, 'ocr.halted');
		this.failedJobIds = [];
		this.lastErrorClass = null;
		this.opts.logger.info({ event: 'queue_resumed' }, 'OCR queue resumed by admin');
	}

	private async notify(state: HaltState): Promise<void> {
		if (this.opts.recipients.length === 0) return;
		const prefix = this.opts.subjectPrefix ?? '[CYDB OCR]';
		const body = [
			`The CYDB OCR worker halted at ${state.trippedAt}.`,
			`Last ${state.threshold} consecutive jobs failed.`,
			`Most recent error class: ${state.lastErrorClass ?? 'unknown'}.`,
			`Job IDs: ${state.jobIds.join(', ')}`,
			`Resume via the Admin → OCR Queue page.`
		].join('\n');
		await this.opts.mailer.send({
			from: this.opts.from,
			to: this.opts.recipients,
			subject: `${prefix} queue halted after ${state.threshold} consecutive failures`,
			body
		});
	}
}
