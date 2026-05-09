import * as fs from "fs";
import * as path from "path";
import { splitCsvLine } from "./csvOperations";

export const GUARDIAN_OF_THE_RIFT_RUN_STATS_CSV_PATH = path.resolve(
  "./automate-bot-logs/guardian-of-the-rift-run-stats.csv",
);

export type GuardianOfTheRiftRunStatsRow = Record<string, string>;

export type GuardianOfTheRiftRunStatsSnapshot = {
  path: string;
  exists: boolean;
  lastModifiedAt: string | null;
  columns: string[];
  rows: GuardianOfTheRiftRunStatsRow[];
};

function normalizeCsvValue(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : "null";
}

export function readGuardianOfTheRiftRunStatsSnapshot(): GuardianOfTheRiftRunStatsSnapshot {
  const csvPath = GUARDIAN_OF_THE_RIFT_RUN_STATS_CSV_PATH;
  if (!fs.existsSync(csvPath) || fs.statSync(csvPath).isDirectory()) {
    return {
      path: csvPath,
      exists: false,
      lastModifiedAt: null,
      columns: [],
      rows: [],
    };
  }

  const stat = fs.statSync(csvPath);
  const content = fs.readFileSync(csvPath, "utf8");
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return {
      path: csvPath,
      exists: true,
      lastModifiedAt: stat.mtime.toISOString(),
      columns: [],
      rows: [],
    };
  }

  const columns = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const fields = splitCsvLine(line);
    return columns.reduce<GuardianOfTheRiftRunStatsRow>((row, column, index) => {
      row[column] = normalizeCsvValue(fields[index]);
      return row;
    }, {});
  });

  return {
    path: csvPath,
    exists: true,
    lastModifiedAt: stat.mtime.toISOString(),
    columns,
    rows,
  };
}
