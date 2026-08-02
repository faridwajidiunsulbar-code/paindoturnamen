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
  manualRankings?: Record<string, number>; // entryId -> override rank (1, 2, 3...)
  manualRankingReason?: string; // Reason for manual tie resolution
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

export type ThirdPlaceMode = 'shared_bronze' | 'playoff' | 'none';

export interface DivisionSettings {
  format: 'RR_KO'; // Round Robin + Knockout
  targetScore: 11 | 15 | 21;
  winByTwo: boolean;
  playersPerGroup: 3 | 4 | 5;
  playersQualifyingPerGroup: number; // default 2
  bracketSize: 4 | 8 | 16 | 32;
  wildcardActive: boolean;
  byeActive: boolean;
  thirdPlaceEnabled?: boolean;
  thirdPlaceMode?: ThirdPlaceMode;
}

export interface KnockoutSlot {
  seedNo: number;
  entryId: string | null;
  sourceLabel?: string;
  isWildcard?: boolean;
  isBye?: boolean;
  sourceGroupId?: string;
  sourceGroupName?: string;
  sourceGroupRank?: number;
  qualificationType?: 'group' | 'wildcard' | 'bye';
  wildcardRank?: number;
}

export interface WildcardCandidate {
  entryId: string;
  groupId: string;
  groupName: string;
  groupRank: number;
  won: number;
  played: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifference: number;
  winPercentage: number;
  avgPointsFor: number;
  avgPointDifference: number;
  tieStatus?: boolean;
  eligible: boolean;
  ineligibleReason?: string;
  wildcardRank?: number;
  manualOverrideRank?: number;
}

export type BracketArrangementMode = 'automatic' | 'group_cross' | 'manual';
export type BracketSourceType = 'group_rank' | 'wildcard_rank' | 'bye' | 'manual';

export interface GroupCrossPairing {
  id: string;
  groupOneId: string;
  groupTwoId: string;
  order: number;
}

export interface ManualSlotAssignment {
  seedNo: number;
  sourceType: BracketSourceType;
  sourceGroupId?: string;
  sourceGroupRank?: number;
  wildcardRank?: number;
  manualEntryId?: string | null;
}

export interface KnockoutStage {
  matches: Match[];
  isLocked: boolean; // if true, bracket is locked and we can play; if false, we can rearrange seeds
  confirmedEntryIds: string[]; // Qualified entries in order of seed
  slots?: KnockoutSlot[];
  wildcardCandidates?: WildcardCandidate[];
  wildcardManualRankings?: Record<string, number>;
  wildcardManualReason?: string;
  wildcardManualCluster?: {
    entryIds: string[];
    rankingMode: 'total' | 'normalized';
  };
  invalidatedReason?: string;

  bracketArrangementMode?: BracketArrangementMode;
  groupCrossPairings?: GroupCrossPairing[];
  manualSlotAssignments?: Record<string, ManualSlotAssignment>;
  manualArrangementReason?: string;
  arrangementConfirmedAt?: string;
  arrangementLocked?: boolean;
  arrangementInvalidatedReason?: string;
}

export interface Champions {
  firstPlaceEntryId: string | null;
  secondPlaceEntryId: string | null;
  thirdPlaceEntryId: string | null;
}

export type PodiumPlacement = 1 | 2 | 3 | 4;

export type PodiumSourceType =
  | 'final_winner'
  | 'final_loser'
  | 'semifinal_loser'
  | 'third_place_winner'
  | 'third_place_loser';

export interface PodiumEntry {
  placement: PodiumPlacement;
  entryId: string;
  label: 'Juara' | 'Runner-up' | 'Juara 3' | 'Juara 3 Bersama' | 'Peringkat 4';
  sourceType: PodiumSourceType;
  sourceMatchId: string;
  isShared?: boolean;
}

export interface DivisionPodiumPreview {
  valid: boolean;
  entries: PodiumEntry[];
  errors: string[];
  warnings: string[];
  generatedAt: string;
}

export interface OfficialPodium {
  officialAt: string;
  officialBy?: string | null;
  entries: PodiumEntry[];
  revokedAt?: string | null;
  revokedReason?: string | null;
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
  podiumOfficial?: boolean;
  officialAt?: string | null;
  officialBy?: string | null;
  officialPodium?: OfficialPodium | null;
  revokedAt?: string | null;
  podiumRevokedReason?: string | null;
  status?: 'pending' | 'group_stage' | 'knockout_stage' | 'completed' | 'finalized';
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
  updatedAt?: string;
  cloudSyncedAt?: string;
  cloudUpdatedAt?: string;
  cloudRevision?: number;
  cloudSaveStatus?: 'complete' | 'saving' | 'failed';
}

export type ServiceResult<T> =
  | {
      success: true;
      data: T;
      isConflict?: false;
      partialSave?: false;
    }
  | {
      success: false;
      isConflict?: boolean;
      partialSave?: boolean;
      error: {
        code?: string;
        message: string;
        details?: string;
        module?: string;
        operation?: string;
      };
      conflictDetails?: {
        localRevision: number;
        cloudRevision: number;
        localLoadedAt?: string;
        cloudUpdatedAt?: string;
      };
      partialDetails?: {
        reservedRevision?: number;
        cloudSaveStatus?: 'failed';
      };
    };

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
  tieBreakReason?: string; // Penjelasan alasan urutan/kriteria peringkat
  isTieBoundary?: boolean; // Penanda jika seri terjadi di batas kelolosan
}
