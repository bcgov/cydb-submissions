<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import type { SubmissionStatus } from '$lib/server/db/schema';

	let { status }: { status: SubmissionStatus } = $props();

	const COLOURS: Record<SubmissionStatus, string> = {
		submitted: 'bg-blue-100 text-blue-800 border-blue-200',
		'OCR queued': 'bg-amber-100 text-amber-800 border-amber-200',
		'OCR Error': 'bg-red-100 text-red-800 border-red-200',
		'OCR processed': 'bg-blue-100 text-blue-800 border-blue-200',
		'ready for review': 'bg-violet-100 text-violet-800 border-violet-200',
		'ready for clinician': 'bg-violet-100 text-violet-800 border-violet-200',
		reviewed: 'bg-green-100 text-green-800 border-green-200',
		accepted: 'bg-emerald-100 text-emerald-800 border-emerald-200',
		rejected: 'bg-rose-100 text-rose-800 border-rose-200',
		invalid: 'bg-red-100 text-red-800 border-red-200'
	};
</script>

<Badge class={COLOURS[status]} variant="outline">{status}</Badge>
