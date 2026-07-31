import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { Tournament, Entry, ServiceResult } from '../types';
import { getDbDivisionId } from './divisionService';
import { saveTournamentToSupabase } from './tournamentService';

// Helper to clean entry ID referencing fields from placeholder 'BYE' strings
export const cleanEntryId = (id: string | null | undefined): string | null => {
  if (!id || id === 'BYE' || id === '') return null;
  return id;
};

// Helper to check if entry ID is valid and exists in current division's entries
export const getValidEntryId = (id: string | null | undefined, validEntryIds: Set<string>): string | null => {
  const cleaned = cleanEntryId(id);
  if (cleaned && validEntryIds.has(cleaned)) {
    return cleaned;
  }
  return null;
};

/**
 * Save all entries for a tournament to Supabase.
 */
export async function saveEntriesToSupabase(tournament: Tournament): Promise<ServiceResult<{ insertedEntryIds: Set<string>; entries: any[] }>> {
  if (!isSupabaseConfigured) {
    return {
      success: false,
      error: { module: 'entry', operation: 'insert', message: 'Database Cloud (Supabase) belum terkonfigurasi.' }
    };
  }

  try {
    // 1. Delete existing entries for this tournament
    const { error: delErr } = await supabase.from('entries').delete().eq('tournament_id', tournament.id);
    if (delErr) {
      return { success: false, error: { module: 'entry', operation: 'delete', message: delErr.message, details: JSON.stringify(delErr) } };
    }

    const validActiveDivisions = tournament.activeDivisions || [];
    const uniqueEntriesMap = new Map<string, any>();

    validActiveDivisions.forEach(div => {
      const dbDivId = getDbDivisionId(div.id, tournament.id);
      div.entries.forEach((ent, index) => {
        const cleanedId = cleanEntryId(ent.id);
        if (cleanedId) {
          uniqueEntriesMap.set(cleanedId, {
            id: cleanedId,
            tournament_id: tournament.id,
            division_id: dbDivId,
            player1_name: ent.name1,
            player2_name: ent.name2 || null,
            club: ent.affiliation || null,
            seed: index + 1
          });
        }
      });
    });

    const allEntries = Array.from(uniqueEntriesMap.values());
    if (allEntries.length > 0) {
      const { error: entError } = await supabase.from('entries').upsert(allEntries);
      if (entError) {
        return { success: false, error: { module: 'entry', operation: 'insert', message: entError.message, details: JSON.stringify(entError) } };
      }
    }

    const insertedEntryIds = new Set(allEntries.map(e => e.id));
    return {
      success: true,
      data: {
        insertedEntryIds,
        entries: allEntries
      }
    };
  } catch (err: any) {
    return {
      success: false,
      error: {
        module: 'entry',
        operation: 'insert',
        message: err?.message || 'Gagal menyimpan data peserta ke cloud.',
        details: JSON.stringify(err)
      }
    };
  }
}

/**
 * Load entries for a tournament from Supabase.
 */
export async function loadEntriesForTournament(tournamentId: string): Promise<ServiceResult<any[]>> {
  if (!isSupabaseConfigured) {
    return { success: false, error: { module: 'entry', operation: 'load', message: 'Database cloud belum terkonfigurasi.' } };
  }

  try {
    const { data, error } = await supabase
      .from('entries')
      .select('*')
      .eq('tournament_id', tournamentId);

    if (error) {
      return { success: false, error: { module: 'entry', operation: 'load', message: error.message, details: JSON.stringify(error) } };
    }

    return { success: true, data: data || [] };
  } catch (err: any) {
    return {
      success: false,
      error: { module: 'entry', operation: 'load', message: err?.message || 'Gagal memuat peserta dari cloud.' }
    };
  }
}

/**
 * Service to handle tournament entries.
 * Integrates with unified tournament state for consistency.
 */
export async function addEntryToDivision(
  tournament: Tournament,
  divisionId: string,
  newEntry: Entry
): Promise<boolean> {
  const updatedDivisions = tournament.activeDivisions.map(div => {
    if (div.id === divisionId) {
      return {
        ...div,
        entries: [...div.entries, newEntry]
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
