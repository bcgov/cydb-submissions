export interface BuildSecurityHeadersArgs {
	pathname: string;
	isProduction: boolean;
}

const STAFF_PREFIXES = ['/admin', '/submissions', '/clinician'];

function isStaffPath(pathname: string): boolean {
	return STAFF_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export function buildSecurityHeaders(args: BuildSecurityHeadersArgs): Record<string, string> {
	const headers: Record<string, string> = {
		'x-frame-options': 'DENY',
		'x-content-type-options': 'nosniff',
		'referrer-policy': 'same-origin'
	};

	if (args.isProduction) {
		headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
	}

	if (isStaffPath(args.pathname)) {
		headers['cache-control'] = 'private, no-store';
	}

	return headers;
}
