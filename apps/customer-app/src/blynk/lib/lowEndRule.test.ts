import { describe, expect, test } from 'vitest';
import { isLowEnd, LOW_END_RAM_BYTES } from './lowEndRule';

const GB = 1024 * 1024 * 1024;

describe('low-end phone rule', () => {
  test('3 GB of RAM or less is low end', () => {
    expect(isLowEnd({ totalMemory: 2 * GB, os: 'android', osVersion: 34 })).toBe(true);
    expect(isLowEnd({ totalMemory: 3 * GB, os: 'android', osVersion: 34 })).toBe(true);
    // a phone sold as 3 GB can report a little under
    expect(isLowEnd({ totalMemory: 2.8 * GB, os: 'android', osVersion: 34 })).toBe(true);
  });

  test('a 4 GB phone (even one reporting a little under 4 GiB) is not low end', () => {
    expect(isLowEnd({ totalMemory: 3.7 * GB, os: 'android', osVersion: 34 })).toBe(false);
    expect(isLowEnd({ totalMemory: 4 * GB, os: 'android', osVersion: 34 })).toBe(false);
    expect(isLowEnd({ totalMemory: 8 * GB, os: 'android', osVersion: 35 })).toBe(false);
    expect(LOW_END_RAM_BYTES).toBeLessThan(4 * GB);
  });

  test('Android 9 (API 28) and older is low end whatever the RAM', () => {
    expect(isLowEnd({ totalMemory: 6 * GB, os: 'android', osVersion: 28 })).toBe(true);
    expect(isLowEnd({ totalMemory: 6 * GB, os: 'android', osVersion: 24 })).toBe(true);
    expect(isLowEnd({ totalMemory: 6 * GB, os: 'android', osVersion: 29 })).toBe(false);
    expect(isLowEnd({ totalMemory: null, os: 'android', osVersion: '27' })).toBe(true);
  });

  test('unknown memory and a new OS is not low end', () => {
    expect(isLowEnd({ totalMemory: null, os: 'android', osVersion: 34 })).toBe(false);
    expect(isLowEnd({ totalMemory: undefined, os: 'android', osVersion: undefined })).toBe(false);
    expect(isLowEnd({ totalMemory: 0, os: 'android', osVersion: 34 })).toBe(false);
  });

  test('the Android API rule does not apply to iOS or the web', () => {
    expect(isLowEnd({ totalMemory: 6 * GB, os: 'ios', osVersion: '17.2' })).toBe(false);
    expect(isLowEnd({ totalMemory: null, os: 'ios', osVersion: 12 })).toBe(false);
    expect(isLowEnd({ totalMemory: null, os: 'web', osVersion: 5 })).toBe(false);
  });
});
