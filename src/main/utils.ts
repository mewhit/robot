import { CsvRow } from "./types";

export function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function getRandomNumberInRange(min: number, max: number): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return low + Math.random() * (high - low);
}

export function getReplayTargetPoint(row: CsvRow): { x: number; y: number } {
  const x = Number.isFinite(row.xMin) && Number.isFinite(row.xMax) ? getRandomNumberInRange(row.xMin, row.xMax) : row.x;
  const y = Number.isFinite(row.yMin) && Number.isFinite(row.yMax) ? getRandomNumberInRange(row.yMin, row.yMax) : row.y;

  return {
    x: Math.round(x),
    y: Math.round(y),
  };
}
