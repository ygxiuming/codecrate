export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

interface ErrorPayload {
  error?: { code?: string; message?: string; details?: unknown };
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'XMLHttpRequest',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !(init.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiRequestError('网络请求失败，请检查服务是否在线', 0, 'NETWORK_ERROR');
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const payload = (data ?? {}) as ErrorPayload;
    const error = new ApiRequestError(
      payload.error?.message ?? `请求失败（HTTP ${response.status}）`,
      response.status,
      payload.error?.code,
      payload.error?.details,
    );
    if (error.code === 'ACCESS_REQUIRED') {
      window.dispatchEvent(new Event('access-required'));
    }
    throw error;
  }
  return data as T;
}

export function qs(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  get<T>(url: string): Promise<T> {
    return request<T>(url);
  },
  post<T>(url: string, body?: unknown): Promise<T> {
    return request<T>(url, { method: 'POST', body: JSON.stringify(body ?? {}) });
  },
  put<T>(url: string, body?: unknown): Promise<T> {
    return request<T>(url, { method: 'PUT', body: JSON.stringify(body ?? {}) });
  },
  del<T>(url: string): Promise<T> {
    return request<T>(url, { method: 'DELETE' });
  },
  upload<T>(
    url: string,
    file: File,
    field = 'file',
    fields: Record<string, string | undefined> = {},
  ): Promise<T> {
    return this.uploadFiles<T>(url, [{ field, file }], fields);
  },
  uploadFiles<T>(
    url: string,
    files: Array<{ field: string; file: File }>,
    fields: Record<string, string | undefined> = {},
  ): Promise<T> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value) form.append(key, value);
    }
    for (const { field, file } of files) {
      form.append(field, file);
    }
    return request<T>(url, { method: 'POST', body: form });
  },
};
