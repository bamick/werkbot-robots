import type { GamePlayerStatus, GameSettings, Player } from "./types";
import rosterData from "../../werkbot-robots-roster.json";

type RosterJson = {
  roster: Player[];
};

export const defaultGameSettings: GameSettings = {
  quarters: 4,
  shiftsPerQuarter: 2,
  formation: {
    offense: 3,
    midfield: 2,
    defense: 3,
    goalie: 1,
  },
  targetMinGirlsOnField: 2,
  targetMaxGirlsOnField: 3,
  balanceSkill: true,
  balancePlayingTime: true,
  rotateGoalie: true,
  opponent: "",
  gameDate: "",
  homeScore: 0,
  awayScore: 0,
};

export const defaultRoster: Player[] = (rosterData as RosterJson).roster;

export function normalizeGameSettings(settings: Partial<GameSettings>): GameSettings {
  return {
    ...defaultGameSettings,
    ...settings,
    formation: {
      ...defaultGameSettings.formation,
      ...(settings.formation ?? {}),
    },
  };
}

export function createInitialGameStatus(roster: Player[]): GamePlayerStatus[] {
  return roster.map((player) => ({
    playerId: player.id,
    present: true,
    limitedMinutes: false,
    unavailable: false,
    goalieToday: player.willingGoalie,
    goals: 0,
  }));
}

export function syncGameStatus(
  currentStatus: GamePlayerStatus[],
  roster: Player[],
): GamePlayerStatus[] {
  const statusMap = new Map(currentStatus.map((status) => [status.playerId, status]));
  return roster.map((player) => {
    const existing = statusMap.get(player.id);
    if (existing) {
      return {
        ...existing,
        goalieToday: existing.goalieToday ?? player.willingGoalie,
        goals: existing.goals ?? 0,
      };
    }
    return {
      playerId: player.id,
      present: true,
      limitedMinutes: false,
      unavailable: false,
      goalieToday: player.willingGoalie,
      goals: 0,
    };
  });
}
