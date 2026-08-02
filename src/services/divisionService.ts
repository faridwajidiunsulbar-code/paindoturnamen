import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { Tournament, Division, TournamentEvent, AgeGroup, ServiceResult } from '../types';
import { saveTournamentToSupabase } from './tournamentService';
import { getDbGroupId } from './groupService';

export const getDbEventId = (id: string, tournamentId: string) => {
  if (!id) return id;
  if (id.includes(tournamentId)) return id;
  return `${id}-${tournamentId}`;
};

export const getDbAgeGroupId = (id: string, tournamentId: string) => {
  if (!id) return id;
  if (id.includes(tournamentId)) return id;
  return `${id}-${tournamentId}`;
};

export const getDbDivisionId = (id: string, tournamentId: string) => {
  if (!id) return id;
  if (id.includes(tournamentId)) return id;
  return `${id}-${tournamentId}`;
};

/**
 * Save divisions, match types, and age groups to Supabase.
 */
export async function saveDivisionsToSupabase(tournament: Tournament): Promise<ServiceResult<boolean>> {
  if (!isSupabaseConfigured) {
    return {
      success: false,
      error: { module: 'division', operation: 'insert', message: 'Database Cloud (Supabase) belum terkonfigurasi.' }
    };
  }

  try {
    // 1. Delete old divisions, match types, and age groups for cleanup
    const { error: delDivErr } = await supabase.from('divisions').delete().eq('tournament_id', tournament.id);
    if (delDivErr) {
      return { success: false, error: { module: 'division', operation: 'delete', message: delDivErr.message, details: JSON.stringify(delDivErr) } };
    }

    const { error: delMTErr } = await supabase.from('match_types').delete().eq('tournament_id', tournament.id);
    if (delMTErr) {
      return { success: false, error: { module: 'division', operation: 'delete', message: delMTErr.message, details: JSON.stringify(delMTErr) } };
    }

    const { error: delAGErr } = await supabase.from('age_groups').delete().eq('tournament_id', tournament.id);
    if (delAGErr) {
      return { success: false, error: { module: 'division', operation: 'delete', message: delAGErr.message, details: JSON.stringify(delAGErr) } };
    }

    // 2. Prepare Match Types
    const uniqueEventsMap = new Map<string, any>();
    if (tournament.events && tournament.events.length > 0) {
      tournament.events.forEach(ev => {
        const dbId = getDbEventId(ev.id, tournament.id);
        uniqueEventsMap.set(dbId, {
          id: dbId,
          tournament_id: tournament.id,
          name: ev.name,
          is_double: ev.isDouble,
          format_type: 'RR_KO'
        });
      });
    }

    // 3. Prepare Age Groups
    const uniqueAgeGroupsMap = new Map<string, any>();
    if (tournament.ageGroups && tournament.ageGroups.length > 0) {
      tournament.ageGroups.forEach(ag => {
        const dbId = getDbAgeGroupId(ag.id, tournament.id);
        uniqueAgeGroupsMap.set(dbId, {
          id: dbId,
          tournament_id: tournament.id,
          name: ag.name,
          is_open: ag.name.toLowerCase().includes('open') || ag.name.toLowerCase().includes('bebas')
        });
      });
    }

    // Ensure active divisions have match types & age groups
    const validActiveDivisions = tournament.activeDivisions || [];
    validActiveDivisions.forEach(div => {
      const dbEvId = getDbEventId(div.eventId, tournament.id);
      if (!uniqueEventsMap.has(dbEvId)) {
        uniqueEventsMap.set(dbEvId, {
          id: dbEvId,
          tournament_id: tournament.id,
          name: div.eventName || 'Event',
          is_double: true,
          format_type: 'RR_KO'
        });
      }
      const dbAgId = getDbAgeGroupId(div.ageGroupId, tournament.id);
      if (!uniqueAgeGroupsMap.has(dbAgId)) {
        uniqueAgeGroupsMap.set(dbAgId, {
          id: dbAgId,
          tournament_id: tournament.id,
          name: div.ageGroupName || 'Kategori',
          is_open: true
        });
      }
    });

    const matchTypesData = Array.from(uniqueEventsMap.values());
    if (matchTypesData.length > 0) {
      const { error: mtErr } = await supabase.from('match_types').upsert(matchTypesData);
      if (mtErr) {
        return { success: false, error: { module: 'division', operation: 'insert', message: mtErr.message, details: JSON.stringify(mtErr) } };
      }
    }

    const ageGroupsData = Array.from(uniqueAgeGroupsMap.values());
    if (ageGroupsData.length > 0) {
      const { error: agErr } = await supabase.from('age_groups').upsert(ageGroupsData);
      if (agErr) {
        return { success: false, error: { module: 'division', operation: 'insert', message: agErr.message, details: JSON.stringify(agErr) } };
      }
    }

    // 4. Insert Divisions
    if (validActiveDivisions.length > 0) {
      const uniqueDivisionsMap = new Map<string, any>();
      validActiveDivisions.forEach(div => {
        const dbId = getDbDivisionId(div.id, tournament.id);
        uniqueDivisionsMap.set(dbId, {
          id: dbId,
          tournament_id: tournament.id,
          match_type_id: getDbEventId(div.eventId, tournament.id),
          age_group_id: getDbAgeGroupId(div.ageGroupId, tournament.id),
          name: `${div.eventName} ${div.ageGroupName}`,
          is_active: true,
          scoring_target: div.settings.targetScore,
          win_by_two: div.settings.winByTwo,
          group_size: div.settings.playersPerGroup,
          qualifiers_per_group: div.settings.playersQualifyingPerGroup,
          knockout_size: div.settings.bracketSize,
          wildcard_enabled: div.settings.wildcardActive,
          bye_enabled: div.settings.byeActive,
          third_place_enabled: div.settings.thirdPlaceMode ? div.settings.thirdPlaceMode !== 'none' : (div.settings.thirdPlaceEnabled !== false),
          third_place_mode: div.settings.thirdPlaceMode || (div.settings.thirdPlaceEnabled === false ? 'none' : 'playoff'),
          status: div.knockoutStage ? 'knockout_stage' : (div.groups.length > 0 ? 'group_stage' : 'pending'),
          wildcard_manual_rankings: div.knockoutStage?.wildcardManualRankings && typeof div.knockoutStage.wildcardManualRankings === 'object' ? div.knockoutStage.wildcardManualRankings : null,
          wildcard_manual_reason: div.knockoutStage?.wildcardManualReason?.trim() || null,
          wildcard_manual_cluster: div.knockoutStage?.wildcardManualCluster || null,
          bracket_arrangement_mode: div.knockoutStage?.bracketArrangementMode || 'automatic',
          group_cross_pairings: div.knockoutStage?.groupCrossPairings && Array.isArray(div.knockoutStage.groupCrossPairings)
            ? div.knockoutStage.groupCrossPairings.map(p => ({
                ...p,
                groupOneId: getDbGroupId(p.groupOneId, dbId),
                groupTwoId: getDbGroupId(p.groupTwoId, dbId)
              }))
            : null,
          manual_slot_assignments: div.knockoutStage?.manualSlotAssignments && typeof div.knockoutStage.manualSlotAssignments === 'object'
            ? Object.fromEntries(
                Object.entries(div.knockoutStage.manualSlotAssignments).map(([key, val]) => [
                  key,
                  val ? {
                    ...val,
                    sourceGroupId: val.sourceGroupId ? getDbGroupId(val.sourceGroupId, dbId) : undefined
                  } : null
                ])
              )
            : null,
          manual_arrangement_reason: div.knockoutStage?.manualArrangementReason?.trim() || null,
          arrangement_confirmed_at: div.knockoutStage?.arrangementConfirmedAt || null,
          arrangement_locked: !!div.knockoutStage?.arrangementLocked,
          arrangement_invalidated_reason: div.knockoutStage?.arrangementInvalidatedReason || null
        });
      });

      const divisionsData = Array.from(uniqueDivisionsMap.values());
      const { error: divErr } = await supabase.from('divisions').upsert(divisionsData);
      if (divErr) {
        return { success: false, error: { module: 'division', operation: 'insert', message: divErr.message, details: JSON.stringify(divErr) } };
      }
    }

    return { success: true, data: true };
  } catch (err: any) {
    return {
      success: false,
      error: {
        module: 'division',
        operation: 'insert',
        message: err?.message || 'Gagal menyimpan divisi ke database cloud.',
        details: JSON.stringify(err)
      }
    };
  }
}

/**
 * Load divisions, match types, and age groups for a tournament.
 */
export async function loadDivisionsForTournament(tournamentId: string): Promise<ServiceResult<{ matchTypes: any[]; ageGroups: any[]; divisions: any[] }>> {
  if (!isSupabaseConfigured) {
    return { success: false, error: { module: 'division', operation: 'load', message: 'Database cloud belum terkonfigurasi.' } };
  }

  try {
    const { data: mtData, error: mtErr } = await supabase
      .from('match_types')
      .select('*')
      .eq('tournament_id', tournamentId);
    if (mtErr) return { success: false, error: { module: 'division', operation: 'load', message: mtErr.message, details: JSON.stringify(mtErr) } };

    const { data: agData, error: agErr } = await supabase
      .from('age_groups')
      .select('*')
      .eq('tournament_id', tournamentId);
    if (agErr) return { success: false, error: { module: 'division', operation: 'load', message: agErr.message, details: JSON.stringify(agErr) } };

    const { data: divData, error: divErr } = await supabase
      .from('divisions')
      .select('*')
      .eq('tournament_id', tournamentId);
    if (divErr) return { success: false, error: { module: 'division', operation: 'load', message: divErr.message, details: JSON.stringify(divErr) } };

    return {
      success: true,
      data: {
        matchTypes: mtData || [],
        ageGroups: agData || [],
        divisions: divData || []
      }
    };
  } catch (err: any) {
    return {
      success: false,
      error: { module: 'division', operation: 'load', message: err?.message || 'Gagal memuat divisi dari cloud.' }
    };
  }
}

/**
 * Service to handle active tournament divisions.
 * Uses unified save state for atomic consistency.
 */
export async function updateDivisionInDatabase(
  tournament: Tournament,
  updatedDivision: Division
): Promise<boolean> {
  const updatedDivisions = tournament.activeDivisions.map(div =>
    div.id === updatedDivision.id ? updatedDivision : div
  );

  const updatedTournament: Tournament = {
    ...tournament,
    activeDivisions: updatedDivisions
  };

  const res = await saveTournamentToSupabase(updatedTournament);
  return res.success;
}
