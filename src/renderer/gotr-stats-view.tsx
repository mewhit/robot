import React, { useMemo, useState } from "react";
import type { GuardianOfTheRiftRunStatsSnapshot } from "../main/guardianOfTheRiftRunStats";

type GotrStatsViewProps = {
  snapshot: GuardianOfTheRiftRunStatsSnapshot | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
};

type RunStatsRow = Record<string, string>;

const PRIMARY_COLUMNS = [
  "startedAt",
  "versionName",
  "status",
  "greatGuardianVerified",
  "greatGuardianClicks",
  "estimatedRunesConfirmedUpper",
  "salmonPortalConfirmations",
  "salmonPortalClicks",
  "durationMs",
  "workbenchTotalMs",
  "salmonMiningTotalMs",
  "altarTotalMs",
  "redPortalMisses",
  "guardianNoTargetScans",
  "objectMissCounts",
] as const;

const DETAIL_COLUMNS = [
  "sessionId",
  "runIndex",
  "runTimerWhiteAt",
  "firstSalmonSpawnAt",
  "secondSalmonSpawnAt",
  "thirdSalmonSpawnAt",
  "runEndDetectedAt",
  "pouchesDetected",
  "runecraftLevel",
  "colossalCapacity",
  "activeRuneChanges",
  "activeRuneTimerAvgMs",
  "guardianTimerRefusals",
  "cameraRotateCount",
  "altarEnterAt",
  "altarExitAt",
  "workbenchStartAt",
  "workbenchEndAt",
  "salmonMiningStartAt",
  "salmonMiningEndAt",
] as const;

function isNullValue(value: string | undefined): boolean {
  return !value || value === "null";
}

function toNumber(value: string | undefined): number | null {
  if (isNullValue(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMs(value: string | undefined): string {
  const ms = toNumber(value);
  if (ms === null) {
    return "null";
  }

  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDateTime(value: string | undefined): string {
  if (isNullValue(value)) {
    return "null";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value ?? "null";
  }

  return date.toLocaleString("en-CA", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatCell(column: string, value: string | undefined): string {
  if (isNullValue(value)) {
    return "null";
  }

  if (column.endsWith("At") || column === "startedAt" || column === "endedAt") {
    return formatDateTime(value);
  }

  if (column.endsWith("Ms") || column === "durationMs") {
    return formatMs(value);
  }

  return value ?? "null";
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatAverage(value: number | null, suffix = ""): string {
  if (value === null || !Number.isFinite(value)) {
    return "null";
  }

  return `${value.toFixed(1)}${suffix}`;
}

function getUniqueOptions(rows: RunStatsRow[], key: string): string[] {
  return Array.from(new Set(rows.map((row) => row[key]).filter((value) => !isNullValue(value)))).sort();
}

export default function GotrStatsView({ snapshot, isLoading, error, onRefresh }: GotrStatsViewProps) {
  const [versionFilter, setVersionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const rows = snapshot?.rows ?? [];
  const versions = useMemo(() => getUniqueOptions(rows, "versionName"), [rows]);
  const statuses = useMemo(() => getUniqueOptions(rows, "status"), [rows]);

  const filteredRows = useMemo(() => {
    const search = searchText.trim().toLowerCase();
    return rows.filter((row) => {
      if (versionFilter !== "all" && row.versionName !== versionFilter) {
        return false;
      }

      if (statusFilter !== "all" && row.status !== statusFilter) {
        return false;
      }

      if (!search) {
        return true;
      }

      return Object.values(row).some((value) => value.toLowerCase().includes(search));
    });
  }, [rows, searchText, statusFilter, versionFilter]);

  const selectedRow = useMemo(() => {
    if (filteredRows.length === 0) {
      return null;
    }

    return (
      filteredRows.find((row) => `${row.sessionId}-${row.runIndex}` === selectedSessionId) ??
      filteredRows[filteredRows.length - 1]
    );
  }, [filteredRows, selectedSessionId]);

  const summary = useMemo(() => {
    const cleanRuns = filteredRows.filter((row) => row.status === "clean_complete").length;
    const guardianVerified = filteredRows.map((row) => toNumber(row.greatGuardianVerified)).filter((value): value is number => value !== null);
    const guardianClicks = filteredRows.map((row) => toNumber(row.greatGuardianClicks)).filter((value): value is number => value !== null);
    const runes = filteredRows
      .map((row) => toNumber(row.estimatedRunesConfirmedUpper))
      .filter((value): value is number => value !== null);
    const durations = filteredRows.map((row) => toNumber(row.durationMs)).filter((value): value is number => value !== null);
    const salmonConfirmations = filteredRows
      .map((row) => toNumber(row.salmonPortalConfirmations))
      .filter((value): value is number => value !== null);

    return {
      runCount: filteredRows.length,
      cleanRuns,
      avgGuardianVerified: average(guardianVerified),
      bestGuardianVerified: guardianVerified.length > 0 ? Math.max(...guardianVerified) : null,
      avgGuardianClicks: average(guardianClicks),
      avgRunes: average(runes),
      avgDurationMs: average(durations),
      avgSalmonConfirmations: average(salmonConfirmations),
    };
  }, [filteredRows]);

  return (
    <div className="gotr-stats-view">
      <div className="gotr-stats-toolbar">
        <div className="gotr-stats-title-block">
          <h2 className="gotr-stats-title">Guardian stats</h2>
          <p className="gotr-stats-path">{snapshot?.path ?? "automate-bot-logs/guardian-of-the-rift-run-stats.csv"}</p>
        </div>
        <button type="button" className="gotr-stats-refresh" onClick={onRefresh} disabled={isLoading}>
          {isLoading ? "Loading" : "Refresh"}
        </button>
      </div>

      {error && <p className="gotr-stats-error">{error}</p>}
      {snapshot && !snapshot.exists && <p className="gotr-stats-error">CSV stats file not found.</p>}

      <div className="gotr-stats-filters">
        <label className="gotr-stats-filter">
          <span>Version</span>
          <select value={versionFilter} onChange={(e) => setVersionFilter(e.target.value)}>
            <option value="all">All</option>
            {versions.map((version) => (
              <option key={version} value={version}>
                {version}
              </option>
            ))}
          </select>
        </label>
        <label className="gotr-stats-filter">
          <span>Status</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="gotr-stats-filter gotr-stats-search">
          <span>Search</span>
          <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="session, miss, status..." />
        </label>
        <span className="gotr-stats-modified">
          Updated: {snapshot?.lastModifiedAt ? formatDateTime(snapshot.lastModifiedAt) : "null"}
        </span>
      </div>

      <div className="gotr-stats-summary">
        <div className="gotr-stats-metric">
          <span>Runs</span>
          <strong>{summary.runCount}</strong>
        </div>
        <div className="gotr-stats-metric">
          <span>Clean</span>
          <strong>{summary.cleanRuns}</strong>
        </div>
        <div className="gotr-stats-metric">
          <span>Guardian avg</span>
          <strong>{formatAverage(summary.avgGuardianVerified)}</strong>
        </div>
        <div className="gotr-stats-metric">
          <span>Guardian best</span>
          <strong>{summary.bestGuardianVerified ?? "null"}</strong>
        </div>
        <div className="gotr-stats-metric">
          <span>Clicks avg</span>
          <strong>{formatAverage(summary.avgGuardianClicks)}</strong>
        </div>
        <div className="gotr-stats-metric">
          <span>Runes avg</span>
          <strong>{formatAverage(summary.avgRunes)}</strong>
        </div>
        <div className="gotr-stats-metric">
          <span>Salmon avg</span>
          <strong>{formatAverage(summary.avgSalmonConfirmations)}</strong>
        </div>
        <div className="gotr-stats-metric">
          <span>Duration avg</span>
          <strong>{summary.avgDurationMs === null ? "null" : formatMs(String(Math.round(summary.avgDurationMs)))}</strong>
        </div>
      </div>

      <div className="gotr-stats-content">
        <div className="gotr-stats-table-wrap">
          <table className="gotr-stats-table">
            <thead>
              <tr>
                {PRIMARY_COLUMNS.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={PRIMARY_COLUMNS.length}>No rows.</td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const key = `${row.sessionId}-${row.runIndex}`;
                  return (
                    <tr
                      key={key}
                      className={selectedRow === row ? "selected" : ""}
                      onClick={() => setSelectedSessionId(key)}
                    >
                      {PRIMARY_COLUMNS.map((column) => (
                        <td key={column}>{formatCell(column, row[column])}</td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <aside className="gotr-stats-detail">
          <h3>Run detail</h3>
          {selectedRow ? (
            <dl>
              {DETAIL_COLUMNS.map((column) => (
                <React.Fragment key={column}>
                  <dt>{column}</dt>
                  <dd>{formatCell(column, selectedRow[column])}</dd>
                </React.Fragment>
              ))}
            </dl>
          ) : (
            <p>No selected run.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
