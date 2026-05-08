import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import StatusBadge from './StatusBadge.svelte';

describe('StatusBadge', () => {
  it('renders the status text', async () => {
    const { getByText } = render(StatusBadge, { status: 'submitted' });
    await expect.element(getByText('submitted')).toBeInTheDocument();
  });

  it('applies a colour class per status', () => {
    const cases: Array<[string, RegExp]> = [
      ['submitted', /blue/],
      ['invalid', /red/],
      ['OCR queued', /amber/],
      ['ready for review', /violet/],
      ['reviewed', /green/]
    ];
    for (const [status, re] of cases) {
      const { container } = render(StatusBadge, { status: status as never });
      expect(container.firstElementChild?.className).toMatch(re);
    }
  });
});
