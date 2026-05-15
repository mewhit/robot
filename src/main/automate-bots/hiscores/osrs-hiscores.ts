export type OsrsHiscoresSkillName =
  | "overall"
  | "attack"
  | "defence"
  | "strength"
  | "hitpoints"
  | "ranged"
  | "prayer"
  | "magic"
  | "cooking"
  | "woodcutting"
  | "fletching"
  | "fishing"
  | "firemaking"
  | "crafting"
  | "smithing"
  | "mining"
  | "herblore"
  | "agility"
  | "thieving"
  | "slayer"
  | "farming"
  | "runecraft"
  | "hunter"
  | "construction";

export type OsrsHiscoresSkill = {
  name: OsrsHiscoresSkillName;
  rank: number;
  level: number;
  experience: number;
};

export type OsrsHiscoresSnapshot = {
  playerName: string;
  endpoint: string;
  skills: OsrsHiscoresSkill[];
};

const SKILL_NAMES: OsrsHiscoresSkillName[] = [
  "overall",
  "attack",
  "defence",
  "strength",
  "hitpoints",
  "ranged",
  "prayer",
  "magic",
  "cooking",
  "woodcutting",
  "fletching",
  "fishing",
  "firemaking",
  "crafting",
  "smithing",
  "mining",
  "herblore",
  "agility",
  "thieving",
  "slayer",
  "farming",
  "runecraft",
  "hunter",
  "construction",
];

export function parseOsrsHiscoresLite(playerName: string, endpoint: string, raw: string): OsrsHiscoresSnapshot {
  const rows = raw
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const skills = SKILL_NAMES.map((name, index) => {
    const row = rows[index];
    if (!row) {
      throw new Error(`Hiscores response is missing row ${index} for ${name}.`);
    }

    const [rankRaw, levelRaw, experienceRaw] = row.split(",");
    const rank = Number(rankRaw);
    const level = Number(levelRaw);
    const experience = Number(experienceRaw);
    if (![rank, level, experience].every(Number.isFinite)) {
      throw new Error(`Invalid hiscores row for ${name}: ${row}.`);
    }

    return {
      name,
      rank,
      level,
      experience,
    };
  });

  return {
    playerName,
    endpoint,
    skills,
  };
}

export async function fetchOsrsHiscoresLite(playerName: string): Promise<OsrsHiscoresSnapshot> {
  const normalized = playerName.trim();
  if (!normalized) {
    throw new Error("OSRS hiscores player name is empty.");
  }

  const endpoint = `https://secure.runescape.com/m=hiscore_oldschool/index_lite.ws?player=${encodeURIComponent(normalized)}`;
  const response = await fetch(endpoint, {
    headers: {
      "User-Agent": "robot-end-to-end-bot",
    },
  });

  if (!response.ok) {
    throw new Error(`OSRS hiscores request failed: ${response.status} ${response.statusText}.`);
  }

  return parseOsrsHiscoresLite(normalized, endpoint, await response.text());
}

export function formatOsrsHiscoresSkillSummary(snapshot: OsrsHiscoresSnapshot): string {
  const wanted: OsrsHiscoresSkillName[] = ["overall", "mining", "runecraft", "agility", "magic", "hitpoints"];
  const byName = new Map(snapshot.skills.map((skill) => [skill.name, skill]));
  return wanted
    .map((name) => {
      const skill = byName.get(name);
      return skill ? `${name}=${skill.level}` : `${name}=unknown`;
    })
    .join(" ");
}
