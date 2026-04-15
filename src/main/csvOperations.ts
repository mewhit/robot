import * as fs from "fs";
import { screen } from "electron";
import { AppState } from "./global-state";
import { CsvRow, VirtualBounds } from "./types";
import {
  LEGACY_CSV_HEADER,
  CSV_HEADER_WITH_ELAPSED_RANGE,
  CSV_HEADER_WITH_RANGES,
  DEFAULT_ELAPSED_RANGE,
  DEFAULT_RANGE_NONE,
  LEGACY_REPLAY_KEY_ALIASES,
} from "./constants";

export function parseFirstCsvColumn(line: string): string {
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

export function splitCsvLine(line: string): string[] {
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

export function parseClickPosition(raw: string): { x: number; y: number } | null {
  const match = raw.match(/^\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/);
  if (!match) return null;

  const x = Number(match[1]);
  const y = Number(match[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return { x, y };
}

export function getVirtualBounds(): VirtualBounds {
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

export function toPercentage(value: number, min: number, span: number): number {
  return Number((((value - min) / span) * 100).toFixed(2));
}

export function clampPercent(value: number): number {
  return Number(Math.min(100, Math.max(0, value)).toFixed(2));
}

export function isCsvHeaderLine(line: string): boolean {
  return line === LEGACY_CSV_HEADER || line === CSV_HEADER_WITH_ELAPSED_RANGE || line === CSV_HEADER_WITH_RANGES;
}

export function normalizeElapsedRange(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_ELAPSED_RANGE;
}

export function parseOptionalNumber(raw: string | undefined): number | null {
  const trimmed = (raw ?? "").trim().toLowerCase();
  if (!trimmed || trimmed === "none") {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatNumberForCsv(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Number(value.toFixed(3)));
}

export function escapeCsvField(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

export function formatOptionalNumberForCsv(value: number | null): string {
  return value === null ? DEFAULT_RANGE_NONE : formatNumberForCsv(value);
}

export function normalizeReplayKey(rawKey: string): string {
  const key = rawKey.trim().toLowerCase();

  if (key === "esc") return "escape";

  return LEGACY_REPLAY_KEY_ALIASES[key] ?? key;
}

export function formatCsvRow(row: {
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

export function listDataLineIndexes(content: string): number[] {
  return content
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((entry) => entry.line.length > 0 && !isCsvHeaderLine(entry.line))
    .map((entry) => entry.index);
}

export function readActiveFileRows(): CsvRow[] {
  try {
    if (!fs.existsSync(AppState.outputFilePath) || fs.statSync(AppState.outputFilePath).isDirectory()) {
      return [];
    }

    const bounds = getVirtualBounds();
    const content = fs.readFileSync(AppState.outputFilePath, "utf8");
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
