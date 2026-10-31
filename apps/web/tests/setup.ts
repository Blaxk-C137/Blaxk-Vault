/**
 * jsdom is missing three browser APIs this app legitimately uses. They are
 * stubbed here rather than mocked away in components, so the components under
 * test exercise their real code paths.
 */
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = MockWebSocket.CONNECTING;
  readonly url: string;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // The real server sends a snapshot immediately; tests that care can call
    // `emit()` on the instance instead of relying on timing.
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    }, 0);
  }

  send(): void {}
  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new Event('close'));
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}

vi.stubGlobal('WebSocket', MockWebSocket);

function matchMediaStub(query: string): MediaQueryList {
  const list = {
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  };
  return list as unknown as MediaQueryList;
}

// GSAP's ScrollTrigger/Observer read matchMedia at registration time, so this
// must be a real function for the whole test run.
vi.stubGlobal('matchMedia', matchMediaStub);
vi.stubGlobal('scrollTo', () => {});

if (!('ResizeObserver' in window)) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
}

if (!('IntersectionObserver' in window)) {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): [] {
        return [];
      }
      root = null;
      rootMargin = '';
      thresholds: number[] = [];
    },
  );
}

afterEach(() => {
  cleanup();
});
