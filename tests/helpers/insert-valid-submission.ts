/**
 * Shared test helper: insert a minimal valid submission row into the NEW schema.
 * All NOT NULL columns are satisfied with safe fixture values.
 * Pass `overrides` to customise any column (e.g. `submissionUuid`).
 */
import * as schema from '$lib/server/db/schema';
import { randomUUID } from 'node:crypto';

type Db = {
	insert: (table: typeof schema.submissions) => {
		values: (row: unknown) => {
			returning: (cols: unknown) => { all: () => Array<{ id: number }> };
		};
	};
};

const BASE_SUBMISSION = {
	status: 'submitted' as const,
	submitterSurname: 'Test',
	childYouthFirstName: 'Test',
	childYouthLastName: 'Child',
	childYouthDob: '2015-06-01',
	childYouthGender: 'manBoy' as const,
	signatoryFirstName: 'Test',
	signatoryLastName: 'Signatory',
	signatoryDob: '1985-02-20',
	signatoryGender: 'womanGirl' as const,
	signatoryRelationship: 'Parent',
	primaryPhone: '604-555-0100',
	email: 'test@example.com',
	screening: 'Yes' as const,
	primaryCareAndControl: true,
	signature: 'Test Signatory',
	dateSigned: '2026-06-01',
	rawPayload: {} as Record<string, unknown>
};

/**
 * Insert one valid submission row and return its auto-incremented id.
 * Works with a `drizzle(sqlite, { schema })` db instance.
 */
export function insertValidSubmission(
	db: ReturnType<typeof import('drizzle-orm/better-sqlite3').drizzle<typeof schema>>,
	overrides: Partial<typeof BASE_SUBMISSION & { submissionUuid: string }> = {}
): number {
	const row = {
		submissionUuid: randomUUID(),
		...BASE_SUBMISSION,
		...overrides
	};
	const result = db
		.insert(schema.submissions)
		.values(row)
		.returning({ id: schema.submissions.id })
		.all();
	return result[0].id;
}
