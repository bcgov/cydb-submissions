import { describe, it, expect } from 'vitest';
import { parseBypassConfig } from '$lib/server/dev-bypass';

describe('parseBypassConfig', () => {
  it('returns null for empty / undefined', () => {
    expect(parseBypassConfig(undefined)).toBeNull();
    expect(parseBypassConfig('')).toBeNull();
  });

  it('parses a single email:role pair', () => {
    expect(parseBypassConfig('a@x:admin')).toEqual([
      { email: 'a@x', roles: ['admin'] }
    ]);
  });

  it('parses multiple identities separated by commas', () => {
    expect(parseBypassConfig('a@x:admin,b@y:cfd_worker,c@z:clinician')).toEqual([
      { email: 'a@x', roles: ['admin'] },
      { email: 'b@y', roles: ['cfd_worker'] },
      { email: 'c@z', roles: ['clinician'] }
    ]);
  });

  it('parses multiple roles per identity with +', () => {
    expect(parseBypassConfig('a@x:admin+cfd_worker')).toEqual([
      { email: 'a@x', roles: ['admin', 'cfd_worker'] }
    ]);
  });

  it('throws on an unknown role', () => {
    expect(() => parseBypassConfig('a@x:wizard')).toThrow(/unknown role/);
  });

  it('throws on a malformed entry', () => {
    expect(() => parseBypassConfig('not-a-pair')).toThrow(/malformed/);
  });
});
