import * as fs from "fs";
import * as child_process from "child_process";
import * as path from "path";
import { app, BrowserWindow, Menu, dialog, ipcMain, screen } from "electron";
import { uIOhook, UiohookKey } from "uiohook-napi";
import * as robotModule from "robotjs";

type RobotApi = {
  getMousePos: () => { x: number; y: number };
  moveMouse: (x: number, y: number) => void;
  mouseClick: (button?: "left" | "right" | "middle", double?: boolean) => void;
  keyTap: (key: string, modifier?: string | string[]) => void;
  keyToggle?: (key: string, downOrUp: "down" | "up") => void;
};

const robot = ((robotModule as unknown as { default?: RobotApi }).default ?? robotModule) as unknown as RobotApi;

const UIOHOOK_KEY_TO_ROBOTJS: Record<number, string> = {
  // Letters
  [UiohookKey.A]: "a",
  [UiohookKey.B]: "b",
  [UiohookKey.C]: "c",
  [UiohookKey.D]: "d",
  [UiohookKey.E]: "e",
  [UiohookKey.F]: "f",
  [UiohookKey.G]: "g",
  [UiohookKey.H]: "h",
  [UiohookKey.I]: "i",
  [UiohookKey.J]: "j",
  [UiohookKey.K]: "k",
  [UiohookKey.L]: "l",
  [UiohookKey.M]: "m",
  [UiohookKey.N]: "n",
  [UiohookKey.O]: "o",
  [UiohookKey.P]: "p",
  [UiohookKey.Q]: "q",
  [UiohookKey.R]: "r",
  [UiohookKey.S]: "s",
  [UiohookKey.T]: "t",
  [UiohookKey.U]: "u",
  [UiohookKey.V]: "v",
  [UiohookKey.W]: "w",
  [UiohookKey.X]: "x",
  [UiohookKey.Y]: "y",
  [UiohookKey.Z]: "z",
  // Digits
  11: "0",
  2: "1",
  3: "2",
  4: "3",
  5: "4",
  6: "5",
  7: "6",
  8: "7",
  9: "8",
  10: "9",
  // Numpad
  [UiohookKey.Numpad0]: "numpad_0",
  [UiohookKey.Numpad1]: "numpad_1",
  [UiohookKey.Numpad2]: "numpad_2",
  [UiohookKey.Numpad3]: "numpad_3",
  [UiohookKey.Numpad4]: "numpad_4",
  [UiohookKey.Numpad5]: "numpad_5",
  [UiohookKey.Numpad6]: "numpad_6",
  [UiohookKey.Numpad7]: "numpad_7",
  [UiohookKey.Numpad8]: "numpad_8",
  [UiohookKey.Numpad9]: "numpad_9",
  [UiohookKey.NumpadMultiply]: "multiply",
  [UiohookKey.NumpadAdd]: "add",
  [UiohookKey.NumpadSubtract]: "subtract",
  [UiohookKey.NumpadDecimal]: "decimal",
  [UiohookKey.NumpadDivide]: "divide",
  // Special keys
  [UiohookKey.Enter]: "enter",
  [UiohookKey.Backspace]: "backspace",
  [UiohookKey.Tab]: "tab",
  [UiohookKey.Escape]: "escape",
  [UiohookKey.Space]: "space",
  [UiohookKey.Delete]: "delete",
  [UiohookKey.Insert]: "insert",
  [UiohookKey.Home]: "home",
  [UiohookKey.End]: "end",
  [UiohookKey.PageUp]: "pageup",
  [UiohookKey.PageDown]: "pagedown",
  [UiohookKey.ArrowLeft]: "left",
  [UiohookKey.ArrowRight]: "right",
  [UiohookKey.ArrowUp]: "up",
  [UiohookKey.ArrowDown]: "down",
  // Function keys
  [UiohookKey.F1]: "f1",
  [UiohookKey.F2]: "f2",
  [UiohookKey.F3]: "f3",
  [UiohookKey.F4]: "f4",
  [UiohookKey.F5]: "f5",
  [UiohookKey.F6]: "f6",
  [UiohookKey.F7]: "f7",
  [UiohookKey.F8]: "f8",
  [UiohookKey.F9]: "f9",
  [UiohookKey.F10]: "f10",
  [UiohookKey.F11]: "f11",
  [UiohookKey.F12]: "f12",
  // Punctuation
  [UiohookKey.Semicolon]: "semicolon",
  [UiohookKey.Equal]: "equal",
  [UiohookKey.Comma]: "comma",
  [UiohookKey.Minus]: "minus",
  [UiohookKey.Period]: "period",
  [UiohookKey.Slash]: "slash",
  [UiohookKey.Backquote]: "grave",
  [UiohookKey.BracketLeft]: "left_bracket",
  [UiohookKey.Backslash]: "backslash",
  [UiohookKey.BracketRight]: "right_bracket",
  [UiohookKey.Quote]: "quote",
};

const LEGACY_REPLAY_KEY_ALIASES: Record<string, string> = {
  ".": "period",
  ",": "comma",
  "-": "minus",
  "=": "equal",
  "/": "slash",
  "\\": "backslash",
  ";": "semicolon",
  "`": "grave",
  "[": "left_bracket",
  "]": "right_bracket",
  "'": "quote",
};

const MODIFIER_KEYCODES = new Set<number>([
  UiohookKey.Ctrl,
  UiohookKey.CtrlRight,
  UiohookKey.Alt,
  UiohookKey.AltRight,
  UiohookKey.Shift,
  UiohookKey.ShiftRight,
  UiohookKey.Meta,
  UiohookKey.MetaRight,
]);

const activeModifiers = new Set<string>();

const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), "saved-clicks");
const DEFAULT_OUTPUT_FILE_NAME = "clicks.csv";
const LEGACY_CSV_HEADER = "action,click_position,elapsed_seconds,radius";
const CSV_HEADER_WITH_ELAPSED_RANGE = "action,click_position,elapsed_seconds,radius,elapsed_range";
const CSV_HEADER_WITH_RANGES = "action,click_position,elapsed_seconds,radius,elapsed_range,x_min,x_max,y_min,y_max,elapsed_min,elapsed_max";
const DEFAULT_ELAPSED_RANGE = "none";
const DEFAULT_RANGE_NONE = "";
const DEFAULT_CLICK_RADIUS = 10;
const REPLAY_KEY_PRESS_MS = 60;
let recording = false;
let replaying = false;
let replayStopRequested = false;
let replayRepeatEnabled = false;
let replayExtraDelayMs = 0;
let currentReplayRowIndex: number | null = null;
let lastClickTime: number | null = null;
let overlayProcess: child_process.ChildProcess | null = null;
let overlayProcessPid: number | null = null;
let mainWindow: BrowserWindow | null = null;
let outputFolderPath = DEFAULT_OUTPUT_DIR;
let outputFilePath = path.join(outputFolderPath, DEFAULT_OUTPUT_FILE_NAME);
const OVERLAY_SOURCE_FILE = ".overlay-window.cs";
const OVERLAY_EXE_FILE = ".overlay-window.exe";
const REPLAY_FOCUS_DELAY_MS = 600;

type ExplorerNode = {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  children?: ExplorerNode[];
};

type CsvRow = {
  index: number;
  action: string;
  stepName: string;
  x: number;
  y: number;
  elapsedSeconds: number;
  radius: number;
  elapsedRange: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  elapsedMin: number | null;
  elapsedMax: number | null;
  percentageX: number;
  percentageY: number;
  rangeX: {
    min: number;
    max: number;
  };
  rangeY: {
    min: number;
    max: number;
  };
};

type VirtualBounds = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

const OVERLAY_CS = `
using System;
using System.Drawing;
using System.Windows.Forms;

public class OverlayForm : Form
{
  public OverlayForm()
  {
    FormBorderStyle = FormBorderStyle.None;
    ShowInTaskbar = false;
    TopMost = true;
    StartPosition = FormStartPosition.Manual;
    Bounds = SystemInformation.VirtualScreen;
    BackColor = Color.Lime;
    TransparencyKey = Color.Lime;
    DoubleBuffered = true;
  }

  protected override bool ShowWithoutActivation
  {
    get { return true; }
  }

  protected override CreateParams CreateParams
  {
    get
    {
      const int WS_EX_TRANSPARENT = 0x20;
      const int WS_EX_TOOLWINDOW = 0x80;
      const int WS_EX_NOACTIVATE = 0x08000000;
      var cp = base.CreateParams;
      cp.ExStyle |= WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
      return cp;
    }
  }

  protected override void OnPaint(PaintEventArgs e)
  {
    base.OnPaint(e);
    using (var pen = new Pen(Color.Red, 10))
    {
      const int inset = 5;
      e.Graphics.DrawRectangle(pen, inset, inset, Width - (inset * 2), Height - (inset * 2));
    }
  }
}

public static class Program
{
  [STAThread]
  public static void Main()
  {
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    Application.Run(new OverlayForm());
  }
}
`;

const CSC_CANDIDATES = [
  "csc.exe",
  "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
  "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe",
];

function ensureOverlayExecutable(): string {
  const sourcePath = path.resolve(process.cwd(), OVERLAY_SOURCE_FILE);
  const exePath = path.resolve(process.cwd(), OVERLAY_EXE_FILE);

  if (fs.existsSync(exePath)) {
    return exePath;
  }

  fs.writeFileSync(sourcePath, OVERLAY_CS, "utf8");

  const compilerArgs = ["/nologo", "/target:winexe", "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", `/out:${exePath}`, sourcePath];

  for (const csc of CSC_CANDIDATES) {
    try {
      const result = child_process.spawnSync(csc, compilerArgs, { stdio: "ignore" });
      if (result.status === 0 && fs.existsSync(exePath)) {
        return exePath;
      }
    } catch {
      // Try next compiler candidate.
    }
  }

  throw new Error("Unable to compile overlay executable. Could not find a working csc.exe.");
}

function showOverlay() {
  if (overlayProcess) return;

  try {
    const exePath = ensureOverlayExecutable();
    overlayProcess = child_process.spawn(exePath, [], {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });

    overlayProcessPid = overlayProcess.pid ?? null;
    overlayProcess.once("exit", () => {
      overlayProcess = null;
      overlayProcessPid = null;
    });

    overlayProcess.unref();
  } catch (err) {
    recording = false;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Could not show overlay: ${message}`);
  }
}

function killOverlayProcessByPid(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  if (process.platform === "win32") {
    // /T ensures any child process tree is also terminated.
    child_process.spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Ignore if process already exited.
  }
}

function hideOverlay() {
  const pid = overlayProcessPid ?? overlayProcess?.pid ?? null;
  if (pid !== null) {
    killOverlayProcessByPid(pid);
  }

  overlayProcess = null;
  overlayProcessPid = null;
}

function ensureOutputFolder() {
  fs.mkdirSync(outputFolderPath, { recursive: true });
}

function toCsvFileName(fileName: string): string {
  return /\.csv$/i.test(fileName) ? fileName : `${fileName}.csv`;
}

function ensureCsvFileInitialized(filePath: string) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "", "utf8");
    return;
  }

  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    fs.writeFileSync(filePath, "", "utf8");
  }
}

function normalizeRelativePath(relativePath: string): string {
  return path.normalize(relativePath).replace(/^([\\/])+/, "");
}

function resolveInsideOutputFolder(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  const resolved = path.resolve(outputFolderPath, normalized);
  const root = path.resolve(outputFolderPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Path escapes output folder");
  }
  return resolved;
}

function buildExplorerTree(rootDir: string, baseRelative = ""): ExplorerNode[] {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const nodes: ExplorerNode[] = [];

  for (const entry of entries) {
    const relativePath = baseRelative ? path.join(baseRelative, entry.name) : entry.name;
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        relativePath,
        isDirectory: true,
        children: buildExplorerTree(path.join(rootDir, entry.name), relativePath),
      });
    } else {
      nodes.push({
        name: entry.name,
        relativePath,
        isDirectory: false,
      });
    }
  }

  return nodes.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
}

function listOutputFolderFiles(): string[] {
  const tree = buildExplorerTree(outputFolderPath);
  const fileNames: string[] = [];

  const walk = (nodes: ExplorerNode[]) => {
    for (const node of nodes) {
      if (node.isDirectory) {
        walk(node.children ?? []);
      } else {
        fileNames.push(node.relativePath);
      }
    }
  };

  walk(tree);
  return fileNames;
}

function sendRecordingState() {
  mainWindow?.webContents.send("recording-state", recording);
}

function sendReplayState() {
  mainWindow?.webContents.send("replaying-state", replaying);
}

function sendReplayRepeatState() {
  mainWindow?.webContents.send("replay-repeat-state", replayRepeatEnabled);
}

function sendReplayDelayState() {
  mainWindow?.webContents.send("replay-delay-state", replayExtraDelayMs);
}

function sendReplayRowState() {
  mainWindow?.webContents.send("replay-row-state", currentReplayRowIndex);
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function easeInOutQuad(progress: number): number {
  if (progress < 0.5) {
    return 2 * progress * progress;
  }

  return 1 - Math.pow(-2 * progress + 2, 2) / 2;
}

async function moveMouseWithElapsedDuration(targetX: number, targetY: number, durationMs: number) {
  const clampedDurationMs = Math.max(0, durationMs);
  if (clampedDurationMs <= 0) {
    robot.moveMouse(targetX, targetY);
    return;
  }

  const start = robot.getMousePos();
  const deltaX = targetX - start.x;
  const deltaY = targetY - start.y;
  const startedAt = Date.now();

  while (true) {
    if (replayStopRequested) {
      return;
    }

    const elapsedMs = Date.now() - startedAt;
    const progress = Math.min(1, elapsedMs / clampedDurationMs);
    const easedProgress = easeInOutQuad(progress);
    const nextX = Math.round(start.x + deltaX * easedProgress);
    const nextY = Math.round(start.y + deltaY * easedProgress);
    robot.moveMouse(nextX, nextY);

    if (progress >= 1) {
      return;
    }

    const remainingMs = clampedDurationMs - elapsedMs;
    await wait(Math.max(1, Math.min(16, remainingMs)));
  }
}

function requestReplayStop(source: "f2" | "ui") {
  if (!replaying) {
    return;
  }

  replayStopRequested = true;
  console.log(`Replay stop requested via ${source.toUpperCase()}.`);
}

function normalizeReplayKey(rawKey: string): string {
  const key = rawKey.trim().toLowerCase();

  if (key === "esc") return "escape";

  return LEGACY_REPLAY_KEY_ALIASES[key] ?? key;
}

async function pressReplayKey(key: string, modifiers: string[]) {
  if (modifiers.length > 0) {
    robot.keyTap(key, modifiers);
    return;
  }

  if (typeof robot.keyToggle === "function") {
    robot.keyToggle(key, "down");
    await wait(REPLAY_KEY_PRESS_MS);
    robot.keyToggle(key, "up");
    return;
  }

  robot.keyTap(key);
}

function getReplayDelaySeconds(row: CsvRow): number {
  const baseDelay = Math.max(0, row.elapsedSeconds);
  const hasMin = row.elapsedMin !== null && Number.isFinite(row.elapsedMin);
  const hasMax = row.elapsedMax !== null && Number.isFinite(row.elapsedMax);

  let resolvedDelay = baseDelay;

  if (hasMin || hasMax) {
    const rawMin = hasMin ? Math.max(0, row.elapsedMin as number) : baseDelay;
    const rawMax = hasMax ? Math.max(0, row.elapsedMax as number) : rawMin;
    const minDelay = Math.min(rawMin, rawMax);
    const maxDelay = Math.max(rawMin, rawMax);
    const mode = row.elapsedRange.trim().toLowerCase();

    if (mode === "min") {
      resolvedDelay = minDelay;
    } else if (mode === "max") {
      resolvedDelay = maxDelay;
    } else if (mode === "exact" || mode === "base") {
      resolvedDelay = Math.min(maxDelay, Math.max(minDelay, baseDelay));
    } else {
      resolvedDelay = minDelay + Math.random() * (maxDelay - minDelay);
    }
  }

  const extraDelaySeconds = Math.max(0, replayExtraDelayMs) / 1000;
  if (extraDelaySeconds <= 0) {
    return resolvedDelay;
  }

  return resolvedDelay + Math.random() * extraDelaySeconds;
}

function getRandomNumberInRange(min: number, max: number): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return low + Math.random() * (high - low);
}

function getReplayTargetPoint(row: CsvRow): { x: number; y: number } {
  const x = Number.isFinite(row.xMin) && Number.isFinite(row.xMax) ? getRandomNumberInRange(row.xMin, row.xMax) : row.x;
  const y = Number.isFinite(row.yMin) && Number.isFinite(row.yMax) ? getRandomNumberInRange(row.yMin, row.yMax) : row.y;

  return {
    x: Math.round(x),
    y: Math.round(y),
  };
}

async function replayActiveCsv(options?: { fromUi?: boolean }) {
  if (replaying) {
    throw new Error("Replay is already running");
  }

  if (recording) {
    throw new Error("Stop recording before replaying");
  }

  const rows = readActiveFileRows();
  if (rows.length === 0) {
    throw new Error("Active CSV has no replayable rows");
  }

  replayStopRequested = false;
  replaying = true;
  currentReplayRowIndex = null;
  sendReplayState();
  sendReplayRowState();

  if (options?.fromUi && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
    await wait(REPLAY_FOCUS_DELAY_MS);
  }

  console.log(`Replay started: ${outputFilePath} (${rows.length} rows)`);

  try {
    while (!replayStopRequested) {
      for (const row of rows) {
        if (replayStopRequested) {
          console.log("Replay stopped.");
          break;
        }

        currentReplayRowIndex = row.index;
        sendReplayRowState();

        const delayMs = Math.max(0, getReplayDelaySeconds(row) * 1000);

        if (row.action.startsWith("Key:")) {
          await wait(delayMs);

          if (replayStopRequested) {
            console.log("Replay stopped.");
            break;
          }

          const keySpec = row.action.slice(4);
          const parts = keySpec.split("+");
          const key = normalizeReplayKey(parts[parts.length - 1]);
          const modifiers = parts.slice(0, parts.length - 1).map((mod) => (mod === "ctrl" ? "control" : mod === "meta" ? "command" : mod));
          try {
            await pressReplayKey(key, modifiers);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Skipping unsupported replay key \"${key}\": ${message}`);
          }
        } else {
          const targetPoint = getReplayTargetPoint(row);
          await moveMouseWithElapsedDuration(targetPoint.x, targetPoint.y, delayMs);

          if (replayStopRequested) {
            console.log("Replay stopped.");
            break;
          }

          if (row.action === "LClick") {
            robot.mouseClick("left");
          } else if (row.action === "RClick") {
            robot.mouseClick("right");
          }
        }
      }

      if (!replayRepeatEnabled || replayStopRequested) {
        break;
      }

      console.log("Replay cycle complete, restarting because repeat is enabled.");
    }

    if (!replayStopRequested) {
      console.log("Replay completed.");
    }
  } finally {
    replaying = false;
    replayStopRequested = false;
    currentReplayRowIndex = null;
    sendReplayState();
    sendReplayRowState();
  }
}

function parseFirstCsvColumn(line: string): string {
  if (line.length === 0) return "";

  if (line[0] !== '"') {
    const commaIndex = line.indexOf(",");
    return (commaIndex === -1 ? line : line.slice(0, commaIndex)).trim();
  }

  let value = "";
  for (let i = 1; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (line[i + 1] === '"') {
        value += '"';
        i += 1;
        continue;
      }
      break;
    }
    value += char;
  }

  return value.trim();
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current.trim());
  return fields;
}

function parseClickPosition(raw: string): { x: number; y: number } | null {
  const match = raw.match(/^\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/);
  if (!match) return null;

  const x = Number(match[1]);
  const y = Number(match[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return { x, y };
}

function getVirtualBounds(): VirtualBounds {
  const displays = screen.getAllDisplays();

  if (displays.length === 0) {
    const primary = screen.getPrimaryDisplay().bounds;
    return {
      minX: primary.x,
      minY: primary.y,
      width: Math.max(primary.width, 1),
      height: Math.max(primary.height, 1),
    };
  }

  const minX = Math.min(...displays.map((display) => display.bounds.x));
  const minY = Math.min(...displays.map((display) => display.bounds.y));
  const maxX = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width));
  const maxY = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height));

  return {
    minX,
    minY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
  };
}

function toPercentage(value: number, min: number, span: number): number {
  return Number((((value - min) / span) * 100).toFixed(2));
}

function clampPercent(value: number): number {
  return Number(Math.min(100, Math.max(0, value)).toFixed(2));
}

function isCsvHeaderLine(line: string): boolean {
  return line === LEGACY_CSV_HEADER || line === CSV_HEADER_WITH_ELAPSED_RANGE || line === CSV_HEADER_WITH_RANGES;
}

function normalizeElapsedRange(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_ELAPSED_RANGE;
}

function parseOptionalNumber(raw: string | undefined): number | null {
  const trimmed = (raw ?? "").trim().toLowerCase();
  if (!trimmed || trimmed === "none") {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumberForCsv(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Number(value.toFixed(3)));
}

function escapeCsvField(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function formatOptionalNumberForCsv(value: number | null): string {
  return value === null ? DEFAULT_RANGE_NONE : formatNumberForCsv(value);
}

function formatCsvRow(row: {
  action: string;
  stepName: string;
  x: number;
  y: number;
  elapsedSeconds: number;
  radius: number;
  elapsedRange: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  elapsedMin: number | null;
  elapsedMax: number | null;
}): string {
  const position = `(${row.x}, ${row.y})`;
  const elapsedSeconds = Number(row.elapsedSeconds.toFixed(3)).toFixed(3);
  return [
    escapeCsvField(row.action),
    escapeCsvField(position),
    elapsedSeconds,
    formatNumberForCsv(row.radius),
    escapeCsvField(normalizeElapsedRange(row.elapsedRange)),
    formatNumberForCsv(row.xMin),
    formatNumberForCsv(row.xMax),
    formatNumberForCsv(row.yMin),
    formatNumberForCsv(row.yMax),
    formatOptionalNumberForCsv(row.elapsedMin),
    formatOptionalNumberForCsv(row.elapsedMax),
    escapeCsvField(row.stepName || row.action),
  ].join(",");
}

function listDataLineIndexes(content: string): number[] {
  return content
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((entry) => entry.line.length > 0 && !isCsvHeaderLine(entry.line))
    .map((entry) => entry.index);
}

function readActiveFileRows(): CsvRow[] {
  try {
    if (!fs.existsSync(outputFilePath) || fs.statSync(outputFilePath).isDirectory()) {
      return [];
    }

    const bounds = getVirtualBounds();
    const content = fs.readFileSync(outputFilePath, "utf8");
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !isCsvHeaderLine(line));

    return lines
      .map((line, index) => {
        const fields = splitCsvLine(line);
        if (fields.length < 4) {
          return null;
        }

        const action = fields[0] || parseFirstCsvColumn(line);
        const position = parseClickPosition(fields[1]);
        const elapsedSeconds = Number(fields[2]);
        const radius = Number(fields[3]);
        const elapsedRange = normalizeElapsedRange(fields[4]);
        const stepName = (fields[11] ?? "").trim() || action;

        if (!position || !Number.isFinite(elapsedSeconds) || !Number.isFinite(radius)) {
          return null;
        }

        const xMin = Number.isFinite(Number(fields[5])) ? Number(fields[5]) : position.x - radius;
        const xMax = Number.isFinite(Number(fields[6])) ? Number(fields[6]) : position.x + radius;
        const yMin = Number.isFinite(Number(fields[7])) ? Number(fields[7]) : position.y - radius;
        const yMax = Number.isFinite(Number(fields[8])) ? Number(fields[8]) : position.y + radius;
        const elapsedMin = parseOptionalNumber(fields[9]);
        const elapsedMax = parseOptionalNumber(fields[10]);

        const percentageX = toPercentage(position.x, bounds.minX, bounds.width);
        const percentageY = toPercentage(position.y, bounds.minY, bounds.height);
        const minXPercent = clampPercent(toPercentage(xMin, bounds.minX, bounds.width));
        const maxXPercent = clampPercent(toPercentage(xMax, bounds.minX, bounds.width));
        const minYPercent = clampPercent(toPercentage(yMin, bounds.minY, bounds.height));
        const maxYPercent = clampPercent(toPercentage(yMax, bounds.minY, bounds.height));

        return {
          index,
          action,
          stepName,
          x: position.x,
          y: position.y,
          elapsedSeconds,
          radius,
          elapsedRange,
          xMin,
          xMax,
          yMin,
          yMax,
          elapsedMin,
          elapsedMax,
          percentageX,
          percentageY,
          rangeX: {
            min: Math.min(minXPercent, maxXPercent),
            max: Math.max(minXPercent, maxXPercent),
          },
          rangeY: {
            min: Math.min(minYPercent, maxYPercent),
            max: Math.max(minYPercent, maxYPercent),
          },
        } satisfies CsvRow;
      })
      .filter((row): row is CsvRow => row !== null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Could not read active file rows: ${message}`);
    return [];
  }
}

function sendOutputFolderState() {
  ensureOutputFolder();
  const tree = buildExplorerTree(outputFolderPath);
  const activeFileRows = readActiveFileRows();
  mainWindow?.webContents.send("output-folder-state", {
    folderPath: outputFolderPath,
    activeFile: path.basename(outputFilePath),
    activeRelativePath: path.relative(outputFolderPath, outputFilePath),
    activeFileLines: activeFileRows.map((row) => row.stepName),
    activeFileRows,
    files: listOutputFolderFiles(),
    tree,
  });
}

function createNewOutputFile() {
  ensureOutputFolder();
  const existingFiles = listOutputFolderFiles();

  if (existingFiles.length > 0) {
    const existingCsv = existingFiles.find((file) => /\.csv$/i.test(file));
    const selectedExisting = existingCsv ?? existingFiles[0];
    outputFilePath = resolveInsideOutputFolder(selectedExisting);
    console.log(`Using existing output file: ${outputFilePath}`);
    sendOutputFolderState();
    return;
  }

  outputFilePath = path.join(outputFolderPath, DEFAULT_OUTPUT_FILE_NAME);
  ensureCsvFileInitialized(outputFilePath);
  console.log(`Created new output file: ${outputFilePath}`);
  sendOutputFolderState();
}

function createFileInOutputFolder(fileName: string) {
  ensureOutputFolder();
  const trimmed = fileName.trim();
  if (!trimmed) {
    throw new Error("File name is required");
  }

  const cleanName = toCsvFileName(path.basename(trimmed));
  const targetPath = path.join(outputFolderPath, cleanName);

  if (fs.existsSync(targetPath)) {
    throw new Error("File already exists");
  }

  fs.writeFileSync(targetPath, "", "utf8");
  outputFilePath = targetPath;
  console.log(`Created file: ${targetPath}`);
  sendOutputFolderState();
}

function updateActiveCsvRow(payload: {
  rowIndex: number;
  action: string;
  stepName?: string;
  x: number;
  y: number;
  elapsedSeconds: number;
  radius: number;
  elapsedRange?: string;
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  elapsedMin?: number | null;
  elapsedMax?: number | null;
}) {
  if (!Number.isInteger(payload.rowIndex) || payload.rowIndex < 0) {
    throw new Error("Invalid row index");
  }

  const action = payload.action.trim();
  if (!action) {
    throw new Error("Action is required");
  }
  const stepName = (payload.stepName ?? "").trim() || action;

  const x = Number(payload.x);
  const y = Number(payload.y);
  const elapsedSeconds = Number(payload.elapsedSeconds);
  const radius = Number(payload.radius);
  const xMin = Number(payload.xMin);
  const xMax = Number(payload.xMax);
  const yMin = Number(payload.yMin);
  const yMax = Number(payload.yMax);
  const elapsedMin = payload.elapsedMin ?? null;
  const elapsedMax = payload.elapsedMax ?? null;

  if (![x, y, elapsedSeconds, radius, xMin, xMax, yMin, yMax].every((value) => Number.isFinite(value))) {
    throw new Error("Invalid numeric values");
  }

  if (elapsedMin !== null && !Number.isFinite(Number(elapsedMin))) {
    throw new Error("Elapsed min must be numeric or none");
  }

  if (elapsedMax !== null && !Number.isFinite(Number(elapsedMax))) {
    throw new Error("Elapsed max must be numeric or none");
  }

  if (elapsedSeconds < 0) {
    throw new Error("Elapsed seconds must be >= 0");
  }

  if (radius < 0) {
    throw new Error("Radius must be >= 0");
  }

  if (!fs.existsSync(outputFilePath) || fs.statSync(outputFilePath).isDirectory()) {
    throw new Error("Active file not found");
  }

  const content = fs.readFileSync(outputFilePath, "utf8");
  const lines = content.split(/\r?\n/);
  const dataLineIndexes = listDataLineIndexes(content);

  if (payload.rowIndex >= dataLineIndexes.length) {
    throw new Error("Row index out of range");
  }

  lines[dataLineIndexes[payload.rowIndex]] = formatCsvRow({
    action,
    stepName,
    x,
    y,
    elapsedSeconds,
    radius,
    elapsedRange: payload.elapsedRange ?? DEFAULT_ELAPSED_RANGE,
    xMin,
    xMax,
    yMin,
    yMax,
    elapsedMin: elapsedMin === null ? null : Number(elapsedMin),
    elapsedMax: elapsedMax === null ? null : Number(elapsedMax),
  });

  fs.writeFileSync(outputFilePath, lines.join("\n"), "utf8");
  sendOutputFolderState();
}

function renameActiveCsvRowStep(rowIndex: number, nextStepName: string) {
  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    throw new Error("Invalid row index");
  }

  const stepName = nextStepName.trim();
  if (!stepName) {
    throw new Error("Step name is required");
  }

  const rows = readActiveFileRows();
  if (rowIndex >= rows.length) {
    throw new Error("Row index out of range");
  }

  const row = rows[rowIndex];
  updateActiveCsvRow({
    rowIndex,
    action: row.action,
    stepName,
    x: row.x,
    y: row.y,
    elapsedSeconds: row.elapsedSeconds,
    radius: row.radius,
    elapsedRange: row.elapsedRange,
    xMin: row.xMin,
    xMax: row.xMax,
    yMin: row.yMin,
    yMax: row.yMax,
    elapsedMin: row.elapsedMin,
    elapsedMax: row.elapsedMax,
  });
}

function deleteActiveCsvRow(rowIndex: number) {
  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    throw new Error("Invalid row index");
  }

  if (!fs.existsSync(outputFilePath) || fs.statSync(outputFilePath).isDirectory()) {
    throw new Error("Active file not found");
  }

  const content = fs.readFileSync(outputFilePath, "utf8");
  const lines = content.split(/\r?\n/);
  const dataLineIndexes = listDataLineIndexes(content);

  if (rowIndex >= dataLineIndexes.length) {
    throw new Error("Row index out of range");
  }

  lines.splice(dataLineIndexes[rowIndex], 1);
  fs.writeFileSync(outputFilePath, lines.join("\n"), "utf8");
  sendOutputFolderState();
}

function renameFileInOutputFolder(relativePath: string, newName: string) {
  const currentPath = resolveInsideOutputFolder(relativePath);
  if (!fs.existsSync(currentPath) || fs.statSync(currentPath).isDirectory()) {
    throw new Error("File does not exist");
  }

  const cleanNewName = toCsvFileName(path.basename(newName.trim()));
  if (!cleanNewName) {
    throw new Error("New name is required");
  }

  const targetPath = path.join(path.dirname(currentPath), cleanNewName);
  if (fs.existsSync(targetPath)) {
    throw new Error("Target file already exists");
  }

  fs.renameSync(currentPath, targetPath);

  if (outputFilePath === currentPath) {
    outputFilePath = targetPath;
  }

  console.log(`Renamed file: ${currentPath} -> ${targetPath}`);
  sendOutputFolderState();
}

function setActiveFileFromRelativePath(relativePath: string) {
  const resolved = resolveInsideOutputFolder(relativePath);
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    throw new Error("Selected file does not exist");
  }

  outputFilePath = resolved;
  sendOutputFolderState();
}

async function loadOutputFile() {
  const selected = await dialog.showOpenDialog({
    title: "Load Click File",
    properties: ["openFile"],
    filters: [
      { name: "CSV Files", extensions: ["csv"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (selected.canceled || selected.filePaths.length === 0) {
    return;
  }

  outputFilePath = selected.filePaths[0];
  outputFolderPath = path.dirname(outputFilePath);
  ensureCsvFileInitialized(outputFilePath);

  console.log(`Loaded output file: ${outputFilePath}`);
  sendOutputFolderState();
}

async function chooseOutputFolder() {
  const selected = await dialog.showOpenDialog({
    title: "Select Output Folder",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: outputFolderPath,
  });

  if (selected.canceled || selected.filePaths.length === 0) {
    return;
  }

  outputFolderPath = selected.filePaths[0];
  ensureOutputFolder();

  if (path.dirname(outputFilePath) !== outputFolderPath) {
    outputFilePath = path.join(outputFolderPath, DEFAULT_OUTPUT_FILE_NAME);
    ensureCsvFileInitialized(outputFilePath);
  }

  console.log(`Output folder set to: ${outputFolderPath}`);
  sendOutputFolderState();
}

function buildAppMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [
        {
          label: "New",
          accelerator: "Ctrl+N",
          click: () => createNewOutputFile(),
        },
        {
          label: "Load",
          accelerator: "Ctrl+O",
          click: () => {
            void loadOutputFile();
          },
        },
        {
          label: "Settings",
          accelerator: "Ctrl+,",
          click: () => {
            void chooseOutputFolder();
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
  ]);

  Menu.setApplicationMenu(menu);
}

function toggleRecording(source: "f3" | "ui") {
  recording = !recording;
  if (recording) {
    lastClickTime = null;
    showOverlay();
    console.log(`Recording STARTED via ${source.toUpperCase()} — click anywhere to register positions.`);
  } else {
    hideOverlay();
    console.log(`Recording STOPPED via ${source.toUpperCase()}.`);
  }

  sendRecordingState();
  if (!recording) {
    sendOutputFolderState();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 420,
    minHeight: 320,
    resizable: true,
    maximizable: true,
    autoHideMenuBar: false,
    title: "Robot Recorder",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    void mainWindow.loadURL("http://localhost:5173");
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.on("toggle-recording", () => {
  toggleRecording("ui");
});

ipcMain.on("ui-ready", () => {
  sendRecordingState();
  sendReplayState();
  sendReplayRowState();
  sendReplayRepeatState();
  sendReplayDelayState();
  sendOutputFolderState();
});

ipcMain.on("set-replay-repeat", (_event, enabled: boolean) => {
  replayRepeatEnabled = Boolean(enabled);
  sendReplayRepeatState();
});

ipcMain.on("set-replay-click-delay-ms", (_event, delayMs: number) => {
  if (!Number.isFinite(delayMs)) {
    replayExtraDelayMs = 0;
  } else {
    replayExtraDelayMs = Math.max(0, Math.round(delayMs));
  }
  sendReplayDelayState();
});

ipcMain.on("stop-replay", () => {
  requestReplayStop("ui");
});

ipcMain.on("set-active-file", (_event, relativePath: string) => {
  try {
    setActiveFileFromRelativePath(relativePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Could not set active file: ${message}`);
  }
});

ipcMain.handle("create-file", (_event, fileName: string) => {
  try {
    console.log(`create-file IPC received: ${fileName}`);
    createFileInOutputFolder(fileName);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Could not create file: ${message}`);
    return { ok: false, error: message };
  }
});

ipcMain.handle("rename-file", (_event, payload: { relativePath: string; newName: string }) => {
  try {
    renameFileInOutputFolder(payload.relativePath, payload.newName);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Could not rename file: ${message}`);
    return { ok: false, error: message };
  }
});

ipcMain.handle("delete-file", (_event, relativePath: string) => {
  try {
    const targetPath = resolveInsideOutputFolder(relativePath);
    if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
      throw new Error("File does not exist");
    }
    fs.unlinkSync(targetPath);
    if (outputFilePath === targetPath) {
      outputFilePath = path.join(outputFolderPath, DEFAULT_OUTPUT_FILE_NAME);
      ensureCsvFileInitialized(outputFilePath);
    }
    console.log(`Deleted file: ${targetPath}`);
    sendOutputFolderState();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Could not delete file: ${message}`);
    return { ok: false, error: message };
  }
});

ipcMain.handle(
  "update-active-csv-row",
  (
    _event,
    payload: {
      rowIndex: number;
      action: string;
      x: number;
      y: number;
      elapsedSeconds: number;
      radius: number;
      elapsedRange?: string;
      xMin?: number;
      xMax?: number;
      yMin?: number;
      yMax?: number;
      elapsedMin?: number | null;
      elapsedMax?: number | null;
    },
  ) => {
    try {
      updateActiveCsvRow(payload);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not update csv row: ${message}`);
      return { ok: false, error: message };
    }
  },
);

ipcMain.handle("play-csv-row", (_event, rowIndex: number) => {
  try {
    if (!Number.isInteger(rowIndex) || rowIndex < 0) {
      throw new Error("Invalid row index");
    }
    const rows = readActiveFileRows();
    if (rowIndex >= rows.length) {
      throw new Error("Row index out of range");
    }
    const row = rows[rowIndex];
    const target = getReplayTargetPoint(row);
    robot.moveMouse(target.x, target.y);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Could not play csv row: ${message}`);
    return { ok: false, error: message };
  }
});

ipcMain.handle("delete-active-csv-row", (_event, rowIndex: number) => {
  try {
    deleteActiveCsvRow(rowIndex);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Could not delete csv row: ${message}`);
    return { ok: false, error: message };
  }
});

ipcMain.handle("rename-active-csv-row-step", (_event, payload: { rowIndex: number; stepName: string }) => {
  try {
    renameActiveCsvRowStep(payload.rowIndex, payload.stepName);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Could not rename csv row step: ${message}`);
    return { ok: false, error: message };
  }
});

ipcMain.handle("replay-active-csv", async (_event, payload?: { fromUi?: boolean }) => {
  try {
    await replayActiveCsv({ fromUi: payload?.fromUi === true });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Could not replay csv: ${message}`);
    return { ok: false, error: message };
  }
});

uIOhook.on("keydown", (e) => {
  if (e.keycode === UiohookKey.F3) {
    toggleRecording("f3");
    return;
  }

  if (e.keycode === UiohookKey.F2) {
    if (replaying) {
      requestReplayStop("f2");
      return;
    }

    void replayActiveCsv().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not replay csv: ${message}`);
    });
    return;
  }

  const isModifier = MODIFIER_KEYCODES.has(e.keycode);

  if (isModifier) {
    if (e.keycode === UiohookKey.Ctrl || e.keycode === UiohookKey.CtrlRight) activeModifiers.add("ctrl");
    else if (e.keycode === UiohookKey.Alt || e.keycode === UiohookKey.AltRight) activeModifiers.add("alt");
    else if (e.keycode === UiohookKey.Shift || e.keycode === UiohookKey.ShiftRight) activeModifiers.add("shift");
    else if (e.keycode === UiohookKey.Meta || e.keycode === UiohookKey.MetaRight) activeModifiers.add("meta");
    return;
  }

  if (recording) {
    const robotKey = UIOHOOK_KEY_TO_ROBOTJS[e.keycode];
    if (robotKey !== undefined) {
      const now = Date.now();
      const elapsedSeconds = lastClickTime !== null ? ((now - lastClickTime) / 1000).toFixed(3) : "0.000";
      lastClickTime = now;
      const modParts = [...activeModifiers].sort();
      const action = modParts.length > 0 ? `Key:${modParts.join("+")}+${robotKey}` : `Key:${robotKey}`;
      const line = `${action},"(0, 0)",${elapsedSeconds},0,${DEFAULT_ELAPSED_RANGE},0,0,0,0,${DEFAULT_RANGE_NONE},${DEFAULT_RANGE_NONE},${action}\n`;
      console.log(`Registered keystroke: ${line.trim()}`);
      fs.appendFileSync(outputFilePath, line);
    }
  }
});

uIOhook.on("keyup", (e) => {
  if (e.keycode === UiohookKey.Ctrl || e.keycode === UiohookKey.CtrlRight) activeModifiers.delete("ctrl");
  else if (e.keycode === UiohookKey.Alt || e.keycode === UiohookKey.AltRight) activeModifiers.delete("alt");
  else if (e.keycode === UiohookKey.Shift || e.keycode === UiohookKey.ShiftRight) activeModifiers.delete("shift");
  else if (e.keycode === UiohookKey.Meta || e.keycode === UiohookKey.MetaRight) activeModifiers.delete("meta");
});

uIOhook.on("mousedown", (e) => {
  if (!recording) return;
  if (e.button === 1 || e.button === 2) {
    const now = Date.now();
    const elapsedSeconds = lastClickTime !== null ? ((now - lastClickTime) / 1000).toFixed(3) : "0.000";
    lastClickTime = now;
    const action = e.button === 1 ? "LClick" : "RClick";

    const xMin = e.x - DEFAULT_CLICK_RADIUS;
    const xMax = e.x + DEFAULT_CLICK_RADIUS;
    const yMin = e.y - DEFAULT_CLICK_RADIUS;
    const yMax = e.y + DEFAULT_CLICK_RADIUS;
    const line = `${action},"(${e.x}, ${e.y})",${elapsedSeconds},${DEFAULT_CLICK_RADIUS},${DEFAULT_ELAPSED_RANGE},${xMin},${xMax},${yMin},${yMax},${DEFAULT_RANGE_NONE},${DEFAULT_RANGE_NONE},${action}\n`;
    console.log(`Registered click at: ${line.trim()}`);
    fs.appendFileSync(outputFilePath, line);
  }
});

process.on("SIGINT", () => {
  hideOverlay();
  uIOhook.stop();
  process.exit(0);
});

app.whenReady().then(() => {
  buildAppMenu();
  createNewOutputFile();
  createWindow();
  uIOhook.start();
  console.log("UI ready. Click the button or press F3 to start/stop recording.");
});

app.on("window-all-closed", () => {
  hideOverlay();
  uIOhook.stop();
  app.quit();
});
