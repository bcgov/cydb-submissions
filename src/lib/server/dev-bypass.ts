import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { ROLES, type Role } from './auth-types';
import { user, userRoles } from './db/schema';
import type { DrizzleDb } from './roles';

export interface BypassIdentity {
  email: string;
  roles: Role[];
}

export interface BypassResult {
  user: { id: string; email: string; name: string };
  roles: Set<Role>;
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

export async function applyBypass(
  db: DrizzleDb,
  identities: BypassIdentity[],
  requestedEmail: string | undefined
): Promise<BypassResult | null> {
  const target =
    identities.find((i) => i.email === requestedEmail) ??
    (requestedEmail ? null : identities[0]);
  if (!target) return null;

  const existing = await db.select().from(user).where(eq(user.email, target.email)).limit(1);
  let row = existing[0];
  if (!row) {
    const id = nanoid();
    await db.insert(user).values({
      id,
      email: target.email,
      name: target.email.split('@')[0],
      emailVerified: false
    });
    const created = await db.select().from(user).where(eq(user.id, id)).limit(1);
    row = created[0];
  }

  const present = await db.select().from(userRoles).where(eq(userRoles.userId, row.id));
  const have = new Set(present.map((r) => r.role));
  for (const role of target.roles) {
    if (!have.has(role)) {
      await db.insert(userRoles).values({ userId: row.id, role });
    }
  }

  return {
    user: { id: row.id, email: row.email, name: row.name },
    roles: new Set(target.roles)
  };
}
