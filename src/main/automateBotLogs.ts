import * as fs from "fs";
import * as path from "path";
import { AppState } from "./global-state";
import { CHANNELS } from "./ipcChannels";

const MAX_AUTOMATE_BOT_LOG_LINES = 5_000;
const AUTOMATE_BOT_LOGS_DIR = path.resolve("./automate-bot-logs");

const automateBotLogLines: string[] = [];

type BotLogSession = {
  id: string;
  botId: string;
  source: "f4" | "ui" | "bot";
  startedAtIso: string;
  versionName?: string;
  runIndex: number;
  startReason: string;
};

export type AutomateBotLogFooterContext = {
  sessionId: string;
  botId: string;
  versionName?: string;
  runIndex: number;
  startSource: "f4" | "ui" | "bot";
  startReason: string;
  stopSource: "f4" | "ui" | "bot";
  stopReason: string;
  startedAtIso: string;
  endedAtIso: string;
};

let currentSession: BotLogSession | null = null;
let currentLogFooterProvider: ((context: AutomateBotLogFooterContext) => string[] | null | undefined) | null = null;

function formatLogArg(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Error) {
    return value.stack || value.message;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildLogLine(level: "log" | "info" | "warn" | "error" | "debug", args: unknown[]): string {
  const timestamp = new Date().toLocaleTimeString("en-GB", { hour12: false });
  const message = args.map((arg) => formatLogArg(arg)).join(" ");
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

function formatSessionId(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function formatRunIndex(runIndex: number): string {
  return String(runIndex).padStart(2, "0");
}

function sanitizeFileSegment(value: string | undefined): string | null {
  const sanitized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized.length > 0 ? sanitized : null;
}

function getSessionFooterLines(context: AutomateBotLogFooterContext): string[] {
  if (!currentLogFooterProvider) {
    return [];
  }

  try {
    return currentLogFooterProvider(context) ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return ["", "Run stats:", `status=unavailable reason=footer-provider-error message=${message}`];
  }
}

function writeSessionLogFile(session: BotLogSession, stopSource: "f4" | "ui" | "bot", stopReason: string): void {
  try {
    fs.mkdirSync(AUTOMATE_BOT_LOGS_DIR, { recursive: true });

    const versionSegment = sanitizeFileSegment(session.versionName);
    const fileName = `${session.id}-${session.botId}${versionSegment ? `-${versionSegment}` : ""}-run-${formatRunIndex(session.runIndex)}.log`;
    const filePath = path.join(AUTOMATE_BOT_LOGS_DIR, fileName);
    const endedAtIso = new Date().toISOString();
    const footerLines = getSessionFooterLines({
      sessionId: session.id,
      botId: session.botId,
      versionName: session.versionName,
      runIndex: session.runIndex,
      startSource: session.source,
      startReason: session.startReason,
      stopSource,
      stopReason,
      startedAtIso: session.startedAtIso,
      endedAtIso,
    });
    const header = [
      `sessionId: ${session.id}`,
      `botId: ${session.botId}`,
      `versionName: ${session.versionName ?? "unversioned"}`,
      `runIndex: ${session.runIndex}`,
      `startSource: ${session.source}`,
      `startReason: ${session.startReason}`,
      `stopSource: ${stopSource}`,
      `stopReason: ${stopReason}`,
      `startedAt: ${session.startedAtIso}`,
      `endedAt: ${endedAtIso}`,
      "",
    ];
    const footer = footerLines.length > 0 ? `\n${footerLines.join("\n")}\n` : "";

    fs.writeFileSync(filePath, `${header.join("\n")}${automateBotLogLines.join("\n")}\n${footer}`, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Could not write automate bot session log: ${message}`);
  }
}

export function setAutomateBotLogFooterProvider(
  provider: ((context: AutomateBotLogFooterContext) => string[] | null | undefined) | null,
): void {
  currentLogFooterProvider = provider;
}

export function startAutomateBotLogSession(
  botId: string,
  source: "f4" | "ui" | "bot",
  versionName?: string,
): void {
  if (currentSession) {
    writeSessionLogFile(currentSession, source, "restarted-before-stop");
  }

  automateBotLogLines.splice(0, automateBotLogLines.length);

  const now = new Date();
  currentSession = {
    id: formatSessionId(now),
    botId,
    source,
    startedAtIso: now.toISOString(),
    versionName,
    runIndex: 1,
    startReason: "bot-started",
  };

  pushAutomateBotLog(
    "info",
    `Automate bot log session started: botId=${botId} versionName=${versionName ?? "unversioned"} runIndex=1 source=${source}.`,
  );
  sendAutomateBotLogs();
}

export function rotateAutomateBotLogSession(reason: string = "run-restarted"): void {
  if (!currentSession) {
    return;
  }

  const previousSession = currentSession;
  writeSessionLogFile(previousSession, "bot", reason);
  automateBotLogLines.splice(0, automateBotLogLines.length);

  const now = new Date();
  currentSession = {
    ...previousSession,
    id: formatSessionId(now),
    startedAtIso: now.toISOString(),
    runIndex: previousSession.runIndex + 1,
    startReason: reason,
  };

  pushAutomateBotLog(
    "info",
    `Automate bot log session rotated: botId=${currentSession.botId} versionName=${currentSession.versionName ?? "unversioned"} runIndex=${currentSession.runIndex} reason=${reason}.`,
  );
  sendAutomateBotLogs();
}

export function stopAutomateBotLogSession(source: "f4" | "ui" | "bot", reason: string = "stopped"): void {
  if (!currentSession) {
    return;
  }

  writeSessionLogFile(currentSession, source, reason);
  currentSession = null;
}

export function pushAutomateBotLog(level: "log" | "info" | "warn" | "error" | "debug", ...args: unknown[]): void {
  if (!currentSession) {
    return;
  }

  const line = buildLogLine(level, args);
  automateBotLogLines.push(line);

  if (automateBotLogLines.length > MAX_AUTOMATE_BOT_LOG_LINES) {
    automateBotLogLines.splice(0, automateBotLogLines.length - MAX_AUTOMATE_BOT_LOG_LINES);
  }

  AppState.mainWindow?.webContents.send(CHANNELS.AUTOMATE_BOT_LOG, line);
}

export function sendAutomateBotLogs(): void {
  AppState.mainWindow?.webContents.send(CHANNELS.AUTOMATE_BOT_LOGS_STATE, [...automateBotLogLines]);
}
