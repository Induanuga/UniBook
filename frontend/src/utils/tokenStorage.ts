// src/utils/tokenStorage.ts

const KEYS = {
  ACCESS_TOKEN:  'unibook_access_token',
  REFRESH_TOKEN: 'unibook_refresh_token',
  USER:          'unibook_user',
  EXPIRES_AT:    'unibook_expires_at',
  LOGGED_OUT:    'unibook_logged_out',
  IS_CAS_USER:   'unibook_is_cas_user',   // tracks whether login was via CAS SSO
};

export const tokenStorage = {
  saveSession(
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
    user: object,
    isCas = false        // set to true when called from CasCallbackPage
  ): void {
    const expiresAt = Date.now() + expiresIn * 1000;
    localStorage.setItem(KEYS.ACCESS_TOKEN,  accessToken);
    localStorage.setItem(KEYS.REFRESH_TOKEN, refreshToken);
    localStorage.setItem(KEYS.USER,          JSON.stringify(user));
    localStorage.setItem(KEYS.EXPIRES_AT,    String(expiresAt));
    localStorage.setItem(KEYS.IS_CAS_USER,   isCas ? 'true' : 'false');
    localStorage.removeItem(KEYS.LOGGED_OUT); // fresh session — clear logout flag
  },

  updateAccessToken(accessToken: string, expiresIn: number): void {
    const expiresAt = Date.now() + expiresIn * 1000;
    localStorage.setItem(KEYS.ACCESS_TOKEN, accessToken);
    localStorage.setItem(KEYS.EXPIRES_AT,   String(expiresAt));
  },

  getAccessToken():  string | null { return localStorage.getItem(KEYS.ACCESS_TOKEN); },
  getRefreshToken(): string | null { return localStorage.getItem(KEYS.REFRESH_TOKEN); },

  getUser<T>(): T | null {
    const raw = localStorage.getItem(KEYS.USER);
    return raw ? (JSON.parse(raw) as T) : null;
  },

  getExpiresAt(): number {
    return parseInt(localStorage.getItem(KEYS.EXPIRES_AT) || '0', 10);
  },

  isAccessTokenExpired(): boolean {
    return Date.now() > tokenStorage.getExpiresAt() - 60_000;
  },

  // Returns true if the current session was established via CAS SSO
  isCasUser(): boolean {
    return localStorage.getItem(KEYS.IS_CAS_USER) === 'true';
  },

  clearSession(): void {
    localStorage.setItem(KEYS.LOGGED_OUT, 'true'); // set BEFORE clearing tokens
    localStorage.removeItem(KEYS.ACCESS_TOKEN);
    localStorage.removeItem(KEYS.REFRESH_TOKEN);
    localStorage.removeItem(KEYS.USER);
    localStorage.removeItem(KEYS.EXPIRES_AT);
    localStorage.removeItem(KEYS.IS_CAS_USER);
  },

  hasSession(): boolean {
    if (localStorage.getItem(KEYS.LOGGED_OUT) === 'true') {
      // Explicit logout — wipe any stale data and return false
      localStorage.removeItem(KEYS.ACCESS_TOKEN);
      localStorage.removeItem(KEYS.REFRESH_TOKEN);
      localStorage.removeItem(KEYS.USER);
      localStorage.removeItem(KEYS.EXPIRES_AT);
      localStorage.removeItem(KEYS.IS_CAS_USER);
      localStorage.removeItem(KEYS.LOGGED_OUT);
      return false;
    }
    return !!localStorage.getItem(KEYS.REFRESH_TOKEN);
  },
};
