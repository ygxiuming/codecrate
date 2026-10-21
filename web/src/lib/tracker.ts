interface TrackEvent {
  type: 'page_view' | 'click' | 'search';
  path?: string;
  target?: string;
  resourceType?: 'vscode' | 'extension' | 'remote-server';
  resourceId?: number;
  metadata?: Record<string, string | number | boolean>;
}

const queue: TrackEvent[] = [];
let timer: number | null = null;
let initialized = false;

function isAdminPath(): boolean {
  return window.location.pathname.startsWith('/admin');
}

function flush(useBeacon = false): void {
  if (queue.length === 0 || isAdminPath()) return;
  const events = queue.splice(0, 20).map((event) => ({
    ...event,
    path: event.path ?? window.location.pathname,
  }));
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  const body = JSON.stringify({ events });
  if (useBeacon && typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }));
  } else {
    void fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      credentials: 'same-origin',
      keepalive: true,
    }).catch(() => undefined);
  }
  if (queue.length > 0) schedule();
}

function schedule(): void {
  if (timer !== null) return;
  timer = window.setTimeout(() => {
    timer = null;
    flush(false);
  }, 5000);
}

export function track(event: TrackEvent): void {
  if (isAdminPath()) return;
  queue.push(event);
  if (queue.length >= 20) flush(false);
  else schedule();
}

export function trackPageView(path: string): void {
  track({ type: 'page_view', path });
}

export function trackSearch(keyword: string): void {
  const value = keyword.trim().slice(0, 100);
  if (!value) return;
  track({ type: 'search', target: value });
}

export function trackClick(
  target: string,
  options: {
    resourceType?: 'vscode' | 'extension' | 'remote-server';
    resourceId?: number;
    metadata?: Record<string, string | number | boolean>;
  } = {},
): void {
  track({ type: 'click', target, ...options });
}

export function initTracker(): void {
  if (initialized) return;
  initialized = true;
  window.addEventListener('pagehide', () => flush(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
}
