import type { InferSelectModel } from 'drizzle-orm';
import type { submissions, submissionAttachments, submissionMetadata } from '$lib/server/db/schema';

export type SubmissionRow = InferSelectModel<typeof submissions>;
export type SubmissionAttachmentRow = InferSelectModel<typeof submissionAttachments>;
export type SubmissionMetadataRow = InferSelectModel<typeof submissionMetadata>;
