import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { Tournament, Entry, ServiceResult } from '../types';
import { getDbDivisionId } from './divisionService';
import { saveTournamentToSupabase } from './tournamentService';

// Helper to clean entry ID referencing fields from placeholder 'BYE' strings
export const cleanEntryId = (id: string | null | undefined): string | null => {
  if (!id || id === 'BYE' || id === '') return null;
  return id;
};

// Name normalization & string utilities
export function mapEntryFromRow(row: any): Entry {
  return {
    id: String(row.id),
    name1: String(row.player1_name ?? '').trim(),
    name2: String(row.player2_name ?? '').trim() || undefined,
    affiliation: String(row.club ?? '').trim() || undefined,
    seed: row.seed ?? undefined
  };
}

export function normalizeName(name: string | null | undefined): string {
  if (!name) return '';
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function cleanDisplayName(name: string | null | undefined): string {
  if (!name) return '';
  return name.trim().replace(/\s+/g, ' ');
}

export function isSameNormalizedName(nameA: string, nameB: string): boolean {
  return normalizeName(nameA) === normalizeName(nameB);
}

// Inspect relation impact of deleting or changing an entry
export interface EntryRelationInspection {
  inGroup: boolean;
  groupName?: string;
  hasScores: boolean;
  inKnockout: boolean;
  inChampions: boolean;
  canDelete: boolean;
  canEditPerson: boolean;
  reason?: string;
}

export function inspectEntryRelations(division: {
  groups: Array<{ name: string; entryIds: string[] }>;
  roundRobinMatches: Array<{ entryId1: string | null; entryId2: string | null; status: string; score1: number | null; score2: number | null }>;
  knockoutStage: { matches: Array<{ entryId1: string | null; entryId2: string | null; status: string; score1: number | null; score2: number | null; winnerId?: string | null }>; confirmedEntryIds: string[] } | null;
  champions: { firstPlaceEntryId: string | null; secondPlaceEntryId: string | null; thirdPlaceEntryId: string | null } | null;
}, entryId: string): EntryRelationInspection {
  const result: EntryRelationInspection = {
    inGroup: false,
    hasScores: false,
    inKnockout: false,
    inChampions: false,
    canDelete: true,
    canEditPerson: true
  };

  if (!entryId) return result;

  // 1. Group membership
  const group = division.groups?.find(g => g.entryIds?.includes(entryId));
  if (group) {
    result.inGroup = true;
    result.groupName = group.name;
  }

  // 2. Round Robin matches & scores
  if (division.roundRobinMatches) {
    for (const m of division.roundRobinMatches) {
      if (m.entryId1 === entryId || m.entryId2 === entryId) {
        if (m.status === 'selesai' || m.status === 'walkover' || (m.score1 !== null && m.score1 > 0) || (m.score2 !== null && m.score2 > 0)) {
          result.hasScores = true;
          break;
        }
      }
    }
  }

  // 3. Knockout stage
  if (division.knockoutStage) {
    if (division.knockoutStage.confirmedEntryIds?.includes(entryId)) {
      result.inKnockout = true;
    }
    if (division.knockoutStage.matches) {
      for (const m of division.knockoutStage.matches) {
        if (m.entryId1 === entryId || m.entryId2 === entryId) {
          result.inKnockout = true;
          if (m.status === 'selesai' || m.status === 'walkover' || m.score1 !== null || m.score2 !== null || m.winnerId === entryId) {
            result.hasScores = true;
            break;
          }
        }
      }
    }
  }

  // 4. Champions podium
  if (division.champions) {
    if (division.champions.firstPlaceEntryId === entryId || division.champions.secondPlaceEntryId === entryId || division.champions.thirdPlaceEntryId === entryId) {
      result.inChampions = true;
    }
  }

  // Determine permissions
  if (result.hasScores || result.inKnockout || result.inChampions) {
    result.canDelete = false;
    result.canEditPerson = false;
    if (result.inChampions) {
      result.reason = 'Peserta sudah masuk dalam podium Juara.';
    } else if (result.inKnockout) {
      result.reason = 'Peserta sudah masuk dalam bagan Knockout.';
    } else {
      result.reason = 'Peserta sudah memiliki skor/hasil pertandingan.';
    }
  } else if (result.inGroup) {
    result.canDelete = true;
    result.canEditPerson = true;
    result.reason = `Peserta sudah masuk dalam ${result.groupName || 'grup'}.`;
  }

  return result;
}

// Entry validation result
export interface EntryValidationResult {
  valid: boolean;
  error?: string;
  sameNameConflict?: {
    playerName: string;
    existingEntry: Entry;
  };
}

export function validateEntryInput(
  isDouble: boolean,
  name1: string,
  name2: string | undefined,
  existingEntries: Entry[],
  excludeEntryId?: string
): EntryValidationResult {
  const norm1 = normalizeName(name1);
  const norm2 = normalizeName(name2 || '');

  if (!norm1) {
    return { valid: false, error: 'Nama Pemain 1 wajib diisi.' };
  }

  if (isDouble) {
    if (!norm2) {
      return { valid: false, error: 'Nama Pemain 2 (Partner) wajib diisi untuk kategori Ganda.' };
    }
    if (norm1 === norm2) {
      return { valid: false, error: 'Pemain 1 dan Pemain 2 tidak boleh merupakan orang yang sama.' };
    }
  }

  const entriesToCheck = existingEntries.filter(e => !excludeEntryId || e.id !== excludeEntryId);

  // Check for duplicate / registered players
  for (const ent of entriesToCheck) {
    const eNorm1 = normalizeName(ent.name1);
    const eNorm2 = normalizeName(ent.name2 || '');

    if (isDouble) {
      // 1. Check exact symmetric pair (A-B vs A-B or B-A)
      const isExactPair = (norm1 === eNorm1 && norm2 === eNorm2) || (norm1 === eNorm2 && norm2 === eNorm1);
      if (isExactPair) {
        return {
          valid: false,
          error: `Pasangan [${cleanDisplayName(name1)} / ${cleanDisplayName(name2)}] sudah terdaftar sebagai Pasangan Duplikat di divisi ini.`
        };
      }

      // 2. Check if player 1 is already in another pair
      if (norm1 === eNorm1 || norm1 === eNorm2) {
        const existingPlayerName = norm1 === eNorm1 ? ent.name1 : ent.name2;
        return {
          valid: false,
          sameNameConflict: {
            playerName: existingPlayerName || cleanDisplayName(name1),
            existingEntry: ent
          }
        };
      }

      // 3. Check if player 2 is already in another pair
      if (norm2 === eNorm1 || norm2 === eNorm2) {
        const existingPlayerName = norm2 === eNorm1 ? ent.name1 : ent.name2;
        return {
          valid: false,
          sameNameConflict: {
            playerName: existingPlayerName || cleanDisplayName(name2),
            existingEntry: ent
          }
        };
      }
    } else {
      // Single event
      if (norm1 === eNorm1) {
        return {
          valid: false,
          sameNameConflict: {
            playerName: ent.name1,
            existingEntry: ent
          }
        };
      }
    }
  }

  return { valid: true };
}

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
            player1_name: ent.name1.trim(),
            player2_name: ent.name2?.trim() || null,
            club: ent.affiliation?.trim() || null,
            seed: ent.seed ?? index + 1
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
