import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { Tournament, Match, ServiceResult, Division } from '../types';
import { getDbDivisionId } from './divisionService';
import { getValidEntryId } from './entryService';
import { getDbGroupId } from './groupService';
import { saveTournamentToSupabase } from './tournamentService';

/**
 * Check if modifications to round-robin matches or scores are blocked
 * due to locked Knockout stage or established Champions podium.
 */
export function checkRoundRobinLockStatus(division: Division) {
  const hasKnockoutMatches = !!(division.knockoutStage && (division.knockoutStage.matches || []).length > 0);
  const hasKnockoutConfirmed = !!(division.knockoutStage && (division.knockoutStage.confirmedEntryIds || []).length > 0);
  const hasChampions = !!(division.champions && (
    division.champions.firstPlaceEntryId !== null ||
    division.champions.secondPlaceEntryId !== null ||
    division.champions.thirdPlaceEntryId !== null
  ));

  const isLocked = hasKnockoutMatches || hasKnockoutConfirmed || hasChampions;

  let reason = '';
  if (hasChampions) {
    reason = 'Podium/Juara telah ditetapkan. Semua perubahan skor dan jadwal fase grup terkunci untuk menjaga integritas hasil turnamen. Silakan reset Podium dan Knockout terlebih dahulu.';
  } else if (hasKnockoutMatches || hasKnockoutConfirmed) {
    reason = 'Bagan Knockout telah dibentuk / terkunci. Semua perubahan skor dan jadwal fase grup terkunci. Silakan reset fase Knockout terlebih dahulu.';
  }

  return {
    isLocked,
    hasKnockout: hasKnockoutMatches || hasKnockoutConfirmed,
    hasChampions,
    reason
  };
}

export interface MatchAnomalies {
  hasAnomalies: boolean;
  warnings: string[];
}

/**
 * Pure inspector function for round robin matches integrity.
 * Detects duplicates, self-matches, invalid entry IDs, cross-group matches, score mismatches.
 */
export function inspectRoundRobinMatches(division: Division): MatchAnomalies {
  const warnings: string[] = [];
  const matches = division.roundRobinMatches || [];
  const entriesMap = new Set((division.entries || []).map(e => e.id));
  const seenMatchIds = new Set<string>();
  const seenPairs = new Set<string>();

  matches.forEach((m, idx) => {
    const matchLabel = `Pertandingan #${m.matchNum || idx + 1} (${m.groupName || 'Grup'})`;

    // 1. Duplicate match ID
    if (seenMatchIds.has(m.id)) {
      warnings.push(`${matchLabel}: Match ID "${m.id}" terdeteksi duplikat.`);
    } else {
      seenMatchIds.add(m.id);
    }

    // 2. Self-match
    if (m.entryId1 && m.entryId2 && m.entryId1 === m.entryId2) {
      warnings.push(`${matchLabel}: Peserta bertanding melawan dirinya sendiri (Self-match).`);
    }

    // 3. Duplicate pairs (A-B or B-A)
    if (m.entryId1 && m.entryId2) {
      const pairKey = [m.entryId1, m.entryId2].sort().join('::');
      if (seenPairs.has(pairKey)) {
        warnings.push(`${matchLabel}: Pertandingan antara dua peserta ini sudah dijadwalkan lebih dari satu kali (Duplikat A-B / B-A).`);
      } else {
        seenPairs.add(pairKey);
      }
    }

    // 4. Invalid entryId (not in division entries)
    if (m.entryId1 && !entriesMap.has(m.entryId1)) {
      warnings.push(`${matchLabel}: Peserta 1 (${m.entryId1}) tidak ditemukan dalam daftar peserta divisi.`);
    }
    if (m.entryId2 && !entriesMap.has(m.entryId2)) {
      warnings.push(`${matchLabel}: Peserta 2 (${m.entryId2}) tidak ditemukan dalam daftar peserta divisi.`);
    }

    // 5. Cross-group match
    if (m.entryId1 && m.entryId2 && division.groups) {
      const grp1 = division.groups.find(g => g.entryIds.includes(m.entryId1!));
      const grp2 = division.groups.find(g => g.entryIds.includes(m.entryId2!));
      if (grp1 && grp2 && grp1.id !== grp2.id) {
        warnings.push(`${matchLabel}: Pertandingan lintas grup! Peserta 1 ada di ${grp1.name} dan Peserta 2 ada di ${grp2.name}.`);
      }
    }

    // 6. Negative score
    if ((m.score1 !== null && m.score1 < 0) || (m.score2 !== null && m.score2 < 0)) {
      warnings.push(`${matchLabel}: Terdapat nilai skor negatif.`);
    }

    // 7. Partial score
    if ((m.score1 !== null && m.score2 === null) || (m.score1 === null && m.score2 !== null)) {
      warnings.push(`${matchLabel}: Skor hanya terisi sebagian (satu terisi, satu kosong).`);
    }

    // 8. Completed status without scores
    if (m.status === 'selesai' && (m.score1 === null || m.score2 === null)) {
      warnings.push(`${matchLabel}: Status pertandingan selesai tetapi skor belum terisi lengkap.`);
    }

    // 9. Equal scores when finished
    if (m.status === 'selesai' && m.score1 !== null && m.score2 !== null && m.score1 === m.score2) {
      warnings.push(`${matchLabel}: Hasil skor seri (${m.score1}-${m.score2}) tidak valid dalam aturan turnamen.`);
    }

    // 10. Winner ID mismatch
    if (m.status === 'selesai' && m.score1 !== null && m.score2 !== null && m.score1 !== m.score2) {
      const expectedWinner = m.score1 > m.score2 ? m.entryId1 : m.entryId2;
      if (m.winnerId !== expectedWinner) {
        warnings.push(`${matchLabel}: Pemenang (winnerId) tidak sesuai dengan pencapaian skor tertinggi.`);
      }
    }

    // 11. Walkover status without winnerId
    if (m.status === 'walkover' && !m.winnerId) {
      warnings.push(`${matchLabel}: Pertandingan berstatus Walkover (WO) tetapi pemenang (winnerId) tidak terisi.`);
    }
  });

  return {
    hasAnomalies: warnings.length > 0,
    warnings
  };
}

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
