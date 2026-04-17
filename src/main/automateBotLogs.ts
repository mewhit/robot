import * as fs from "fs";
import * as path from "path";
import { AppState } from "./global-state";
import { CHANNELS } from "./ipcChannels";

const MAX_AUTOMATE_BOT_LOG_LINES = 500;
const AUTOMATE_BOT_LOGS_DIR = path.resolve("./automate-bot-logs");

const automateBotLogLines: string[] = [];

type BotLogSession = {
  id: string;
  botId: string;
  source: "f2" | "ui" | "bot";
  startedAtIso: string;
};

let currentSession: BotLogSession | null = null;

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

function writeSessionLogFile(session: BotLogSession, stopSource: "f2" | "ui" | "bot", stopReason: string): void {
  try {
    fs.mkdirSync(AUTOMATE_BOT_LOGS_DIR, { recursive: true });

    const fileName = `${session.id}-${session.botId}.log`;
    const filePath = path.join(AUTOMATE_BOT_LOGS_DIR, fileName);
    const endedAtIso = new Date().toISOString();
    const header = [
      `sessionId: ${session.id}`,
      `botId: ${session.botId}`,
      `startSource: ${session.source}`,
      `stopSource: ${stopSource}`,
      `stopReason: ${stopReason}`,
      `startedAt: ${session.startedAtIso}`,
      `endedAt: ${endedAtIso}`,
      "",
    ];

    fs.writeFileSync(filePath, `${header.join("\n")}${automateBotLogLines.join("\n")}\n`, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Could not write automate bot session log: ${message}`);
  }
}

export function startAutomateBotLogSession(botId: string, source: "f2" | "ui" | "bot"): void {
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
  };

  sendAutomateBotLogs();
}

export function stopAutomateBotLogSession(source: "f2" | "ui" | "bot", reason: string = "stopped"): void {
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
