import * as fs from "fs";
import * as path from "path";
import { dialog, app, BrowserWindow } from "electron";
import { AppState } from "./global-state";
import {
  ensureOutputFolder,
  resolveInsideOutputFolder,
  toCsvFileName,
  listOutputFolderFiles,
  buildExplorerTree,
} from "./fileManager";
import { readActiveFileRows, listDataLineIndexes, formatCsvRow } from "./csvOperations";
import { DEFAULT_OUTPUT_FILE_NAME, DEFAULT_ELAPSED_RANGE } from "./constants";

export function sendOutputFolderState() {
  ensureOutputFolder();
  const tree = buildExplorerTree(AppState.outputFolderPath);
  const activeFileRows = readActiveFileRows();
  AppState.mainWindow?.webContents.send("output-folder-state", {
    folderPath: AppState.outputFolderPath,
    activeFile: path.basename(AppState.outputFilePath),
    activeRelativePath: path.relative(AppState.outputFolderPath, AppState.outputFilePath),
    activeFileLines: activeFileRows.map((row) => row.stepName),
    activeFileRows,
    files: listOutputFolderFiles(),
    tree,
  });
}

export function createNewOutputFile() {
  ensureOutputFolder();
  const existingFiles = listOutputFolderFiles();

  if (existingFiles.length > 0) {
    const existingCsv = existingFiles.find((file) => /\.csv$/i.test(file));
    const selectedExisting = existingCsv ?? existingFiles[0];
    AppState.outputFilePath = resolveInsideOutputFolder(selectedExisting);
    console.log(`Using existing output file: ${AppState.outputFilePath}`);
    sendOutputFolderState();
    return;
  }

  AppState.outputFilePath = path.join(AppState.outputFolderPath, DEFAULT_OUTPUT_FILE_NAME);
  ensureCsvFileInitialized(AppState.outputFilePath);
  console.log(`Created new output file: ${AppState.outputFilePath}`);
  sendOutputFolderState();
}

export function ensureCsvFileInitialized(filePath: string) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "", "utf8");
    return;
  }

  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    fs.writeFileSync(filePath, "", "utf8");
  }
}

export function createFileInOutputFolder(fileName: string) {
  ensureOutputFolder();
  const trimmed = fileName.trim();
  if (!trimmed) {
    throw new Error("File name is required");
  }

  const cleanName = toCsvFileName(path.basename(trimmed));
  const targetPath = path.join(AppState.outputFolderPath, cleanName);

  if (fs.existsSync(targetPath)) {
    throw new Error("File already exists");
  }

  fs.writeFileSync(targetPath, "", "utf8");
  AppState.outputFilePath = targetPath;
  console.log(`Created file: ${targetPath}`);
  sendOutputFolderState();
}

export function updateActiveCsvRow(payload: {
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

  if (!fs.existsSync(AppState.outputFilePath) || fs.statSync(AppState.outputFilePath).isDirectory()) {
    throw new Error("Active file not found");
  }

  const content = fs.readFileSync(AppState.outputFilePath, "utf8");
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

  fs.writeFileSync(AppState.outputFilePath, lines.join("\n"), "utf8");
  sendOutputFolderState();
}

export function renameActiveCsvRowStep(rowIndex: number, nextStepName: string) {
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

export function deleteActiveCsvRow(rowIndex: number) {
  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    throw new Error("Invalid row index");
  }

  if (!fs.existsSync(AppState.outputFilePath) || fs.statSync(AppState.outputFilePath).isDirectory()) {
    throw new Error("Active file not found");
  }

  const content = fs.readFileSync(AppState.outputFilePath, "utf8");
  const lines = content.split(/\r?\n/);
  const dataLineIndexes = listDataLineIndexes(content);

  if (rowIndex >= dataLineIndexes.length) {
    throw new Error("Row index out of range");
  }

  lines.splice(dataLineIndexes[rowIndex], 1);
  fs.writeFileSync(AppState.outputFilePath, lines.join("\n"), "utf8");
  sendOutputFolderState();
}

export function insertActiveCsvRowAbove(rowIndex: number) {
  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    throw new Error("Invalid row index");
  }

  if (!fs.existsSync(AppState.outputFilePath) || fs.statSync(AppState.outputFilePath).isDirectory()) {
    throw new Error("Active file not found");
  }

  const content = fs.readFileSync(AppState.outputFilePath, "utf8");
  const lines = content.split(/\r?\n/);
  const dataLineIndexes = listDataLineIndexes(content);

  if (rowIndex >= dataLineIndexes.length) {
    throw new Error("Row index out of range");
  }

  const sourceLineIndex = dataLineIndexes[rowIndex];
  const rowToDuplicate = lines[sourceLineIndex];
  lines.splice(sourceLineIndex, 0, rowToDuplicate);
  fs.writeFileSync(AppState.outputFilePath, lines.join("\n"), "utf8");
  sendOutputFolderState();
}

export function insertActiveCsvRowBelow(rowIndex: number) {
  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    throw new Error("Invalid row index");
  }

  if (!fs.existsSync(AppState.outputFilePath) || fs.statSync(AppState.outputFilePath).isDirectory()) {
    throw new Error("Active file not found");
  }

  const content = fs.readFileSync(AppState.outputFilePath, "utf8");
  const lines = content.split(/\r?\n/);
  const dataLineIndexes = listDataLineIndexes(content);

  if (rowIndex >= dataLineIndexes.length) {
    throw new Error("Row index out of range");
  }

  const sourceLineIndex = dataLineIndexes[rowIndex];
  const rowToDuplicate = lines[sourceLineIndex];
  lines.splice(sourceLineIndex + 1, 0, rowToDuplicate);
  fs.writeFileSync(AppState.outputFilePath, lines.join("\n"), "utf8");
  sendOutputFolderState();
}

export function renameFileInOutputFolder(relativePath: string, newName: string) {
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

  if (AppState.outputFilePath === currentPath) {
    AppState.outputFilePath = targetPath;
  }

  console.log(`Renamed file: ${currentPath} -> ${targetPath}`);
  sendOutputFolderState();
}

export function setActiveFileFromRelativePath(relativePath: string) {
  const resolved = resolveInsideOutputFolder(relativePath);
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    throw new Error("Selected file does not exist");
  }

  AppState.outputFilePath = resolved;
  sendOutputFolderState();
}

export async function loadOutputFile() {
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

  AppState.outputFilePath = selected.filePaths[0];
  AppState.outputFolderPath = path.dirname(AppState.outputFilePath);
  ensureCsvFileInitialized(AppState.outputFilePath);

  console.log(`Loaded output file: ${AppState.outputFilePath}`);
  sendOutputFolderState();
}

export async function chooseOutputFolder() {
  const selected = await dialog.showOpenDialog({
    title: "Select Output Folder",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: AppState.outputFolderPath,
  });

  if (selected.canceled || selected.filePaths.length === 0) {
    return;
  }

  AppState.outputFolderPath = selected.filePaths[0];
  ensureOutputFolder();

  if (path.dirname(AppState.outputFilePath) !== AppState.outputFolderPath) {
    AppState.outputFilePath = path.join(AppState.outputFolderPath, DEFAULT_OUTPUT_FILE_NAME);
    ensureCsvFileInitialized(AppState.outputFilePath);
  }

  console.log(`Output folder set to: ${AppState.outputFolderPath}`);
  sendOutputFolderState();
}

export function createWindow() {
  AppState.mainWindow = new BrowserWindow({
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
    void AppState.mainWindow.loadURL("http://localhost:5173");
  } else {
    void AppState.mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  AppState.mainWindow.on("closed", () => {
    AppState.mainWindow = null;
  });
}

export function buildAppMenu() {
  const menu = [
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
        { type: "separator" as const },
        { role: "quit" as const },
      ],
    },
  ];

  const builtMenu = require("electron").Menu.buildFromTemplate(menu);
  require("electron").Menu.setApplicationMenu(builtMenu);
}
