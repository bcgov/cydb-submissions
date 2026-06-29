import type { InferSelectModel } from 'drizzle-orm';
import type { submissions, submissionAttachments, submissionMetadata } from '$lib/server/db/schema';

export type SubmissionRow = InferSelectModel<typeof submissions>;
export type SubmissionAttachmentRow = InferSelectModel<typeof submissionAttachments>;
export type SubmissionMetadataRow = InferSelectModel<typeof submissionMetadata>;

/** Per-attachment OCR state surfaced to the submission view. */
export interface AttachmentOcr {
	// 'processed' once extracted text exists; otherwise the queue job's state,
	// or null when no OCR was run for this attachment.
	status: 'processed' | 'queued' | 'processing' | 'failed' | 'abandoned' | null;
	text: string | null;
	pages: number | null;
	processedAt: string | null;
	error: string | null;
	keyword: Map<string, Array<string>>;
	categoryMap: Map<string, string>;
}

export type AttachmentWithOcr = SubmissionAttachmentRow & { ocr: AttachmentOcr };
