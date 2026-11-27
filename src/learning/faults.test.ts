import { afterEach, describe, expect, it } from 'vitest';

import { activeFaults, clearFaults, faultActive, isFaultName, setFault } from './faults.js';

describe('learning faults', () => {
  afterEach(() => clearFaults());

  it('never fires outside learning mode, even when set', () => {
    setFault('wake-refused', true);
    expect(activeFaults()).toEqual(['wake-refused']);
    expect(faultActive('wake-refused')).toBe(false);
  });

  it('validates names', () => {
    expect(isFaultName('route-denied')).toBe(true);
    expect(isFaultName('drop-everything')).toBe(false);
  });
});
