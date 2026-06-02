import { describe, it, expect } from 'vitest';
import { parseSubmissionsQuery } from '$lib/server/sort';

describe('parseSubmissionsQuery', () => {
  const url = (qs: string) => new URL(`http://x/?${qs}`);

  it('returns sensible defaults for an empty query', () => {
    expect(parseSubmissionsQuery(url(''))).toEqual({
      sort: 'date',
      order: 'desc',
      page: 1,
      size: 25,
      statusFilter: 'exclude_invalid',
      q: ''
    });
  });

  it('clamps page to >=1 and size to [10,100]', () => {
    expect(parseSubmissionsQuery(url('page=-1&size=5'))).toMatchObject({ page: 1, size: 10 });
    expect(parseSubmissionsQuery(url('size=999'))).toMatchObject({ size: 100 });
  });

  it('rejects unknown sort columns by falling back to default', () => {
    expect(parseSubmissionsQuery(url('sort=ssn'))).toMatchObject({ sort: 'date' });
  });

  it('accepts each whitelisted sort column', () => {
    for (const c of ['date', 'surname', 'status', 'attachments']) {
      expect(parseSubmissionsQuery(url(`sort=${c}`)).sort).toBe(c);
    }
  });

  it('parses status filter values', () => {
    expect(parseSubmissionsQuery(url('status=invalid')).statusFilter).toBe('invalid');
    expect(parseSubmissionsQuery(url('status=submitted')).statusFilter).toBe('submitted');
    expect(parseSubmissionsQuery(url('status=all')).statusFilter).toBe('all');
    expect(parseSubmissionsQuery(url('status=garbage')).statusFilter).toBe('exclude_invalid');
  });

  it('honors order=asc, defaults otherwise to desc', () => {
    expect(parseSubmissionsQuery(url('order=asc')).order).toBe('asc');
    expect(parseSubmissionsQuery(url('order=desc')).order).toBe('desc');
    expect(parseSubmissionsQuery(url('order=')).order).toBe('desc');
  });

  it('parses a trimmed search query, empty by default', () => {
    expect(parseSubmissionsQuery(url('')).q).toBe('');
    expect(parseSubmissionsQuery(url('q=%20autism%20')).q).toBe('autism');
  });
});
