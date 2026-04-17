import { pushAutomateBotLog } from "./automateBotLogs";

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

  pushAutomateBotLog("log", ...args);
  console.log(...args);
}

export function info(...args: unknown[]): void {
  if (!enabled) {
    return;
  }

  pushAutomateBotLog("info", ...args);
  console.info(...args);
}

export function warn(...args: unknown[]): void {
  if (!enabled) {
    return;
  }

  pushAutomateBotLog("warn", ...args);
  console.warn(...args);
}

export function error(...args: unknown[]): void {
  if (!enabled) {
    return;
  }

  pushAutomateBotLog("error", ...args);
  console.error(...args);
}

export function debug(...args: unknown[]): void {
  if (!enabled) {
    return;
  }

  pushAutomateBotLog("debug", ...args);
  console.debug(...args);
}
