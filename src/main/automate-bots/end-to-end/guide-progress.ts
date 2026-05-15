import type { OsrsWikiSyncQuest, OsrsWikiSyncQuestStatus } from "../wikisync/osrs-wikisync";
import {
  getEndToEndGuideChecklistStepSourcePositions,
  type EndToEndGuideChecklist,
  type EndToEndGuideChecklistStep,
} from "./guide-checklist";

export type EndToEndGuideQuestProgressMatch = {
  step: EndToEndGuideChecklistStep;
  displayIndex: number;
  questName: string;
  questStatus: OsrsWikiSyncQuestStatus;
  satisfied: boolean;
  action: "start" | "finish";
};

export type EndToEndGuideQuestProgressEstimate = {
  totalQuestSteps: number;
  satisfiedQuestSteps: number;
  firstUnsatisfied: EndToEndGuideQuestProgressMatch | null;
  lastSatisfied: EndToEndGuideQuestProgressMatch | null;
  matches: EndToEndGuideQuestProgressMatch[];
};

const QUEST_ALIASES: Record<string, string[]> = {
  "Alfred Grimhand's Barcrawl": ["barcrawl", "barcrawl miniquest"],
  "Dragon Slayer I": ["dragon slayer", "dragon slayer i"],
  "Enter the Abyss": ["abyss miniquest", "abyss"],
  "Recipe for Disaster": ["rfd", "recipe for disaster"],
  "Romeo & Juliet": ["romeo and juliet", "romeo juliet"],
  "The Dig Site": ["digsite quest", "dig site", "the dig site"],
  "The Grand Tree": ["grand tree", "the grand tree"],
  "The Knight's Sword": ["knights sword", "the knights sword"],
  "The Lost Tribe": ["lost tribe", "the lost tribe"],
  "The Restless Ghost": ["restless ghost", "the restless ghost"],
};

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getQuestAliases(questName: string): string[] {
  const normalizedName = normalizeSearchText(questName);
  const withoutLeadingThe = normalizedName.replace(/^the\s+/, "");
  return [...new Set([normalizedName, withoutLeadingThe, ...(QUEST_ALIASES[questName] ?? []).map(normalizeSearchText)])]
    .filter((alias) => alias.length >= 3)
    .sort((a, b) => b.length - a.length);
}

function stepContainsAlias(normalizedStepText: string, alias: string): boolean {
  return ` ${normalizedStepText} `.includes(` ${alias} `);
}

function classifyQuestStepAction(stepText: string): "start" | "finish" {
  const normalized = normalizeSearchText(stepText);
  if (/\b(start|talk to .* start)\b/.test(normalized)) {
    return "start";
  }

  return "finish";
}

function isQuestStepSatisfied(status: OsrsWikiSyncQuestStatus, action: "start" | "finish"): boolean {
  if (status === "completed") {
    return true;
  }
  return action === "start" && status === "started";
}

export function estimateEndToEndGuideQuestProgress(
  checklist: EndToEndGuideChecklist,
  quests: OsrsWikiSyncQuest[],
): EndToEndGuideQuestProgressEstimate {
  const questCandidates = quests
    .map((quest) => ({
      quest,
      aliases: getQuestAliases(quest.name),
    }))
    .filter((candidate) => candidate.aliases.length > 0)
    .sort((a, b) => b.aliases[0].length - a.aliases[0].length);

  const matches: EndToEndGuideQuestProgressMatch[] = [];

  checklist.steps.forEach((step) => {
    const normalizedStepText = normalizeSearchText(`${step.title} ${step.text}`);
    const matchedCandidate = questCandidates.find((candidate) =>
      candidate.aliases.some((alias) => stepContainsAlias(normalizedStepText, alias)),
    );
    if (!matchedCandidate) {
      return;
    }

    const action = classifyQuestStepAction(step.text);
    matches.push({
      step,
      displayIndex: step.position,
      questName: matchedCandidate.quest.name,
      questStatus: matchedCandidate.quest.status,
      satisfied: isQuestStepSatisfied(matchedCandidate.quest.status, action),
      action,
    });
  });

  return {
    totalQuestSteps: matches.length,
    satisfiedQuestSteps: matches.filter((match) => match.satisfied).length,
    firstUnsatisfied: matches.find((match) => !match.satisfied) ?? null,
    lastSatisfied: [...matches].reverse().find((match) => match.satisfied) ?? null,
    matches,
  };
}

export function formatEndToEndGuideQuestProgressEstimate(estimate: EndToEndGuideQuestProgressEstimate): string {
  const prefix = `questSteps=${estimate.satisfiedQuestSteps}/${estimate.totalQuestSteps}`;

  if (estimate.totalQuestSteps === 0) {
    return `${prefix} no quest steps matched`;
  }

  if (!estimate.firstUnsatisfied) {
    return `${prefix} all matched quest steps satisfied`;
  }

  const sourcePosition = getEndToEndGuideChecklistStepSourcePositions(estimate.firstUnsatisfied.step).join("+");
  return `${prefix} nextLikely=#${estimate.firstUnsatisfied.displayIndex} sourceStep=${sourcePosition} quest='${estimate.firstUnsatisfied.questName}' status=${estimate.firstUnsatisfied.questStatus} action=${estimate.firstUnsatisfied.action} text='${estimate.firstUnsatisfied.step.text}'`;
}
