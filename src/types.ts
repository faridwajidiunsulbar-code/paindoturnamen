/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface TournamentEvent {
  id: string;
  name: string;
  isDouble: boolean; // if true, two players per entry, otherwise single
}

export interface AgeGroup {
  id: string;
  name: string;
}

export interface Entry {
  id: string;
  name1: string;
  name2?: string; // empty for Single, filled for Double/Mix
  affiliation?: string; // Club/City (optional)
}

export interface Group {
  id: string; // e.g. "A", "B"
  name: string; // e.g. "Grup A", "Grup B"
  entryIds: string[];
}

export type MatchStatus = 'belum_dimainkan' | 'selesai' | 'walkover';

export type MatchType = 'ROUND_ROBIN' | 'KNOCKOUT';

export interface Match {
  id: string;
  divisionId: string;
  groupName?: string; // for Round Robin (e.g. "Grup A")
  roundName?: string; // for Knockout (e.g. "Perempat Final", "Semifinal", "Final", "Perebutan Juara 3")
  type: MatchType;
  
  // KO specific tracking
  matchNum?: number; // e.g. 1 to N
  nextMatchNum?: number; // matchNum of the next round match
  nextMatchSlot?: 'player1' | 'player2'; // which slot the winner goes to
  isBronzeMatch?: boolean;
  
  entryId1: string | null; // null represents To Be Determined (TBD)
  entryId2: string | null;
  score1: number | null;
  score2: number | null;
  status: MatchStatus;
  winnerId?: string | null;
  loserId?: string | null;
  notes?: string;
}

export interface DivisionSettings {
  format: 'RR_KO'; // Round Robin + Knockout
  targetScore: 11 | 15 | 21;
  winByTwo: boolean;
  playersPerGroup: 3 | 4 | 5;
  playersQualifyingPerGroup: number; // default 2
  bracketSize: 4 | 8 | 16 | 32;
  wildcardActive: boolean;
  byeActive: boolean;
}

export interface KnockoutStage {
  matches: Match[];
  isLocked: boolean; // if true, bracket is locked and we can play; if false, we can rearrange seeds
  confirmedEntryIds: string[]; // Qualified entries in order of seed
}

export interface Champions {
  firstPlaceEntryId: string | null;
  secondPlaceEntryId: string | null;
  thirdPlaceEntryId: string | null;
}

export interface Division {
  id: string; // combination of eventId + ageGroupId (e.g. "ganda_putra-19_plus")
  eventId: string;
  eventName: string;
  ageGroupId: string;
  ageGroupName: string;
  settings: DivisionSettings;
  entries: Entry[];
  groups: Group[];
  roundRobinMatches: Match[];
  knockoutStage: KnockoutStage | null;
  champions: Champions | null;
}

export interface Tournament {
  id: string;
  name: string;
  date: string;
  location: string;
  events: TournamentEvent[];
  ageGroups: AgeGroup[];
  activeDivisions: Division[];
  ownerId?: string;
}

export interface GroupStandingRow {
  entryId: string;
  entryName: string;
  played: number;
  won: number;
  lost: number;
  pointsFor: number; // Poin masuk
  pointsAgainst: number; // Poin kemasukan
  pointDifference: number; // Selisih poin
  rank: number;
  manualOverrideRank?: number; // Admin manual tie-breaker rank
  needsAdminDecision?: boolean; // Penanda jika tie-breaker seri sempurna dan perlu keputusan manual/admin
}
