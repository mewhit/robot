import { keyToggle, typeStringDelayed } from "robotjs";
import { sleepWithAbort } from "../engine/bot-engine";
import { randomIntInclusive } from "./osrs-helper";

export type RobotKeyboardResult = {
  ok: boolean;
  error?: string;
};

export type RobotKeyTapOptions = {
  modifiers?: string[];
  minHoldMs?: number;
  maxHoldMs?: number;
  minModifierDelayMs?: number;
  maxModifierDelayMs?: number;
  afterMs?: number;
  shouldContinue?: () => boolean;
};

function defaultShouldContinue(): boolean {
  return true;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRobotKeyboardInputAvailable(): boolean {
  return typeof keyToggle === "function" && typeof typeStringDelayed === "function";
}

export async function holdRobotKey(
  key: string,
  holdMs: number,
  options: { shouldContinue?: () => boolean } = {},
): Promise<RobotKeyboardResult> {
  const shouldContinue = options.shouldContinue ?? defaultShouldContinue;
  try {
    keyToggle(key, "down");
    await sleepWithAbort(holdMs, shouldContinue);
  } catch (error) {
    return { ok: false, error: getErrorMessage(error) };
  } finally {
    try {
      keyToggle(key, "up");
    } catch {
      // Best-effort release only.
    }
  }

  return { ok: shouldContinue() };
}

export async function tapRobotKey(key: string, options: RobotKeyTapOptions = {}): Promise<RobotKeyboardResult> {
  const shouldContinue = options.shouldContinue ?? defaultShouldContinue;
  const modifiers = options.modifiers ?? [];
  const minHoldMs = options.minHoldMs ?? 35;
  const maxHoldMs = options.maxHoldMs ?? 78;
  const minModifierDelayMs = options.minModifierDelayMs ?? 18;
  const maxModifierDelayMs = options.maxModifierDelayMs ?? 62;
  const afterMs = options.afterMs ?? 0;

  try {
    for (const modifier of modifiers) {
      keyToggle(modifier, "down");
      await sleepWithAbort(randomIntInclusive(minModifierDelayMs, maxModifierDelayMs), shouldContinue);
    }

    keyToggle(key, "down");
    await sleepWithAbort(randomIntInclusive(minHoldMs, maxHoldMs), shouldContinue);
    keyToggle(key, "up");

    for (const modifier of [...modifiers].reverse()) {
      await sleepWithAbort(randomIntInclusive(minModifierDelayMs, maxModifierDelayMs), shouldContinue);
      keyToggle(modifier, "up");
    }

    if (afterMs > 0) {
      await sleepWithAbort(afterMs, shouldContinue);
    }
  } catch (error) {
    for (const modifier of [...modifiers].reverse()) {
      try {
        keyToggle(modifier, "up");
      } catch {
        // Best-effort release only.
      }
    }
    try {
      keyToggle(key, "up");
    } catch {
      // Best-effort release only.
    }
    return { ok: false, error: getErrorMessage(error) };
  }

  return { ok: shouldContinue() };
}

export async function clearFocusedTextWithCtrlA(
  options: {
    shouldContinue?: () => boolean;
    afterSelectMs?: number;
    afterBackspaceMs?: number;
  } = {},
): Promise<RobotKeyboardResult> {
  const shouldContinue = options.shouldContinue ?? defaultShouldContinue;
  const selectResult = await tapRobotKey("a", {
    modifiers: ["control"],
    afterMs: options.afterSelectMs ?? randomIntInclusive(65, 140),
    shouldContinue,
  });
  if (!selectResult.ok) {
    return selectResult;
  }

  return tapRobotKey("backspace", {
    afterMs: options.afterBackspaceMs ?? randomIntInclusive(45, 115),
    shouldContinue,
  });
}

export function typeRobotTextDelayed(text: string, cpm: number): RobotKeyboardResult {
  try {
    typeStringDelayed(text, cpm);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: getErrorMessage(error) };
  }
}
