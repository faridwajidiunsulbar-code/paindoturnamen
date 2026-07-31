import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { Tournament, Group, Division, Entry, ServiceResult } from '../types';
import { getDbDivisionId } from './divisionService';
import { getValidEntryId } from './entryService';
import { saveTournamentToSupabase } from './tournamentService';

export const getDbGroupId = (id: string, dbDivId: string) => {
  if (!id) return id;
  if (id.includes(dbDivId)) return id;
  return `${id}-${dbDivId}`;
};

/**
 * Checks if group structure is locked due to existing scores, knockout matches, or champions.
 * Schedule creation without scores (hasMatches=true, hasScores=false) does NOT lock groups,
 * but requires explicit confirmation to reset schedule.
 */
export interface GroupLockStatus {
  isLocked: boolean;
  hasMatches: boolean;
  hasScores: boolean;
  hasKnockout: boolean;
  hasChampions: boolean;
  reason?: string;
}

export function checkDivisionGroupLockStatus(division: Division): GroupLockStatus {
  const matches = division.roundRobinMatches || [];
  const hasMatches = matches.length > 0;

  // Strict check: has actual score, finished status, or winner declared
  const hasScores = matches.some(m => {
    const hasActualScore = (m.score1 !== null && m.score1 !== undefined) || (m.score2 !== null && m.score2 !== undefined);
    const isFinished = m.status === 'selesai' || m.status === 'walkover';
    const hasWinner = m.winnerId !== null && m.winnerId !== undefined;
    return hasActualScore || isFinished || hasWinner;
  });

  const hasKnockout = division.knockoutStage !== null && (division.knockoutStage.matches || []).length > 0;
  const hasChampions = division.champions !== null && (
    division.champions.firstPlaceEntryId !== null ||
    division.champions.secondPlaceEntryId !== null ||
    division.champions.thirdPlaceEntryId !== null
  );

  if (hasChampions) {
    return {
      isLocked: true,
      hasMatches,
      hasScores,
      hasKnockout,
      hasChampions,
      reason: 'Turnamen telah selesai dan memiliki Juara. Struktur grup terkunci.'
    };
  }

  if (hasKnockout) {
    return {
      isLocked: true,
      hasMatches,
      hasScores,
      hasKnockout,
      hasChampions,
      reason: 'Fase Knockout (Gugur) telah terbentuk. Struktur grup terkunci.'
    };
  }

  if (hasScores) {
    return {
      isLocked: true,
      hasMatches,
      hasScores,
      hasKnockout,
      hasChampions,
      reason: 'Pertandingan pada fase grup sudah memiliki skor terinput. Struktur grup terkunci untuk menjaga integritas data.'
    };
  }

  return {
    isLocked: false,
    hasMatches,
    hasScores,
    hasKnockout,
    hasChampions
  };
}

export interface GroupValidationResult {
  cleanedGroups: Group[];
  unassignedEntries: Entry[];
  isValid: boolean;
  invalidEntryIds: string[];
  duplicateEntryIds: string[];
  issues: string[];
}

/**
 * Validates group integrity, detects stale entry IDs and duplicate memberships without mutating original source data.
 * Returns proposed clean groups and report of issues.
 */
export function validateAndCleanGroups(groups: Group[], validEntries: Entry[]): GroupValidationResult {
  const validEntryIdSet = new Set(validEntries.map(e => e.id));
  const seenEntryIds = new Set<string>();
  const invalidEntryIds: string[] = [];
  const duplicateEntryIds: string[] = [];
  const issues: string[] = [];

  const cleanedGroups: Group[] = (groups || []).map((g, idx) => {
    const code = String.fromCharCode(65 + idx); // A, B, C...
    const cleanName = `Grup ${code}`;
    const cleanEntryIds: string[] = [];

    (g.entryIds || []).forEach(entId => {
      if (!validEntryIdSet.has(entId)) {
        invalidEntryIds.push(entId);
        issues.push(`ID peserta [${entId}] tidak ditemukan dalam daftar peserta divisi.`);
        return;
      }
      if (seenEntryIds.has(entId)) {
        duplicateEntryIds.push(entId);
        issues.push(`Peserta [${entId}] terdeteksi di lebih dari 1 grup.`);
        return;
      }
      seenEntryIds.add(entId);
      cleanEntryIds.push(entId);
    });

    return {
      ...g,
      name: cleanName,
      entryIds: cleanEntryIds
    };
  });

  const unassignedEntries = validEntries.filter(e => !seenEntryIds.has(e.id));
  const isValid = invalidEntryIds.length === 0 && duplicateEntryIds.length === 0;

  return {
    cleanedGroups,
    unassignedEntries,
    isValid,
    invalidEntryIds,
    duplicateEntryIds,
    issues
  };
}

/**
 * Save division groups and group members to Supabase.
 */
export async function saveGroupsAndMembersToSupabase(
  tournament: Tournament,
  insertedEntryIds: Set<string>
): Promise<ServiceResult<boolean>> {
  if (!isSupabaseConfigured) {
    return {
      success: false,
      error: { module: 'group', operation: 'insert', message: 'Database Cloud (Supabase) belum terkonfigurasi.' }
    };
  }

  try {
    // 1. Fetch existing group IDs for this tournament to delete members safely
    const { data: existingGroups } = await supabase
      .from('division_groups')
      .select('id')
      .eq('tournament_id', tournament.id);

    if (existingGroups && existingGroups.length > 0) {
      const groupIds = existingGroups.map(g => g.id);
      const { error: delGMErr } = await supabase
        .from('group_members')
        .delete()
        .in('group_id', groupIds);
      if (delGMErr) {
        return { success: false, error: { module: 'group', operation: 'delete', message: delGMErr.message, details: JSON.stringify(delGMErr) } };
      }
    }

    // 2. Delete division groups
    const { error: delGroupError } = await supabase.from('division_groups').delete().eq('tournament_id', tournament.id);
    if (delGroupError) {
      return { success: false, error: { module: 'group', operation: 'delete', message: delGroupError.message, details: JSON.stringify(delGroupError) } };
    }

    // 3. Upsert Division Groups
    const validActiveDivisions = tournament.activeDivisions || [];
    const uniqueGroupsMap = new Map<string, any>();

    validActiveDivisions.forEach(div => {
      const dbDivId = getDbDivisionId(div.id, tournament.id);
      div.groups.forEach(g => {
        const dbGrpId = getDbGroupId(g.id, dbDivId);
        const hasManualRankings = g.manualRankings && typeof g.manualRankings === 'object' && Object.keys(g.manualRankings).length > 0;
        uniqueGroupsMap.set(dbGrpId, {
          id: dbGrpId,
          tournament_id: tournament.id,
          division_id: dbDivId,
          name: g.name,
          manual_rankings: hasManualRankings ? g.manualRankings : null,
          manual_ranking_reason: g.manualRankingReason?.trim() || null
        });
      });
    });

    const allGroups = Array.from(uniqueGroupsMap.values());
    if (allGroups.length > 0) {
      const { error: gError } = await supabase.from('division_groups').upsert(allGroups);
      if (gError) {
        return { success: false, error: { module: 'group', operation: 'insert', message: gError.message, details: JSON.stringify(gError) } };
      }

      // 4. Insert Group Members
      const groupMembersMap = new Map<string, any>();
      validActiveDivisions.forEach(div => {
        const dbDivId = getDbDivisionId(div.id, tournament.id);
        div.groups.forEach(g => {
          const dbGrpId = getDbGroupId(g.id, dbDivId);
          g.entryIds.forEach(entId => {
            const cleanedId = getValidEntryId(entId, insertedEntryIds);
            if (cleanedId) {
              const gmKey = `${dbGrpId}_${cleanedId}`;
              groupMembersMap.set(gmKey, {
                group_id: dbGrpId,
                entry_id: cleanedId
              });
            }
          });
        });
      });

      const allGroupMembers = Array.from(groupMembersMap.values());
      if (allGroupMembers.length > 0) {
        const { error: gmError } = await supabase.from('group_members').insert(allGroupMembers);
        if (gmError) {
          return { success: false, error: { module: 'group', operation: 'insert', message: gmError.message, details: JSON.stringify(gmError) } };
        }
      }
    }

    return { success: true, data: true };
  } catch (err: any) {
    return {
      success: false,
      error: {
        module: 'group',
        operation: 'insert',
        message: err?.message || 'Gagal menyimpan grup ke database cloud.',
        details: JSON.stringify(err)
      }
    };
  }
}

/**
 * Load division groups and group members for a tournament.
 */
export async function loadGroupsForTournament(
  tournamentId: string
): Promise<ServiceResult<{ groups: any[]; groupMembers: any[] }>> {
  if (!isSupabaseConfigured) {
    return { success: false, error: { module: 'group', operation: 'load', message: 'Database cloud belum terkonfigurasi.' } };
  }

  try {
    const { data: gData, error: gErr } = await supabase
      .from('division_groups')
      .select('*')
      .eq('tournament_id', tournamentId);
    if (gErr) return { success: false, error: { module: 'group', operation: 'load', message: gErr.message, details: JSON.stringify(gErr) } };

    const groupIds = (gData || []).map(g => g.id);
    let gmData: any[] = [];
    if (groupIds.length > 0) {
      const { data: fetchedGm, error: gmErr } = await supabase
        .from('group_members')
        .select('*')
        .in('group_id', groupIds);
      if (gmErr) return { success: false, error: { module: 'group', operation: 'load', message: gmErr.message, details: JSON.stringify(gmErr) } };
      gmData = fetchedGm || [];
    }

    return {
      success: true,
      data: {
        groups: gData || [],
        groupMembers: gmData
      }
    };
  } catch (err: any) {
    return {
      success: false,
      error: { module: 'group', operation: 'load', message: err?.message || 'Gagal memuat data grup dari cloud.' }
    };
  }
}

/**
 * Service to handle tournament round-robin groups.
 * Ensures consistent group definitions are persistent on Supabase.
 */
export async function updateDivisionGroups(
  tournament: Tournament,
  divisionId: string,
  groups: Group[]
): Promise<boolean> {
  const updatedDivisions = tournament.activeDivisions.map(div => {
    if (div.id === divisionId) {
      return {
        ...div,
        groups
      };
    }
    return div;
  });

  const res = await saveTournamentToSupabase({
    ...tournament,
    activeDivisions: updatedDivisions
  });
  return res.success;
}
