export type Gender = "boy" | "girl";
export type Position =
  | "offense"
  | "midfield"
  | "defense"
  | "goalie"
  | "LD"
  | "CD"
  | "RD"
  | "LM"
  | "RM"
  | "LF"
  | "CF"
  | "RF";

export type Player = {
  id: string;
  name: string;
  gender: Gender;
  skillRating: number;
  willingGoalie: boolean;
  preferredPositions: Position[];
  notes?: string;
  active: boolean;
};

export type GamePlayerStatus = {
  playerId: string;
  present: boolean;
  limitedMinutes: boolean;
  unavailable: boolean;
  goalieToday: boolean;
  goals: number;
  outFromShiftIndex?: number;
  note?: string;
};

export type Formation = {
  offense: number;
  midfield: number;
  defense: number;
  goalie: number;
};

export type GameSettings = {
  quarters: number;
  shiftsPerQuarter: number;
  formation: Formation;
  targetMinGirlsOnField: number;
  targetMaxGirlsOnField: number;
  balanceSkill: boolean;
  balancePlayingTime: boolean;
  rotateGoalie: boolean;
  opponent: string;
  gameDate: string;
  homeScore: number;
  awayScore: number;
};

export type ShiftLineup = {
  id: string;
  quarter: number;
  shiftInQuarter: number;
  shiftIndex: number;
  offense: string[];
  midfield: string[];
  defense: string[];
  goalie: string | null;
  bench: string[];
  locked: boolean;
  warnings: string[];
};

export type SavedLineup = {
  id: string;
  name: string;
  shifts: ShiftLineup[];
  createdAt: string;
};

export type AppExportPayload = {
  roster: Player[];
  gameStatus: GamePlayerStatus[];
  settings: GameSettings;
  savedLineups: SavedLineup[];
};
