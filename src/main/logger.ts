let enabled = true;

export function setLoggerEnabled(nextEnabled: boolean): void {
  enabled = nextEnabled;
}

export function isLoggerEnabled(): boolean {
  return enabled;
}

export function log(...args: unknown[]): void {
  if (!enabled) {
    return;
  }

  console.log(...args);
}

export function info(...args: unknown[]): void {
  if (!enabled) {
    return;
  }

  console.info(...args);
}

export function warn(...args: unknown[]): void {
  if (!enabled) {
    return;
  }

  console.warn(...args);
}

export function error(...args: unknown[]): void {
  if (!enabled) {
    return;
  }

  console.error(...args);
}

export function debug(...args: unknown[]): void {
  if (!enabled) {
    return;
  }

  console.debug(...args);
}
