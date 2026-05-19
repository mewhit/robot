import * as fs from "fs";
import * as path from "path";
import * as child_process from "child_process";
import { app, BrowserWindow, clipboard, shell } from "electron";
import { AppState } from "./global-state";
import { CHANNELS } from "./ipcChannels";
import { AUTOMATE_BOT_LOGS_DIR } from "./automateBotLogs";

const LOG_REPORT_RECIPIENT_EMAIL = "mikewhittom27@gmail.com";
const WORKSPACE_ROOT = path.resolve(".");
const TEST_IMAGE_DEBUG_DIR = path.resolve("./test-image-debug");
const LOG_REPORT_WINDOW_WIDTH = 820;
const LOG_REPORT_WINDOW_HEIGHT = 620;
const LOG_REPORT_WINDOW_MIN_WIDTH = 620;
const LOG_REPORT_WINDOW_MIN_HEIGHT = 420;
const DEBUG_IMAGE_TIME_PADDING_MS = 2 * 60 * 1000;
const IMAGE_FILE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);

type LogMetadata = {
  sessionId?: string;
  botId?: string;
  versionName?: string;
  runIndex?: string;
  startedAtIso?: string;
  endedAtIso?: string;
};

export type LogReportFile = {
  name: string;
  filePath: string;
  sizeBytes: number;
  modifiedAtIso: string;
  sessionId?: string;
  botId?: string;
  versionName?: string;
  runIndex?: string;
  startedAtIso?: string;
  endedAtIso?: string;
  relatedImageCount: number;
  relatedImageBytes: number;
};

type DebugImageFile = {
  filePath: string;
  relativePath: string;
  sizeBytes: number;
  modifiedTimeMs: number;
};

type ZipEntryInput = {
  archiveName: string;
  filePath?: string;
  data?: Buffer;
  modifiedAt?: Date;
};

type ZipCentralEntry = {
  header: Buffer;
};

type EmailDraftResult = {
  ok: boolean;
  mode: "outlook" | "gmail";
  attachmentPreloaded: boolean;
  warning?: string;
};

let logReportWindow: BrowserWindow | null = null;

function isInsideDirectory(candidatePath: string, directoryPath: string): boolean {
  const relative = path.relative(directoryPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeStatFile(filePath: string): fs.Stats | null {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

function readTextFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function getHeaderValue(text: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^${escapedKey}:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() || undefined;
}

function parseLogMetadata(text: string): LogMetadata {
  return {
    sessionId: getHeaderValue(text, "sessionId"),
    botId: getHeaderValue(text, "botId"),
    versionName: getHeaderValue(text, "versionName"),
    runIndex: getHeaderValue(text, "runIndex"),
    startedAtIso: getHeaderValue(text, "startedAt"),
    endedAtIso: getHeaderValue(text, "endedAt"),
  };
}

function listDebugImageFiles(): DebugImageFile[] {
  if (!fs.existsSync(TEST_IMAGE_DEBUG_DIR)) {
    return [];
  }

  const files: DebugImageFile[] = [];
  const visit = (directoryPath: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }

      if (!entry.isFile() || !IMAGE_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }

      const stats = safeStatFile(entryPath);
      if (!stats) {
        continue;
      }

      files.push({
        filePath: entryPath,
        relativePath: path.relative(TEST_IMAGE_DEBUG_DIR, entryPath).replace(/\\/g, "/"),
        sizeBytes: stats.size,
        modifiedTimeMs: stats.mtimeMs,
      });
    }
  };

  visit(TEST_IMAGE_DEBUG_DIR);
  return files.sort((a, b) => b.modifiedTimeMs - a.modifiedTimeMs);
}

function getReferencedDebugImages(logText: string, debugImagesByPath: Map<string, DebugImageFile>): DebugImageFile[] {
  const debugPathRegex =
    /(?:^|[\s"'`=:(])((?:\.?[\\/])?test-image-debug[\\/][^\r\n"'`<>|?*]+?\.(?:png|jpe?g|webp|bmp))/gi;
  const referenced = new Map<string, DebugImageFile>();
  let match = debugPathRegex.exec(logText);

  while (match) {
    const rawPath = match[1].replace(/\//g, path.sep);
    const normalizedPath = rawPath.startsWith(`.${path.sep}`) ? rawPath.slice(2) : rawPath;
    const absolutePath = path.resolve(WORKSPACE_ROOT, normalizedPath);

    if (isInsideDirectory(absolutePath, TEST_IMAGE_DEBUG_DIR)) {
      const debugImage = debugImagesByPath.get(absolutePath);
      if (debugImage) {
        referenced.set(debugImage.filePath, debugImage);
      }
    }

    match = debugPathRegex.exec(logText);
  }

  return [...referenced.values()];
}

function getDebugImagesInTimeWindow(metadata: LogMetadata, debugImages: DebugImageFile[]): DebugImageFile[] {
  if (!metadata.startedAtIso || !metadata.endedAtIso) {
    return [];
  }

  const startMs = Date.parse(metadata.startedAtIso);
  const endMs = Date.parse(metadata.endedAtIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return [];
  }

  const windowStartMs = startMs - DEBUG_IMAGE_TIME_PADDING_MS;
  const windowEndMs = endMs + DEBUG_IMAGE_TIME_PADDING_MS;
  return debugImages.filter((file) => file.modifiedTimeMs >= windowStartMs && file.modifiedTimeMs <= windowEndMs);
}

function getRelatedDebugImages(
  logText: string,
  metadata: LogMetadata,
  debugImages: DebugImageFile[],
): DebugImageFile[] {
  const debugImagesByPath = new Map(debugImages.map((file) => [file.filePath, file]));
  const related = new Map<string, DebugImageFile>();

  for (const file of getReferencedDebugImages(logText, debugImagesByPath)) {
    related.set(file.filePath, file);
  }

  for (const file of getDebugImagesInTimeWindow(metadata, debugImages)) {
    related.set(file.filePath, file);
  }

  return [...related.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function listLogReportFiles(): LogReportFile[] {
  if (!fs.existsSync(AUTOMATE_BOT_LOGS_DIR)) {
    return [];
  }

  const debugImages = listDebugImageFiles();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(AUTOMATE_BOT_LOGS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".log"))
    .map((entry): LogReportFile | null => {
      const filePath = path.join(AUTOMATE_BOT_LOGS_DIR, entry.name);
      const stats = safeStatFile(filePath);
      if (!stats) {
        return null;
      }

      const logText = readTextFile(filePath);
      const metadata = parseLogMetadata(logText);
      const relatedImages = getRelatedDebugImages(logText, metadata, debugImages);
      return {
        name: entry.name,
        filePath,
        sizeBytes: stats.size,
        modifiedAtIso: stats.mtime.toISOString(),
        sessionId: metadata.sessionId,
        botId: metadata.botId,
        versionName: metadata.versionName,
        runIndex: metadata.runIndex,
        startedAtIso: metadata.startedAtIso,
        endedAtIso: metadata.endedAtIso,
        relatedImageCount: relatedImages.length,
        relatedImageBytes: relatedImages.reduce((total, file) => total + file.sizeBytes, 0),
      };
    })
    .filter((file): file is LogReportFile => file !== null)
    .sort((a, b) => Date.parse(b.modifiedAtIso) - Date.parse(a.modifiedAtIso));
}

function sanitizeFileNameSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);

  return sanitized.length > 0 ? sanitized : "log-report";
}

function formatReportTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes(),
  )}${pad(date.getSeconds())}`;
}

function normalizeArchiveName(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds,
  };
}

function buildLocalFileHeader(params: {
  fileNameBuffer: Buffer;
  modifiedAt: Date;
  crc: number;
  size: number;
}): Buffer {
  const { date, time } = toDosDateTime(params.modifiedAt);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(date, 12);
  header.writeUInt32LE(params.crc, 14);
  header.writeUInt32LE(params.size, 18);
  header.writeUInt32LE(params.size, 22);
  header.writeUInt16LE(params.fileNameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function buildCentralDirectoryHeader(params: {
  fileNameBuffer: Buffer;
  modifiedAt: Date;
  crc: number;
  size: number;
  localHeaderOffset: number;
}): Buffer {
  const { date, time } = toDosDateTime(params.modifiedAt);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(date, 14);
  header.writeUInt32LE(params.crc, 16);
  header.writeUInt32LE(params.size, 20);
  header.writeUInt32LE(params.size, 24);
  header.writeUInt16LE(params.fileNameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(params.localHeaderOffset, 42);
  return header;
}

function buildEndOfCentralDirectory(params: { entryCount: number; centralDirectorySize: number; centralDirectoryOffset: number }): Buffer {
  const header = Buffer.alloc(22);
  header.writeUInt32LE(0x06054b50, 0);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(params.entryCount, 8);
  header.writeUInt16LE(params.entryCount, 10);
  header.writeUInt32LE(params.centralDirectorySize, 12);
  header.writeUInt32LE(params.centralDirectoryOffset, 16);
  header.writeUInt16LE(0, 20);
  return header;
}

function createZipArchive(entries: ZipEntryInput[], targetPath: string): void {
  const outputParts: Buffer[] = [];
  const centralEntries: ZipCentralEntry[] = [];
  let offset = 0;

  for (const entry of entries) {
    const archiveName = normalizeArchiveName(entry.archiveName);
    if (!archiveName) {
      continue;
    }

    const data = entry.data ?? (entry.filePath ? fs.readFileSync(entry.filePath) : Buffer.alloc(0));
    if (data.length > 0xffffffff || offset > 0xffffffff) {
      throw new Error("Log report package is too large for ZIP32.");
    }

    const fileNameBuffer = Buffer.from(archiveName, "utf8");
    const modifiedAt =
      entry.modifiedAt ?? (entry.filePath ? safeStatFile(entry.filePath)?.mtime ?? new Date() : new Date());
    const crc = crc32(data);
    const localHeaderOffset = offset;
    const localHeader = buildLocalFileHeader({
      fileNameBuffer,
      modifiedAt,
      crc,
      size: data.length,
    });

    outputParts.push(localHeader, fileNameBuffer, data);
    offset += localHeader.length + fileNameBuffer.length + data.length;

    const centralHeader = buildCentralDirectoryHeader({
      fileNameBuffer,
      modifiedAt,
      crc,
      size: data.length,
      localHeaderOffset,
    });
    centralEntries.push({
      header: Buffer.concat([centralHeader, fileNameBuffer]),
    });
  }

  const centralDirectoryOffset = offset;
  const centralDirectory = Buffer.concat(centralEntries.map((entry) => entry.header));
  const endOfCentralDirectory = buildEndOfCentralDirectory({
    entryCount: centralEntries.length,
    centralDirectorySize: centralDirectory.length,
    centralDirectoryOffset,
  });

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, Buffer.concat([...outputParts, centralDirectory, endOfCentralDirectory]));
}

function resolveLogPath(logFilePath: string): string {
  const resolvedPath = path.resolve(logFilePath);
  if (!isInsideDirectory(resolvedPath, AUTOMATE_BOT_LOGS_DIR) || path.extname(resolvedPath).toLowerCase() !== ".log") {
    throw new Error("Invalid log file path.");
  }

  const stats = safeStatFile(resolvedPath);
  if (!stats) {
    throw new Error("Log file does not exist.");
  }

  return resolvedPath;
}

function buildReportSummary(params: {
  logPath: string;
  metadata: LogMetadata;
  relatedImages: DebugImageFile[];
  reportPath: string;
  createdAtIso: string;
}): string {
  const lines = [
    "Robot log report",
    `createdAt: ${params.createdAtIso}`,
    `recipient: ${LOG_REPORT_RECIPIENT_EMAIL}`,
    `logFile: ${params.logPath}`,
    `reportFile: ${params.reportPath}`,
    `sessionId: ${params.metadata.sessionId ?? ""}`,
    `botId: ${params.metadata.botId ?? ""}`,
    `versionName: ${params.metadata.versionName ?? ""}`,
    `runIndex: ${params.metadata.runIndex ?? ""}`,
    `startedAt: ${params.metadata.startedAtIso ?? ""}`,
    `endedAt: ${params.metadata.endedAtIso ?? ""}`,
    `relatedDebugImageCount: ${params.relatedImages.length}`,
    "",
    "relatedDebugImages:",
  ];

  if (params.relatedImages.length === 0) {
    lines.push("- none");
  } else {
    for (const image of params.relatedImages) {
      lines.push(`- test-image-debug/${image.relativePath}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function buildEmailDraftContent(params: {
  logPath: string;
  reportPath: string;
  metadata: LogMetadata;
  relatedImageCount: number;
}): { subject: string; body: string } {
  const subject = `Robot log report - ${path.basename(params.logPath)}`;
  const body = [
    "Log report package created.",
    "",
    `Log: ${path.basename(params.logPath)}`,
    `Bot: ${params.metadata.botId ?? "unknown"}`,
    `Started: ${params.metadata.startedAtIso ?? "unknown"}`,
    `Ended: ${params.metadata.endedAtIso ?? "unknown"}`,
    `Related debug images: ${params.relatedImageCount}`,
    "",
    "Attach this ZIP package. The path has been copied to the clipboard:",
    params.reportPath,
  ].join("\n");

  return { subject, body };
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function runPowerShell(command: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = child_process.spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    let isSettled = false;
    const settle = (error?: Error) => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };
    const timer = setTimeout(() => {
      process.kill();
      settle(new Error("Timed out while opening Outlook."));
    }, timeoutMs);

    process.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    process.on("error", (error) => settle(error));
    process.on("close", (code) => {
      if (code === 0) {
        settle();
        return;
      }

      settle(new Error(stderr.trim() || `PowerShell exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function openOutlookDraft(params: {
  reportPath: string;
  subject: string;
  body: string;
}): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("Outlook draft attachment is only supported on Windows.");
  }

  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$outlook = New-Object -ComObject Outlook.Application`,
    "$mail = $outlook.CreateItem(0)",
    `$mail.To = ${quotePowerShellString(LOG_REPORT_RECIPIENT_EMAIL)}`,
    `$mail.Subject = ${quotePowerShellString(params.subject)}`,
    `$mail.Body = ${quotePowerShellString(params.body)}`,
    `$mail.Attachments.Add(${quotePowerShellString(params.reportPath)}) | Out-Null`,
    "$mail.Display() | Out-Null",
  ].join("; ");

  await runPowerShell(command);
}

async function openGmailDraftAndRevealZip(params: {
  reportPath: string;
  subject: string;
  body: string;
}): Promise<void> {
  clipboard.writeText(params.reportPath);
  shell.showItemInFolder(params.reportPath);

  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
    LOG_REPORT_RECIPIENT_EMAIL,
  )}&su=${encodeURIComponent(params.subject)}&body=${encodeURIComponent(params.body)}`;
  await shell.openExternal(gmailUrl);
}

async function openEmailDraft(params: {
  logPath: string;
  reportPath: string;
  metadata: LogMetadata;
  relatedImageCount: number;
}): Promise<EmailDraftResult> {
  clipboard.writeText(params.reportPath);
  const content = buildEmailDraftContent(params);

  try {
    await openOutlookDraft({
      reportPath: params.reportPath,
      subject: content.subject,
      body: content.body,
    });
    return { ok: true, mode: "outlook", attachmentPreloaded: true };
  } catch (error) {
    const outlookMessage = error instanceof Error ? error.message : String(error);
    await openGmailDraftAndRevealZip({
      reportPath: params.reportPath,
      subject: content.subject,
      body: content.body,
    });
    return {
      ok: true,
      mode: "gmail",
      attachmentPreloaded: false,
      warning: `Outlook auto-attach unavailable: ${outlookMessage}`,
    };
  }
}

export async function sendLogReport(logFilePath: string): Promise<{
  ok: boolean;
  error?: string;
  warning?: string;
  reportPath?: string;
  relatedImageCount?: number;
  relatedImageBytes?: number;
  emailDraftOpened?: boolean;
  emailDraftMode?: "outlook" | "gmail";
  attachmentPreloaded?: boolean;
}> {
  try {
    const resolvedLogPath = resolveLogPath(logFilePath);
    const logText = readTextFile(resolvedLogPath);
    const metadata = parseLogMetadata(logText);
    const debugImages = listDebugImageFiles();
    const relatedImages = getRelatedDebugImages(logText, metadata, debugImages);
    const reportDirectory = path.join(app.getPath("userData"), "log-reports");
    const reportBaseName = sanitizeFileNameSegment(path.basename(resolvedLogPath, ".log"));
    const reportPath = path.join(reportDirectory, `${reportBaseName}-${formatReportTimestamp(new Date())}.zip`);
    const createdAtIso = new Date().toISOString();
    const summary = buildReportSummary({
      logPath: resolvedLogPath,
      metadata,
      relatedImages,
      reportPath,
      createdAtIso,
    });

    const entries: ZipEntryInput[] = [
      {
        archiveName: `logs/${path.basename(resolvedLogPath)}`,
        filePath: resolvedLogPath,
      },
      {
        archiveName: "report-summary.txt",
        data: Buffer.from(summary, "utf8"),
        modifiedAt: new Date(createdAtIso),
      },
      ...relatedImages.map((image) => ({
        archiveName: `test-image-debug/${image.relativePath}`,
        filePath: image.filePath,
      })),
    ];

    createZipArchive(entries, reportPath);

    let draftResult: EmailDraftResult = { ok: false, mode: "gmail", attachmentPreloaded: false };
    let warning: string | undefined;
    try {
      draftResult = await openEmailDraft({
        logPath: resolvedLogPath,
        reportPath,
        metadata,
        relatedImageCount: relatedImages.length,
      });
    } catch (error) {
      warning = error instanceof Error ? error.message : String(error);
      draftResult = { ok: false, mode: "gmail", attachmentPreloaded: false };
      clipboard.writeText(reportPath);
    }

    return {
      ok: true,
      reportPath,
      relatedImageCount: relatedImages.length,
      relatedImageBytes: relatedImages.reduce((total, file) => total + file.sizeBytes, 0),
      emailDraftOpened: draftResult.ok,
      emailDraftMode: draftResult.mode,
      attachmentPreloaded: draftResult.attachmentPreloaded,
      warning: warning ?? draftResult.warning,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

function getLogReporterHtml(): string {
  const channelPayload = JSON.stringify({
    getLogReportFiles: CHANNELS.GET_LOG_REPORT_FILES,
    sendLogReport: CHANNELS.SEND_LOG_REPORT,
  });

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Send Log</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Arial, Helvetica, sans-serif;
      background: #f4f6f8;
      color: #172033;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      border-bottom: 1px solid #d7dde5;
      background: #ffffff;
    }

    h1 {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      color: #172033;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    main {
      min-height: 0;
      flex: 1;
      display: grid;
      grid-template-columns: minmax(260px, 0.95fr) minmax(260px, 1.05fr);
      gap: 12px;
      padding: 12px;
    }

    .log-list {
      min-height: 0;
      overflow: auto;
      border: 1px solid #d7dde5;
      background: #ffffff;
    }

    .log-row {
      width: 100%;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 4px;
      padding: 10px 12px;
      border: 0;
      border-bottom: 1px solid #edf0f4;
      background: #ffffff;
      color: #172033;
      text-align: left;
      cursor: pointer;
    }

    .log-row:hover {
      background: #eef6ff;
    }

    .log-row.selected {
      background: #dff0ff;
      box-shadow: inset 3px 0 0 #0b6fb3;
    }

    .log-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      font-weight: 700;
    }

    .log-meta {
      min-width: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      color: #667085;
      font-size: 11px;
      line-height: 1.35;
    }

    .details {
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
      border: 1px solid #d7dde5;
      background: #ffffff;
      padding: 12px;
    }

    .detail-grid {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 7px 12px;
      font-size: 12px;
    }

    .detail-grid dt {
      margin: 0;
      color: #667085;
      font-weight: 700;
    }

    .detail-grid dd {
      margin: 0;
      min-width: 0;
      overflow-wrap: anywhere;
      color: #172033;
    }

    .actions {
      margin-top: auto;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }

    button.command {
      border: 1px solid #0f766e;
      background: #0f766e;
      color: white;
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }

    button.command.secondary {
      border-color: #c8d0da;
      background: #ffffff;
      color: #344054;
    }

    button.command:disabled {
      opacity: 0.55;
      cursor: default;
    }

    .status {
      min-height: 36px;
      padding: 9px 10px;
      border: 1px solid #e5e7eb;
      background: #f8fafc;
      color: #475467;
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .status.error {
      border-color: #fecaca;
      background: #fef2f2;
      color: #991b1b;
    }

    .status.success {
      border-color: #bbf7d0;
      background: #f0fdf4;
      color: #166534;
    }

    .empty {
      padding: 18px;
      color: #667085;
      font-size: 13px;
    }

    @media (max-width: 720px) {
      main {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>Send Log</h1>
    <div class="header-actions">
      <button id="refresh" class="command secondary" type="button">Refresh</button>
      <button class="command" type="button" data-send-log disabled>Send Log</button>
    </div>
  </header>
  <main>
    <section id="logList" class="log-list" aria-label="Log files"></section>
    <section class="details">
      <dl id="details" class="detail-grid"></dl>
      <div id="status" class="status">Select a log to create an email report.</div>
      <div class="actions">
        <button class="command" type="button" data-send-log disabled>Send Selected Log</button>
      </div>
    </section>
  </main>
  <script>
    const { ipcRenderer } = require("electron");
    const CHANNELS = ${channelPayload};
    const state = { logs: [], selectedPath: null, isSending: false };
    const logListEl = document.getElementById("logList");
    const detailsEl = document.getElementById("details");
    const statusEl = document.getElementById("status");
    const refreshButton = document.getElementById("refresh");
    const sendButtons = Array.from(document.querySelectorAll("[data-send-log]"));

    function formatBytes(value) {
      if (!Number.isFinite(value) || value <= 0) {
        return "0 B";
      }
      const units = ["B", "KB", "MB", "GB"];
      let size = value;
      let unitIndex = 0;
      while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
      }
      return unitIndex === 0 ? size + " " + units[unitIndex] : size.toFixed(1) + " " + units[unitIndex];
    }

    function formatDate(value) {
      if (!value) {
        return "-";
      }
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return value;
      }
      return date.toLocaleString();
    }

    function setStatus(text, kind) {
      statusEl.className = "status" + (kind ? " " + kind : "");
      statusEl.textContent = text;
    }

    function getSelectedLog() {
      return state.logs.find((log) => log.filePath === state.selectedPath) || null;
    }

    function renderDetails() {
      const selected = getSelectedLog();
      detailsEl.textContent = "";
      for (const button of sendButtons) {
        button.disabled = state.isSending || !selected;
      }

      if (!selected) {
        const dt = document.createElement("dt");
        dt.textContent = "Log";
        const dd = document.createElement("dd");
        dd.textContent = "-";
        detailsEl.append(dt, dd);
        return;
      }

      const rows = [
        ["File", selected.name],
        ["Modified", formatDate(selected.modifiedAtIso)],
        ["Size", formatBytes(selected.sizeBytes)],
        ["Bot", selected.botId || "-"],
        ["Version", selected.versionName || "-"],
        ["Session", selected.sessionId || "-"],
        ["Started", formatDate(selected.startedAtIso)],
        ["Ended", formatDate(selected.endedAtIso)],
        ["Debug images", selected.relatedImageCount + " (" + formatBytes(selected.relatedImageBytes) + ")"],
        ["Path", selected.filePath],
      ];

      for (const [label, value] of rows) {
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = value;
        detailsEl.append(dt, dd);
      }
    }

    function renderList() {
      logListEl.textContent = "";

      if (state.logs.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "No log files found.";
        logListEl.append(empty);
        return;
      }

      for (const log of state.logs) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "log-row" + (state.selectedPath === log.filePath ? " selected" : "");
        row.addEventListener("click", () => {
          state.selectedPath = log.filePath;
          renderList();
          renderDetails();
          setStatus("Ready to create an email report for " + log.name + ".", "");
        });

        const name = document.createElement("span");
        name.className = "log-name";
        name.textContent = log.name;
        const meta = document.createElement("span");
        meta.className = "log-meta";

        const modified = document.createElement("span");
        modified.textContent = formatDate(log.modifiedAtIso);
        const size = document.createElement("span");
        size.textContent = formatBytes(log.sizeBytes);
        const images = document.createElement("span");
        images.textContent = log.relatedImageCount + " debug image" + (log.relatedImageCount === 1 ? "" : "s");
        meta.append(modified, size, images);

        row.append(name, meta);
        logListEl.append(row);
      }
    }

    async function refreshLogs() {
      setStatus("Loading logs.", "");
      refreshButton.disabled = true;
      try {
        const result = await ipcRenderer.invoke(CHANNELS.getLogReportFiles);
        if (!result || !result.ok) {
          throw new Error((result && result.error) || "Unable to load logs.");
        }
        state.logs = result.files || [];
        if (!state.logs.some((log) => log.filePath === state.selectedPath)) {
          state.selectedPath = state.logs[0] ? state.logs[0].filePath : null;
        }
        renderList();
        renderDetails();
        setStatus(state.logs.length > 0 ? "Logs loaded newest to oldest." : "No log files found.", "");
      } catch (error) {
        renderList();
        renderDetails();
        setStatus(error instanceof Error ? error.message : String(error), "error");
      } finally {
        refreshButton.disabled = false;
      }
    }

    async function sendSelectedLog() {
      const selected = getSelectedLog();
      if (!selected || state.isSending) {
        return;
      }

      state.isSending = true;
      renderDetails();
      setStatus("Creating ZIP package and preparing a local email draft.", "");
      try {
        const result = await ipcRenderer.invoke(CHANNELS.sendLogReport, selected.filePath);
        if (!result || !result.ok) {
          throw new Error((result && result.error) || "Unable to send log report.");
        }

        if (result.attachmentPreloaded) {
          setStatus("Outlook draft opened with the ZIP already attached: " + result.reportPath, "success");
        } else if (result.emailDraftOpened) {
          setStatus(
            "Gmail draft opened. Explorer selected the ZIP; drag it into Gmail to attach it. Path copied: " +
              result.reportPath,
            "success"
          );
        } else {
          const warningText = result.warning ? " " + result.warning : "";
          setStatus("ZIP created and copied to clipboard, but no email draft opened: " + result.reportPath + "." + warningText, "error");
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), "error");
      } finally {
        state.isSending = false;
        renderDetails();
      }
    }

    refreshButton.addEventListener("click", refreshLogs);
    for (const button of sendButtons) {
      button.addEventListener("click", sendSelectedLog);
    }
    refreshLogs();
  </script>
</body>
</html>`;
}

export function openSendLogWindow(): void {
  if (logReportWindow && !logReportWindow.isDestroyed()) {
    logReportWindow.focus();
    return;
  }

  logReportWindow = new BrowserWindow({
    width: LOG_REPORT_WINDOW_WIDTH,
    height: LOG_REPORT_WINDOW_HEIGHT,
    minWidth: LOG_REPORT_WINDOW_MIN_WIDTH,
    minHeight: LOG_REPORT_WINDOW_MIN_HEIGHT,
    parent: AppState.mainWindow ?? undefined,
    title: "Send Log",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  logReportWindow.on("closed", () => {
    logReportWindow = null;
  });

  void logReportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getLogReporterHtml())}`);
}
