import type { InvalidSearchDocument } from './types';
import { toUnixSeconds } from './document';
import { logger } from '$lib/server/log';

function flattenJson(v: unknown): string {
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	if (Array.isArray(v)) return v.map(flattenJson).join(' ');
	if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).map(flattenJson).join(' ');
	return '';
}

export interface InvalidSubmissionRowForIndex {
	id: number;
	submissionUuid: string;
	rawPayload: string;
	validationErrors: unknown;
	ipAddress: string | null;
	userAgent: string | null;
	receivedAt: string;
}

export function buildInvalidSearchDocument(row: InvalidSubmissionRowForIndex): InvalidSearchDocument {
	let parsedPayload: unknown = row.rawPayload;
	try {
		parsedPayload = JSON.parse(row.rawPayload);
	} catch (e) {
		logger.error(
			{ 
				event: 	'invalid_submission_json_parse_failed', 
			  	message: (e as Error).message 
			}, 
				'raw payload for invalid submission could not be parsed'
		);
	}

	return {
		id: row.id,
		submissionUuid: row.submissionUuid,
		payloadText: flattenJson(parsedPayload),
		errorsText: flattenJson(row.validationErrors),
		metadataText: [row.ipAddress, row.userAgent].filter(Boolean).join(' '),
		receivedAt: toUnixSeconds(row.receivedAt)
	};
}
