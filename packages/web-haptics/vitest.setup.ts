import { beforeAll, afterAll } from 'vitest';

// Global mocks for haptic testing
beforeAll(() => {
  // Mock Vibration API
  Object.defineProperty(navigator, 'vibrate', {
    value: vi.fn().mockReturnValue(true),
    writable: true,
  });

  // Mock RAF
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(performance.now());
    return 0;
  });

  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});
