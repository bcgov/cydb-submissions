import { submissionSchema, type SubmissionInput } from '$lib/form/schema';
import type { ChefsConfig, ChefsFileRef, ChefsSubmissionRaw } from './types';

export interface MapResult {
  submissionUuid: string;
  payload: SubmissionInput;
  rawPayloadJson: string;
  attachments: ChefsFileRef[];
  validationErrors: unknown[] | null;
}

function pickSubmissionUuid(raw: ChefsSubmissionRaw): string {
  const id = raw.form?.submissionId ?? raw.form?.confirmationId;
  if (!id || typeof id !== 'string') {
    throw new Error('CHEFS submission missing form.submissionId and form.confirmationId');
  }
  return `chefs_${id}`;
}

function extractAttachments(raw: ChefsSubmissionRaw, cfg: ChefsConfig): ChefsFileRef[] {
  const out: ChefsFileRef[] = [];
  for (const key of cfg.fileComponents) {
    const v = raw[key];
    if (!Array.isArray(v)) continue;
    for (const item of v as Array<{ data?: { id?: string }; originalName?: string }>) {
      const id = item?.data?.id;
      const name = item?.originalName;
      if (typeof id === 'string' && typeof name === 'string') {
        out.push({ fileId: id, originalName: name });
      }
    }
  }
  return out;
}

export function mapChefsSubmission(raw: ChefsSubmissionRaw, cfg: ChefsConfig): MapResult {
  const submissionUuid = pickSubmissionUuid(raw);

  const stripped: Record<string, unknown> = { ...raw };
  delete stripped.form;
  for (const fc of cfg.fileComponents) delete stripped[fc];

  const rawPayloadJson = JSON.stringify(raw);
  const result = submissionSchema.safeParse(stripped);
  if (!result.success) {
    return {
      submissionUuid,
      payload: stripped as SubmissionInput,
      rawPayloadJson,
      attachments: extractAttachments(raw, cfg),
      validationErrors: result.error.issues
    };
  }
  return {
    submissionUuid,
    payload: result.data,
    rawPayloadJson,
    attachments: extractAttachments(raw, cfg),
    validationErrors: null
  };
}
