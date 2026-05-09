const SCHEDULE_MS = [15_000, 60_000, 300_000] as const;

export const MAX_ATTEMPTS = Number(process.env.OCR_MAX_ATTEMPTS ?? 3);

export function backoffMs(nextAttempt: number): number {
	if (nextAttempt < 1) return SCHEDULE_MS[0];
	return SCHEDULE_MS[Math.min(nextAttempt - 1, SCHEDULE_MS.length - 1)];
}

export function nextAttemptAt(nextAttempt: number, now: Date = new Date()): string {
	return new Date(now.getTime() + backoffMs(nextAttempt)).toISOString();
}
