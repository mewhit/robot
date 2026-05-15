export const END_TO_END_SECTION_ONE_URL = "https://ironman.guide/guide/early-game";
export const END_TO_END_SECTION_ONE_ID = "ironman-guide-1.1";
const HIDDEN_INTRO_STEP_COUNT = 3;
const SECTION_ONE_LOCAL_SOURCE_ORDER_PREFIX = [4, 8, 5, 6, 7, 9] as const;
const SECTION_ONE_SELL_AND_SPADE_SOURCE_STEP = 4;
const SECTION_ONE_BUY_SPADE_SOURCE_STEP = 8;
const SECTION_ONE_BUY_SPADE_TEXT = "Buy a spade";
const SECTION_ONE_START_X_MARKS_TEXT = "Start X Marks the Spot quest";

export type EndToEndGuideChecklistStep = {
  id: string;
  position: number;
  sourcePosition: number;
  sourcePositions?: number[];
  title: string;
  text: string;
  location?: string;
};

export type EndToEndGuideChecklist = {
  sectionId: string;
  title: string;
  sourceUrl: string;
  expectedStepCount: number | null;
  fetchedAt: string;
  steps: EndToEndGuideChecklistStep[];
};

type JsonLdHowToStep = {
  position?: unknown;
  name?: unknown;
  text?: unknown;
  itemListElement?: unknown;
};

type JsonLdHowTo = {
  "@type"?: unknown;
  name?: unknown;
  step?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim();
}

function extractJsonLdBlocks(html: string): string[] {
  const blocks: string[] = [];
  const regex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match = regex.exec(html);

  while (match) {
    blocks.push(match[1].trim());
    match = regex.exec(html);
  }

  return blocks;
}

function getJsonLdType(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(getJsonLdType).find(Boolean) ?? "";
  }

  return normalizeText(value);
}

function findHowToJsonLd(html: string): JsonLdHowTo | null {
  for (const block of extractJsonLdBlocks(html)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }

    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const candidate of candidates) {
      if (!isRecord(candidate)) {
        continue;
      }

      if (getJsonLdType(candidate["@type"]) === "HowTo" && Array.isArray(candidate.step)) {
        return candidate as JsonLdHowTo;
      }
    }
  }

  return null;
}

function extractLocation(itemListElement: unknown): string | undefined {
  const elements = Array.isArray(itemListElement) ? itemListElement : [itemListElement];

  for (const element of elements) {
    if (!isRecord(element)) {
      continue;
    }

    const text = normalizeText(element.text);
    const locationMatch = /^Location:\s*(.+)$/i.exec(text);
    if (locationMatch) {
      return locationMatch[1].trim();
    }
  }

  return undefined;
}

function parseStep(rawStep: unknown): EndToEndGuideChecklistStep | null {
  if (!isRecord(rawStep)) {
    return null;
  }

  const step = rawStep as JsonLdHowToStep;
  const sourcePosition = Number(step.position);
  if (!Number.isInteger(sourcePosition) || sourcePosition <= 0) {
    return null;
  }

  const text = normalizeText(step.text);
  const title = normalizeText(step.name) || text;
  if (!text && !title) {
    return null;
  }

  return {
    id: `${END_TO_END_SECTION_ONE_ID}-step-${sourcePosition}`,
    position: sourcePosition,
    sourcePosition,
    sourcePositions: [sourcePosition],
    title,
    text: text || title,
    location: extractLocation(step.itemListElement),
  };
}

function extractExpectedStepCount(html: string): number | null {
  const match = />(\d+)\s*<!--\s*-->\s*steps in this section</i.exec(html) ?? /(\d+)\s+steps in this section/i.exec(html);
  if (!match) {
    return null;
  }

  const count = Number(match[1]);
  return Number.isInteger(count) && count > 0 ? count : null;
}

export function getEndToEndGuideChecklistStepSourcePosition(step: EndToEndGuideChecklistStep): number {
  if (Number.isInteger(step.sourcePosition) && step.sourcePosition > 0) {
    return step.sourcePosition;
  }

  const sourcePositionFromId = /-step-(\d+)$/.exec(step.id);
  if (sourcePositionFromId) {
    return Number(sourcePositionFromId[1]);
  }

  return step.position;
}

export function getEndToEndGuideChecklistStepSourcePositions(step: EndToEndGuideChecklistStep): number[] {
  const positions = Array.isArray(step.sourcePositions)
    ? step.sourcePositions.filter((position) => Number.isInteger(position) && position > 0)
    : [];
  if (positions.length > 0) {
    return [...new Set(positions)];
  }

  return [getEndToEndGuideChecklistStepSourcePosition(step)];
}

export function formatEndToEndGuideChecklistStepSourceLabel(step: EndToEndGuideChecklistStep): string {
  return `src${getEndToEndGuideChecklistStepSourcePositions(step).join("+")}`;
}

function mergeChecklistText(primary: string | undefined, merged: string | undefined): string | undefined {
  const normalizedPrimary = normalizeText(primary);
  const normalizedMerged = normalizeText(merged);
  if (!normalizedPrimary) {
    return normalizedMerged || undefined;
  }
  if (!normalizedMerged || normalizedPrimary.toLowerCase() === normalizedMerged.toLowerCase()) {
    return normalizedPrimary;
  }

  return `${normalizedPrimary}; ${normalizedMerged}`;
}

function mergeBuySpadeIntoFirstStep(
  target: EndToEndGuideChecklistStep,
  sourceStep: EndToEndGuideChecklistStep,
): EndToEndGuideChecklistStep {
  const sourcePositions = [
    ...getEndToEndGuideChecklistStepSourcePositions(target),
    ...getEndToEndGuideChecklistStepSourcePositions(sourceStep),
  ];

  return {
    ...target,
    sourcePositions: [...new Set(sourcePositions)],
    title: mergeChecklistText(target.title, SECTION_ONE_BUY_SPADE_TEXT) ?? target.title,
    text: mergeChecklistText(target.text, SECTION_ONE_BUY_SPADE_TEXT) ?? target.text,
    location: mergeChecklistText(target.location, sourceStep.location),
  };
}

function createStartXMarksStep(sourceStep: EndToEndGuideChecklistStep): EndToEndGuideChecklistStep {
  return {
    ...sourceStep,
    id: `${END_TO_END_SECTION_ONE_ID}-step-${SECTION_ONE_BUY_SPADE_SOURCE_STEP}-start-x-marks-the-spot`,
    sourcePosition: SECTION_ONE_BUY_SPADE_SOURCE_STEP,
    sourcePositions: [SECTION_ONE_BUY_SPADE_SOURCE_STEP],
    title: SECTION_ONE_START_X_MARKS_TEXT,
    text: SECTION_ONE_START_X_MARKS_TEXT,
  };
}

function buildSectionOneCustomSteps(
  steps: EndToEndGuideChecklistStep[],
): EndToEndGuideChecklistStep[] {
  const stepsBySourcePosition = new Map(
    steps.map((step) => [getEndToEndGuideChecklistStepSourcePosition(step), step]),
  );
  const target = stepsBySourcePosition.get(SECTION_ONE_SELL_AND_SPADE_SOURCE_STEP);
  const buySpade = stepsBySourcePosition.get(SECTION_ONE_BUY_SPADE_SOURCE_STEP);
  if (!target || !buySpade) {
    return steps;
  }

  return steps
    .map((step) =>
      getEndToEndGuideChecklistStepSourcePosition(step) === SECTION_ONE_SELL_AND_SPADE_SOURCE_STEP
        ? mergeBuySpadeIntoFirstStep(target, buySpade)
        : getEndToEndGuideChecklistStepSourcePosition(step) === SECTION_ONE_BUY_SPADE_SOURCE_STEP
          ? createStartXMarksStep(buySpade)
        : step,
    );
}

function buildSectionOneLocalActionList(
  steps: EndToEndGuideChecklistStep[],
): EndToEndGuideChecklistStep[] {
  const sourceOrderedSteps = buildSectionOneCustomSteps([...steps]).sort(
    (a, b) => getEndToEndGuideChecklistStepSourcePosition(a) - getEndToEndGuideChecklistStepSourcePosition(b),
  );
  const stepsBySourcePosition = new Map(
    sourceOrderedSteps.map((step) => [getEndToEndGuideChecklistStepSourcePosition(step), step]),
  );
  const usedSourcePositions = new Set<number>();
  const localPrefixSteps: EndToEndGuideChecklistStep[] = [];

  for (const sourcePosition of SECTION_ONE_LOCAL_SOURCE_ORDER_PREFIX) {
    const step = stepsBySourcePosition.get(sourcePosition);
    if (!step) {
      continue;
    }

    localPrefixSteps.push(step);
    usedSourcePositions.add(sourcePosition);
  }

  return [
    ...localPrefixSteps,
    ...sourceOrderedSteps.filter((step) => !usedSourcePositions.has(getEndToEndGuideChecklistStepSourcePosition(step))),
  ];
}

export function formatEndToEndGuideChecklistExecutionOrder(steps: EndToEndGuideChecklistStep[]): string {
  return steps.map((step, index) => `${index + 1}:${formatEndToEndGuideChecklistStepSourceLabel(step)}`).join(", ");
}

function assignLocalChecklistPositions(
  steps: EndToEndGuideChecklistStep[],
): EndToEndGuideChecklistStep[] {
  return steps.map((step, index) => ({
    ...step,
    position: index + 1,
  }));
}

export function parseEndToEndGuideChecklistHtml(html: string, fetchedAt = new Date().toISOString()): EndToEndGuideChecklist {
  const howTo = findHowToJsonLd(html);
  if (!howTo) {
    throw new Error("ironman.guide HowTo JSON-LD not found");
  }

  const sourceSteps = (Array.isArray(howTo.step) ? howTo.step : [])
    .map(parseStep)
    .filter((step): step is EndToEndGuideChecklistStep => Boolean(step))
    .filter((step) => step.sourcePosition > HIDDEN_INTRO_STEP_COUNT);
  const steps = assignLocalChecklistPositions(buildSectionOneLocalActionList(sourceSteps));

  if (steps.length === 0) {
    throw new Error("ironman.guide checklist has no parseable steps");
  }

  return {
    sectionId: END_TO_END_SECTION_ONE_ID,
    title: normalizeText(howTo.name) || "OSRS Ironman Guide - Section 1.1",
    sourceUrl: END_TO_END_SECTION_ONE_URL,
    expectedStepCount: steps.length,
    fetchedAt,
    steps,
  };
}

export async function fetchEndToEndSectionOneChecklist(timeoutMs = 8000): Promise<EndToEndGuideChecklist> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(END_TO_END_SECTION_ONE_URL, {
      signal: controller.signal,
      headers: {
        Accept: "text/html",
        "User-Agent": "robot-end-to-end-bot",
      },
    });

    if (!response.ok) {
      throw new Error(`ironman.guide responded with HTTP ${response.status}`);
    }

    return parseEndToEndGuideChecklistHtml(await response.text());
  } finally {
    clearTimeout(timeout);
  }
}
