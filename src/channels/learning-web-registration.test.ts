import { describe, expect, it } from 'vitest';

import './index.js';
import { getRegisteredChannelNames } from './channel-registry.js';
import { isLearning } from '../learning/trace.js';
import { panelChannelReady } from './learning-web.js';

describe('learning-web channel registration', () => {
  it('is registered through the channel barrel', () => {
    expect(getRegisteredChannelNames()).toContain('learning-web');
    expect(getRegisteredChannelNames()).toContain('cli');
  });

  it('stays dark outside learning mode', () => {
    expect(isLearning()).toBe(false);
    expect(panelChannelReady()).toBe(false);
  });
});
