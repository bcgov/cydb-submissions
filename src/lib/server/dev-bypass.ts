import { ROLES, type Role } from './auth-types';

export interface BypassIdentity {
  email: string;
  roles: Role[];
}

export function parseBypassConfig(raw: string | undefined | null): BypassIdentity[] | null {
  if (!raw || raw.trim() === '') return null;
  const entries = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return entries.map((entry) => {
    const [email, roleSpec] = entry.split(':');
    if (!email || !roleSpec) throw new Error(`malformed bypass entry: ${entry}`);
    const roles = roleSpec.split('+').map((r) => r.trim()) as Role[];
    for (const r of roles) {
      if (!(ROLES as readonly string[]).includes(r)) throw new Error(`unknown role: ${r}`);
    }
    return { email, roles };
  });
}
