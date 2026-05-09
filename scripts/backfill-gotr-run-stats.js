const fs = require("fs");
const path = require("path");

const LOG_DIR = path.resolve("automate-bot-logs");
const OUTPUT_CSV = path.join(LOG_DIR, "guardian-of-the-rift-run-stats.csv");

const COLUMNS = [
  "sessionId",
  "runIndex",
  "versionName",
  "status",
  "stopSource",
  "stopReason",
  "startedAt",
  "endedAt",
  "durationMs",
  "runTimerWhiteAt",
  "firstSalmonSpawnAt",
  "secondSalmonSpawnAt",
  "thirdSalmonSpawnAt",
  "runEndDetectedAt",
  "pouchesDetected",
  "pouchesDetectedCount",
  "runecraftLevel",
  "colossalCapacity",
  "greatGuardianVerified",
  "greatGuardianClicks",
  "altarLoopsConfirmed",
  "estimatedRunesConfirmedLower",
  "estimatedRunesConfirmedUpper",
  "estimatedRunesPendingLower",
  "estimatedRunesPendingUpper",
  "salmonPortalClicks",
  "salmonPortalConfirmations",
  "chargedCellAttempts",
  "chargedCellVerified",
  "workbenchClicks",
  "workbenchFallbackCount",
  "workbenchTotalMs",
  "salmonMiningTotalMs",
  "altarTotalMs",
  "redPortalSearches",
  "redPortalMisses",
  "redPortalTotalMs",
  "activeRuneChanges",
  "activeRuneTimerAvgMs",
  "guardianTimerRefusals",
  "guardianNoTargetScans",
  "cameraRotateCount",
  "objectMissCounts",
  "altarEnterAt",
  "altarExitAt",
  "altarClickAt",
  "workbenchStartAt",
  "workbenchEndAt",
  "salmonMiningStartAt",
  "salmonMiningEndAt",
  "greatGuardianClickAt",
  "greatGuardianConfirmedAt",
  "chargedCellClickAt",
  "chargedCellConfirmedAt",
  "runeDepositClickAt",
  "runeDepositConfirmedAt",
];

function csvEscape(value) {
  const text = value === undefined || value === null || value === "" ? "null" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseHeader(lines) {
  const header = {};
  for (const line of lines) {
    if (line.trim() === "") {
      break;
    }

    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (match) {
      header[match[1]] = match[2];
    }
  }

  return header;
}

function createLineTimeResolver(startedAtIso) {
  const startDate = new Date(startedAtIso);
  let currentDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  let lastMs = null;

  return (line) => {
    const match = /^\[(\d{2}):(\d{2}):(\d{2})\]/.exec(line);
    if (!match) {
      return null;
    }

    const [, hh, mm, ss] = match;
    let date = new Date(currentDay);
    date.setHours(Number(hh), Number(mm), Number(ss), 0);
    let ms = date.getTime();
    if (lastMs !== null && ms + 60_000 < lastMs) {
      currentDay = new Date(currentDay.getTime() + 24 * 60 * 60 * 1000);
      date = new Date(currentDay);
      date.setHours(Number(hh), Number(mm), Number(ss), 0);
      ms = date.getTime();
    }

    lastMs = ms;
    return ms;
  };
}

function iso(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "null";
}

function joinIso(values) {
  return values.length > 0 ? values.map(iso).join("|") : null;
}

function joinIntervalStart(intervals) {
  return intervals.length > 0 ? intervals.map((interval) => iso(interval.startMs)).join("|") : null;
}

function joinIntervalEnd(intervals) {
  return intervals.length > 0 ? intervals.map((interval) => iso(interval.endMs)).join("|") : null;
}

function intervalTotalMs(intervals, fallbackEndMs) {
  return intervals.reduce((sum, interval) => {
    const endMs = Number.isFinite(interval.endMs) ? interval.endMs : fallbackEndMs;
    return sum + Math.max(0, endMs - interval.startMs);
  }, 0);
}

function startInterval(intervals, ms, minGapMs = 0) {
  const last = intervals[intervals.length - 1];
  if (last && last.endMs === null) {
    return;
  }

  if (last && ms - (last.endMs ?? last.startMs) < minGapMs) {
    return;
  }

  intervals.push({ startMs: ms, endMs: null });
}

function endInterval(intervals, ms) {
  const last = intervals[intervals.length - 1];
  if (!last || last.endMs !== null) {
    return;
  }

  last.endMs = ms;
}

function pushTimestamp(list, ms, minGapMs = 0) {
  const last = list[list.length - 1];
  if (last !== undefined && ms - last < minGapMs) {
    return;
  }

  list.push(ms);
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function parseRange(text) {
  if (!text) {
    return [0, 0];
  }

  const match = /(\d+)(?:-(\d+))?/.exec(text);
  if (!match) {
    return [0, 0];
  }

  const lower = Number(match[1]);
  const upper = match[2] ? Number(match[2]) : lower;
  return [lower, upper];
}

function parseFooter(lines) {
  const footer = {};
  for (const line of lines) {
    if (line.startsWith("status=")) {
      footer.statusLine = line;
    } else if (line.startsWith("greatGuardian=")) {
      footer.greatGuardianLine = line;
    } else if (line.startsWith("altarRunes=")) {
      footer.altarRunesLine = line;
    } else if (line.startsWith("workbench=")) {
      footer.workbenchLine = line;
    } else if (line.startsWith("redPortal=")) {
      footer.redPortalLine = line;
    } else if (line.startsWith("salmon=")) {
      footer.salmonLine = line;
    } else if (line.startsWith("chargedCell=")) {
      footer.chargedCellLine = line;
    } else if (line.startsWith("activeRuneTimer=")) {
      footer.activeRuneTimerLine = line;
    } else if (line.startsWith("guardian=")) {
      footer.guardianLine = line;
    }
  }

  return footer;
}

function parseLogFile(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const header = parseHeader(lines);
  const resolveLineTime = createLineTimeResolver(header.startedAt);
  const startedMs = Date.parse(header.startedAt);
  const endedMs = Date.parse(header.endedAt);
  const fallbackEndMs = Number.isFinite(endedMs) ? endedMs : Date.now();
  const footer = parseFooter(lines);

  const stats = {
    pouchesDetected: [],
    runTimerWhiteAt: null,
    portalOpenAt: [],
    runEndDetectedAt: null,
    altarIntervals: [],
    altarClickAt: [],
    workbenchIntervals: [],
    salmonMiningIntervals: [],
    greatGuardianClickAt: [],
    greatGuardianConfirmedAt: [],
    chargedCellClickAt: [],
    chargedCellConfirmedAt: [],
    runeDepositClickAt: [],
    runeDepositConfirmedAt: [],
    activeRuneChangeAt: [],
    objectMissCounts: {},
    cameraRotateCount: 0,
    greatGuardianClicks: 0,
    greatGuardianVerified: 0,
    salmonPortalClicks: 0,
    salmonPortalConfirmations: 0,
    chargedCellAttempts: 0,
    chargedCellVerified: 0,
    workbenchClicks: 0,
    workbenchFallbackCount: 0,
    redPortalSearches: 0,
    redPortalMisses: 0,
    redPortalTotalMs: 0,
    altarLoopsConfirmed: 0,
    estimatedRunesConfirmedLower: 0,
    estimatedRunesConfirmedUpper: 0,
    estimatedRunesPendingLower: 0,
    estimatedRunesPendingUpper: 0,
    activeRuneTimerAvgMs: 0,
    guardianTimerRefusals: 0,
    guardianNoTargetScans: 0,
    runecraftLevel: null,
    colossalCapacity: null,
  };

  for (const line of lines) {
    const ms = resolveLineTime(line);
    if (ms === null) {
      continue;
    }

    const lower = line.toLowerCase();

    const pouchSummaryMatch = /Startup pouch check summary: found \d+\/\d+ pouch\(es\)(?: \(([^)]+)\))?/.exec(line);
    if (pouchSummaryMatch) {
      stats.pouchesDetected = pouchSummaryMatch[1] ? pouchSummaryMatch[1].split(/,\s*/) : [];
    }

    const configMatch = /runecraftLevel=(\d+), colossal=(?:capacity=(\d+)|unavailable)/.exec(line);
    if (configMatch) {
      stats.runecraftLevel = Number(configMatch[1]);
      stats.colossalCapacity = configMatch[2] ? Number(configMatch[2]) : 0;
    }

    if (line.includes("Mining status turned green") && line.includes("time-since-portal (color=white")) {
      stats.runTimerWhiteAt ??= ms;
    }

    if (line.includes("Guardian Power bar is grey/empty") || line.includes("End-of-round rune deposit complete")) {
      stats.runEndDetectedAt ??= ms;
    }

    if (line.includes("Active guardian rune timer changed:")) {
      pushTimestamp(stats.activeRuneChangeAt, ms, 1_000);
    }

    if (line.includes("Open portal icon detected")) {
      pushTimestamp(stats.portalOpenAt, ms, 45_000);
    }

    if (line.includes("Teleport confirmed: region changed from")) {
      startInterval(stats.altarIntervals, ms, 1_000);
    }

    if (line.includes("Clicked randomized pixel inside yellow altar marker")) {
      stats.altarClickAt.push(ms);
    }

    if (line.includes("Return teleport confirmed")) {
      endInterval(stats.altarIntervals, ms);
    }

    if (line.includes("Clicked middle of magenta workbench marker") || line.includes("clicked cached magenta workbench marker")) {
      stats.workbenchClicks += 1;
      startInterval(stats.workbenchIntervals, ms, 1_000);
    }

    if (
      line.includes("Inventory is full after workbench") ||
      (line.includes("Open portal icon detected during workbench loop") && line.includes("taking salmon portal")) ||
      line.includes("through the crafting wait deadline")
    ) {
      endInterval(stats.workbenchIntervals, ms);
    }

    if (line.includes("Portal arrival confirmed at tile") || line.includes("Salmon-arrival recovery confirmed tile")) {
      stats.salmonPortalConfirmations += 1;
      startInterval(stats.salmonMiningIntervals, ms, 1_000);
    }

    if (
      line.includes("Inventory is full after portal mining") ||
      line.includes("While searching for the salmon exit portal, coordinate already confirms we left portal mining") ||
      line.includes("While searching for the salmon exit portal, coordinate read outside region")
    ) {
      endInterval(stats.salmonMiningIntervals, ms);
    }

    if (line.includes("Clicked interior of blue great guardian outline")) {
      stats.greatGuardianClicks += 1;
      stats.greatGuardianClickAt.push(ms);
    }

    if (
      line.includes("Great guardian inventory verified:") ||
      line.includes("Post-portal Great Guardian deposit verified:") ||
      line.includes("End-of-round Great Guardian deposit verified:")
    ) {
      stats.greatGuardianVerified += 1;
      stats.greatGuardianConfirmedAt.push(ms);
    }

    if (
      lower.includes("ffff5e7e portal marker") &&
      (lower.includes("waiting before checking the orange mining marker") ||
        lower.includes("waiting again before checking the orange mining marker") ||
        lower.includes("waiting again before recovery checks"))
    ) {
      stats.salmonPortalClicks += 1;
    }

    if (lower.includes("clicked center-right of charged cell deposit marker")) {
      stats.chargedCellAttempts += 1;
      stats.chargedCellClickAt.push(ms);
    }

    if (
      line.includes("Charged cell deposit inventory verified:") ||
      line.includes("Post-portal charged cell deposit verified:") ||
      line.includes("End-of-round charged cell deposit verified:")
    ) {
      stats.chargedCellVerified += 1;
      stats.chargedCellConfirmedAt.push(ms);
    }

    if (line.includes("clicked lower right-biased point of stable rune deposit marker")) {
      stats.runeDepositClickAt.push(ms);
    }

    if (line.includes("Rune deposit verified:") || line.includes("End-of-round rune deposit complete")) {
      stats.runeDepositConfirmedAt.push(ms);
    }

    if (line.includes("No FFFF0000 red portal marker was found")) {
      stats.redPortalMisses += 1;
      increment(stats.objectMissCounts, "redPortal");
    }

    if (
      line.includes("No FFFF5E7E portal marker found yet") ||
      line.includes("Still in portal-mining zone after salmon portal click") ||
      line.includes("Salmon portal arrival tile") ||
      line.includes("Salmon-arrival recovery did not confirm")
    ) {
      increment(stats.objectMissCounts, "salmonPortal");
    }

    if (line.includes("Charged cell deposit inventory did not reach expected") || line.includes("No charged cell deposit marker found yet")) {
      increment(stats.objectMissCounts, "chargedCellDeposit");
    }

    if (line.includes("Guardian decision:") && line.includes("chosen=none")) {
      increment(stats.objectMissCounts, "guardian");
      stats.guardianNoTargetScans += 1;
    }

    if (line.includes("Refusing guardian click") || line.includes("Refusing guardian re-click")) {
      stats.guardianTimerRefusals += 1;
    }

    if (line.includes("No magenta workbench marker found")) {
      increment(stats.objectMissCounts, "workbench");
    }

    if (line.includes("Altar marker not visible") || line.includes("no altar marker was found") || line.includes("altar marker is not visible")) {
      increment(stats.objectMissCounts, "altar");
    }

    if (line.includes("No rune deposit marker found") || line.includes("Rune deposit did not increase")) {
      increment(stats.objectMissCounts, "runeDeposit");
    }

    if (line.includes("No usable FFFFFFFF repair NPC marker") || line.includes("rejecting that repair marker")) {
      increment(stats.objectMissCounts, "repairNpc");
    }

    if (line.includes("tapped 'a' to rotate camera") || line.includes("Tapped 'a' to rotate camera")) {
      stats.cameraRotateCount += 1;
    }

    if (line.includes("Inventory free-space stayed at") && line.includes("through the crafting wait deadline")) {
      stats.workbenchFallbackCount += 1;
    }
  }

  const statusMatch = footer.statusLine && /^status=([^\s]+)/.exec(footer.statusLine);
  const ggMatch = footer.greatGuardianLine && /greatGuardian=(\d+)\/(\d+)/.exec(footer.greatGuardianLine);
  const altarMatch =
    footer.altarRunesLine &&
    /confirmed:([^\s]+) cycles:(\d+).*pending:([^\s]+)/.exec(footer.altarRunesLine);
  const workbenchMatch = footer.workbenchLine && /clicks:(\d+) fallback:(\d+)/.exec(footer.workbenchLine);
  const redPortalMatch = footer.redPortalLine && /searches:(\d+) misses:(\d+) total:(\d+(?:\.\d+)?)s/.exec(footer.redPortalLine);
  const salmonMatch = footer.salmonLine && /portalClicks:(\d+) confirmations:(\d+)/.exec(footer.salmonLine);
  const chargedMatch = footer.chargedCellLine && /attempts:(\d+) verified:(\d+)/.exec(footer.chargedCellLine);
  const activeRuneMatch = footer.activeRuneTimerLine && /samples:(\d+) avg:(\d+(?:\.\d+)?)s/.exec(footer.activeRuneTimerLine);
  const guardianMatch = footer.guardianLine && /initialNoTarget:(\d+) timerRefusals:(\d+).*reclickNoTarget:(\d+) reclickTimerRefusals:(\d+)/.exec(footer.guardianLine);

  if (ggMatch) {
    stats.greatGuardianVerified = Number(ggMatch[1]);
    stats.greatGuardianClicks = Number(ggMatch[2]);
  }

  if (altarMatch) {
    const confirmed = parseRange(altarMatch[1]);
    const pending = parseRange(altarMatch[3]);
    stats.estimatedRunesConfirmedLower = confirmed[0];
    stats.estimatedRunesConfirmedUpper = confirmed[1];
    stats.altarLoopsConfirmed = Number(altarMatch[2]);
    stats.estimatedRunesPendingLower = pending[0];
    stats.estimatedRunesPendingUpper = pending[1];
  }

  if (workbenchMatch) {
    stats.workbenchClicks = Number(workbenchMatch[1]);
    stats.workbenchFallbackCount = Number(workbenchMatch[2]);
  }

  if (redPortalMatch) {
    stats.redPortalSearches = Number(redPortalMatch[1]);
    stats.redPortalMisses = Number(redPortalMatch[2]);
    stats.redPortalTotalMs = Math.round(Number(redPortalMatch[3]) * 1000);
  }

  if (salmonMatch) {
    stats.salmonPortalClicks = Number(salmonMatch[1]);
    stats.salmonPortalConfirmations = Number(salmonMatch[2]);
  }

  if (chargedMatch) {
    stats.chargedCellAttempts = Number(chargedMatch[1]);
    stats.chargedCellVerified = Number(chargedMatch[2]);
  }

  if (activeRuneMatch) {
    stats.activeRuneTimerAvgMs = Math.round(Number(activeRuneMatch[2]) * 1000);
  }

  if (guardianMatch) {
    stats.guardianNoTargetScans = Number(guardianMatch[1]) + Number(guardianMatch[3]);
    stats.guardianTimerRefusals = Number(guardianMatch[2]) + Number(guardianMatch[4]);
  }

  const status = statusMatch ? statusMatch[1] : header.stopSource ? `stopped_${header.stopSource}` : null;
  const objectMissCounts = Object.entries(stats.objectMissCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join("|");

  return {
    sessionId: header.sessionId,
    runIndex: Number(header.runIndex) || null,
    versionName: header.versionName || null,
    status,
    stopSource: header.stopSource || null,
    stopReason: header.stopReason || null,
    startedAt: header.startedAt || null,
    endedAt: header.endedAt || null,
    durationMs: Number.isFinite(startedMs) && Number.isFinite(endedMs) ? Math.max(0, endedMs - startedMs) : null,
    runTimerWhiteAt: iso(stats.runTimerWhiteAt),
    firstSalmonSpawnAt: iso(stats.portalOpenAt[0]),
    secondSalmonSpawnAt: iso(stats.portalOpenAt[1]),
    thirdSalmonSpawnAt: iso(stats.portalOpenAt[2]),
    runEndDetectedAt: iso(stats.runEndDetectedAt),
    pouchesDetected: stats.pouchesDetected.length > 0 ? stats.pouchesDetected.join("|") : null,
    pouchesDetectedCount: stats.pouchesDetected.length || null,
    runecraftLevel: stats.runecraftLevel,
    colossalCapacity: stats.colossalCapacity,
    greatGuardianVerified: stats.greatGuardianVerified,
    greatGuardianClicks: stats.greatGuardianClicks,
    altarLoopsConfirmed: stats.altarLoopsConfirmed,
    estimatedRunesConfirmedLower: stats.estimatedRunesConfirmedLower,
    estimatedRunesConfirmedUpper: stats.estimatedRunesConfirmedUpper,
    estimatedRunesPendingLower: stats.estimatedRunesPendingLower,
    estimatedRunesPendingUpper: stats.estimatedRunesPendingUpper,
    salmonPortalClicks: stats.salmonPortalClicks,
    salmonPortalConfirmations: stats.salmonPortalConfirmations,
    chargedCellAttempts: stats.chargedCellAttempts,
    chargedCellVerified: stats.chargedCellVerified,
    workbenchClicks: stats.workbenchClicks,
    workbenchFallbackCount: stats.workbenchFallbackCount,
    workbenchTotalMs: Math.round(intervalTotalMs(stats.workbenchIntervals, fallbackEndMs)) || null,
    salmonMiningTotalMs: Math.round(intervalTotalMs(stats.salmonMiningIntervals, fallbackEndMs)) || null,
    altarTotalMs: Math.round(intervalTotalMs(stats.altarIntervals, fallbackEndMs)) || null,
    redPortalSearches: stats.redPortalSearches,
    redPortalMisses: stats.redPortalMisses,
    redPortalTotalMs: stats.redPortalTotalMs,
    activeRuneChanges: stats.activeRuneChangeAt.length || null,
    activeRuneTimerAvgMs: stats.activeRuneTimerAvgMs || null,
    guardianTimerRefusals: stats.guardianTimerRefusals,
    guardianNoTargetScans: stats.guardianNoTargetScans,
    cameraRotateCount: stats.cameraRotateCount,
    objectMissCounts: objectMissCounts || null,
    altarEnterAt: joinIntervalStart(stats.altarIntervals),
    altarExitAt: joinIntervalEnd(stats.altarIntervals),
    altarClickAt: joinIso(stats.altarClickAt),
    workbenchStartAt: joinIntervalStart(stats.workbenchIntervals),
    workbenchEndAt: joinIntervalEnd(stats.workbenchIntervals),
    salmonMiningStartAt: joinIntervalStart(stats.salmonMiningIntervals),
    salmonMiningEndAt: joinIntervalEnd(stats.salmonMiningIntervals),
    greatGuardianClickAt: joinIso(stats.greatGuardianClickAt),
    greatGuardianConfirmedAt: joinIso(stats.greatGuardianConfirmedAt),
    chargedCellClickAt: joinIso(stats.chargedCellClickAt),
    chargedCellConfirmedAt: joinIso(stats.chargedCellConfirmedAt),
    runeDepositClickAt: joinIso(stats.runeDepositClickAt),
    runeDepositConfirmedAt: joinIso(stats.runeDepositConfirmedAt),
  };
}

function main() {
  if (!fs.existsSync(LOG_DIR)) {
    throw new Error(`Log directory not found: ${LOG_DIR}`);
  }

  const rows = fs
    .readdirSync(LOG_DIR)
    .filter((name) => name.endsWith(".log") && name.includes("runecrafting-guardian-of-the-rift"))
    .sort()
    .map((name) => parseLogFile(path.join(LOG_DIR, name)));

  const csv = [COLUMNS.join(","), ...rows.map((row) => COLUMNS.map((column) => csvEscape(row[column])).join(","))].join("\n");
  fs.writeFileSync(OUTPUT_CSV, `${csv}\n`, "utf8");
  console.log(`Wrote ${rows.length} Guardian of the Rift run stat row(s) to ${OUTPUT_CSV}`);
}

main();
