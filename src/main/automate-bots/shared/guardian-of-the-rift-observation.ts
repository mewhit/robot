import { detectInventoryCount } from "./inventory-count-detector";
import type { RobotBitmap } from "./ocr-engine";
import {
  detectGuardianOfTheRiftActiveRunes,
  type GuardianOfTheRiftRune,
  type GuardianOfTheRiftRuneTemplate,
} from "./guardian-of-the-rift-active-rune-detector";
import { detectGuardianOfTheRiftTimer } from "./guardian-of-the-rift-timer-detector";
import {
  detectGuardianOfTheRiftUnchargedCellCount,
  type GuardianOfTheRiftUnchargedCellTemplate,
} from "./guardian-of-the-rift-uncharged-cell-detector";
import {
  detectGuardianOfTheRiftRewardPoints,
  detectGuardianOfTheRiftTimeSincePortal,
  type GuardianOfTheRiftRewardPointFocus,
  type GuardianOfTheRiftTimeSincePortalColor,
} from "./guardian-of-the-rift-panel-detector";

export type GuardianOfTheRiftPhase = "paused" | "first-mining" | "active-runecrafting";

export type GuardianOfTheRiftObservation = {
  phase: GuardianOfTheRiftPhase;
  timerSecondsRemaining: number | null;
  elementalGuardian: GuardianOfTheRiftRune | null;
  catalyticGuardian: GuardianOfTheRiftRune | null;
  elementalRewardPoints: number | null;
  catalyticRewardPoints: number | null;
  rewardPointFocus: GuardianOfTheRiftRewardPointFocus | null;
  timeSincePortalColor: GuardianOfTheRiftTimeSincePortalColor | null;
  timeSincePortalSecondsElapsed: number | null;
  unchargedCellCount: number | null;
  hasTenUnchargedCells: boolean;
  inventoryFreeSlots: number | null;
};

export function classifyGuardianOfTheRiftPhase(input: {
  timerSecondsRemaining: number | null;
  elementalGuardian: GuardianOfTheRiftRune | null;
  catalyticGuardian: GuardianOfTheRiftRune | null;
}): GuardianOfTheRiftPhase {
  const hasTimer = input.timerSecondsRemaining !== null;
  const hasActiveGuardian = input.elementalGuardian !== null || input.catalyticGuardian !== null;

  if (!hasTimer && !hasActiveGuardian) {
    return "paused";
  }

  if (hasTimer && !hasActiveGuardian) {
    return "first-mining";
  }

  return "active-runecrafting";
}

export function observeGuardianOfTheRiftState(
  bitmap: RobotBitmap,
  runeTemplates: GuardianOfTheRiftRuneTemplate[],
  unchargedCellTemplates: GuardianOfTheRiftUnchargedCellTemplate[],
): GuardianOfTheRiftObservation {
  const activeRunes = detectGuardianOfTheRiftActiveRunes(bitmap, runeTemplates);
  const timer = detectGuardianOfTheRiftTimer(bitmap);
  const timeSincePortal = detectGuardianOfTheRiftTimeSincePortal(bitmap);
  const rewardPoints = detectGuardianOfTheRiftRewardPoints(bitmap);
  const unchargedCells = detectGuardianOfTheRiftUnchargedCellCount(bitmap, unchargedCellTemplates);
  const inventory = detectInventoryCount(bitmap);

  const elementalGuardian = activeRunes.elemental?.rune ?? null;
  const catalyticGuardian = activeRunes.catalytic?.rune ?? null;
  const timerSecondsRemaining = timer.secondsRemaining;

  return {
    phase: classifyGuardianOfTheRiftPhase({
      timerSecondsRemaining,
      elementalGuardian,
      catalyticGuardian,
    }),
    timerSecondsRemaining,
    elementalGuardian,
    catalyticGuardian,
    elementalRewardPoints: rewardPoints.elementalPoints,
    catalyticRewardPoints: rewardPoints.catalyticPoints,
    rewardPointFocus: rewardPoints.focus,
    timeSincePortalColor: timeSincePortal.color,
    timeSincePortalSecondsElapsed: timeSincePortal.secondsElapsed,
    unchargedCellCount: unchargedCells.count,
    hasTenUnchargedCells: unchargedCells.hasTenUnchargedCells,
    inventoryFreeSlots: inventory.count,
  };
}
