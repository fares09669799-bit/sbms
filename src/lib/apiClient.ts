let inMemoryAccessToken: string | null = null;
let inMemoryRefreshToken: string | null = null;

const REFRESH_STORAGE_KEY = 'sbms_refresh_token';

export function setAuthTokens(accessToken: string | null, refreshToken: string | null, persist: boolean) {
  inMemoryAccessToken = accessToken;
  inMemoryRefreshToken = refreshToken;
  try {
    if (persist && refreshToken) {
      sessionStorage.setItem(REFRESH_STORAGE_KEY, refreshToken);
    } else {
      sessionStorage.removeItem(REFRESH_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function getStoredRefreshToken(): string | null {
  if (inMemoryRefreshToken) return inMemoryRefreshToken;
  try {
    return sessionStorage.getItem(REFRESH_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearAuthTokens() {
  inMemoryAccessToken = null;
  inMemoryRefreshToken = null;
  try {
    sessionStorage.removeItem(REFRESH_STORAGE_KEY);
  } catch {
    // ignore
  }
}

let inFlightRefreshPromise: Promise<string | null> | null = null;

async function tryRefreshAccessToken(): Promise<string | null> {
  if (inFlightRefreshPromise) return inFlightRefreshPromise;

  inFlightRefreshPromise = (async () => {
    const rt = getStoredRefreshToken();
    if (!rt) return null;

    let hadPersistedToken = false;
    try {
      hadPersistedToken = Boolean(sessionStorage.getItem(REFRESH_STORAGE_KEY));
    } catch {
      hadPersistedToken = false;
    }

    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (!res.ok) {
        clearAuthTokens();
        return null;
      }
      const data = (await res.json()) as { accessToken?: string; refreshToken?: string };
      if (data.accessToken) {
        const nextRefresh = data.refreshToken || rt;
        setAuthTokens(data.accessToken, nextRefresh, hadPersistedToken);
        return data.accessToken;
      }
      return null;
    } catch {
      return null;
    } finally {
      inFlightRefreshPromise = null;
    }
  })();

  return inFlightRefreshPromise;
}

export async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  const makeHeaders = (token: string | null): HeadersInit => ({
    'Content-Type': 'application/json',
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  if (!inMemoryAccessToken && getStoredRefreshToken()) {
    await tryRefreshAccessToken();
  }

  let res = await fetch(url, {
    ...options,
    headers: makeHeaders(inMemoryAccessToken),
  });

  if (res.status === 401 && getStoredRefreshToken()) {
    const refreshed = await tryRefreshAccessToken();
    if (refreshed) {
      res = await fetch(url, {
        ...options,
        headers: makeHeaders(refreshed),
      });
    }
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const errMsg =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : 'حدث خطأ في الاتصال بالخادم.';
    return { ok: false, status: res.status, error: errMsg };
  }

  return { ok: true, status: res.status, data: payload as T };
}
