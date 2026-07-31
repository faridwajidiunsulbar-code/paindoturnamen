import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { Tournament, Match, ServiceResult } from '../types';
import { getDbDivisionId } from './divisionService';
import { getValidEntryId } from './entryService';
import { getDbGroupId } from './groupService';
import { saveTournamentToSupabase } from './tournamentService';

/**
 * Save all round robin and knockout matches to Supabase.
 */
export async function saveMatchesToSupabase(
  tournament: Tournament,
  insertedEntryIds: Set<string>
): Promise<ServiceResult<boolean>> {
  if (!isSupabaseConfigured) {
    return {
      success: false,
      error: { module: 'match', operation: 'insert', message: 'Database Cloud (Supabase) belum terkonfigurasi.' }
    };
  }

  try {
    // 1. Delete existing matches for this tournament
    const { error: delMatchError } = await supabase.from('matches').delete().eq('tournament_id', tournament.id);
    if (delMatchError) {
      return { success: false, error: { module: 'match', operation: 'delete', message: delMatchError.message, details: JSON.stringify(delMatchError) } };
    }

    const validActiveDivisions = tournament.activeDivisions || [];
    const uniqueMatchesMap = new Map<string, any>();

    validActiveDivisions.forEach(div => {
      const dbDivId = getDbDivisionId(div.id, tournament.id);

      // Round Robin Matches
      (div.roundRobinMatches || []).forEach((m, index) => {
        const grp = div.groups.find(g => g.name === m.groupName);
        const dbGrpId = grp ? getDbGroupId(grp.id, dbDivId) : null;
        uniqueMatchesMap.set(m.id, {
          id: m.id,
          tournament_id: tournament.id,
          division_id: dbDivId,
          group_id: dbGrpId,
          stage: 'round_robin',
          round: m.groupName || 'Round Robin',
          match_no: m.matchNum || index + 1,
          entry_a_id: getValidEntryId(m.entryId1, insertedEntryIds),
          entry_b_id: getValidEntryId(m.entryId2, insertedEntryIds),
          score_a: m.score1,
          score_b: m.score2,
          winner_entry_id: getValidEntryId(m.winnerId, insertedEntryIds),
          loser_entry_id: getValidEntryId(m.loserId, insertedEntryIds),
          status: m.status === 'selesai' ? 'completed' : (m.status === 'walkover' ? 'walkover' : 'scheduled'),
          is_walkover: m.status === 'walkover'
        });
      });

      // Knockout Stage Matches
      if (div.knockoutStage) {
        (div.knockoutStage.matches || []).forEach((m, index) => {
          uniqueMatchesMap.set(m.id, {
            id: m.id,
            tournament_id: tournament.id,
            division_id: dbDivId,
            group_id: null,
            stage: m.isBronzeMatch ? 'bronze' : (m.roundName === 'Final' ? 'final' : 'knockout'),
            round: m.roundName || 'Knockout',
            match_no: m.matchNum || index + 100,
            entry_a_id: getValidEntryId(m.entryId1, insertedEntryIds),
            entry_b_id: getValidEntryId(m.entryId2, insertedEntryIds),
            score_a: m.score1,
            score_b: m.score2,
            winner_entry_id: getValidEntryId(m.winnerId, insertedEntryIds),
            loser_entry_id: getValidEntryId(m.loserId, insertedEntryIds),
            status: m.status === 'selesai' ? 'completed' : (m.status === 'walkover' ? 'walkover' : 'scheduled'),
            is_walkover: m.status === 'walkover',
            next_match_id: null,
          });
        });
      }
    });

    const allMatches = Array.from(uniqueMatchesMap.values());
    if (allMatches.length > 0) {
      const { error: matchError } = await supabase.from('matches').upsert(allMatches);
      if (matchError) {
        return { success: false, error: { module: 'match', operation: 'insert', message: matchError.message, details: JSON.stringify(matchError) } };
      }
    }

    return { success: true, data: true };
  } catch (err: any) {
    return {
      success: false,
      error: {
        module: 'match',
        operation: 'insert',
        message: err?.message || 'Gagal menyimpan pertandingan ke cloud.',
        details: JSON.stringify(err)
      }
    };
  }
}

/**
 * Load matches for a tournament from Supabase.
 */
export async function loadMatchesForTournament(tournamentId: string): Promise<ServiceResult<any[]>> {
  if (!isSupabaseConfigured) {
    return { success: false, error: { module: 'match', operation: 'load', message: 'Database cloud belum terkonfigurasi.' } };
  }

  try {
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('tournament_id', tournamentId);

    if (error) {
      return { success: false, error: { module: 'match', operation: 'load', message: error.message, details: JSON.stringify(error) } };
    }

    return { success: true, data: data || [] };
  } catch (err: any) {
    return {
      success: false,
      error: { module: 'match', operation: 'load', message: err?.message || 'Gagal memuat pertandingan dari cloud.' }
    };
  }
}

/**
 * Service to handle tournament round-robin matches.
 * Writes match scores and statuses seamlessly to Supabase.
 */
export async function updateRoundRobinMatches(
  tournament: Tournament,
  divisionId: string,
  matches: Match[]
): Promise<boolean> {
  const updatedDivisions = tournament.activeDivisions.map(div => {
    if (div.id === divisionId) {
      return {
        ...div,
        roundRobinMatches: matches
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
