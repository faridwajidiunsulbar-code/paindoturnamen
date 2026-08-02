import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { Tournament, KnockoutStage, ServiceResult } from '../types';
import { getDbDivisionId } from './divisionService';
import { getValidEntryId } from './entryService';
import { getDbGroupId } from './groupService';
import { saveTournamentToSupabase } from './tournamentService';

/**
 * Save knockout slots and champions for a tournament to Supabase.
 */
export async function saveKnockoutSlotsAndChampionsToSupabase(
  tournament: Tournament,
  insertedEntryIds: Set<string>
): Promise<ServiceResult<boolean>> {
  if (!isSupabaseConfigured) {
    return {
      success: false,
      error: { module: 'knockout', operation: 'insert', message: 'Database Cloud (Supabase) belum terkonfigurasi.' }
    };
  }

  try {
    // 1. Cleanup knockout slots for tournament
    const { error: delSlotError } = await supabase.from('knockout_slots').delete().eq('tournament_id', tournament.id);
    if (delSlotError) {
      return { success: false, error: { module: 'knockout', operation: 'delete', message: delSlotError.message, details: JSON.stringify(delSlotError) } };
    }

    const validActiveDivisions = tournament.activeDivisions || [];

    // 2. Insert Knockout Slots
    const allKnockoutSlots: any[] = [];
    validActiveDivisions.forEach(div => {
      const dbDivId = getDbDivisionId(div.id, tournament.id);
      if (div.knockoutStage) {
        if (div.knockoutStage.slots && div.knockoutStage.slots.length > 0) {
          div.knockoutStage.slots.forEach(slot => {
            const isBye = !slot.entryId || slot.entryId === 'BYE' || !!slot.isBye || slot.qualificationType === 'bye';
            const isWildcard = !isBye && (slot.qualificationType === 'wildcard' || !!slot.isWildcard);
            const qualType = isBye ? 'bye' : (isWildcard ? 'wildcard' : 'group');

            let dbGrpId: string | null = null;
            if (qualType !== 'bye' && slot.sourceGroupId) {
              dbGrpId = getDbGroupId(slot.sourceGroupId, dbDivId);
            }

            allKnockoutSlots.push({
              tournament_id: tournament.id,
              division_id: dbDivId,
              seed_no: slot.seedNo,
              entry_id: isBye ? null : getValidEntryId(slot.entryId, insertedEntryIds),
              source_label: slot.sourceLabel || `Seed ${slot.seedNo}`,
              is_wildcard: qualType === 'wildcard',
              is_bye: qualType === 'bye',
              source_group_id: dbGrpId,
              source_group_rank: qualType === 'bye' ? null : (slot.sourceGroupRank ?? null),
              qualification_type: qualType,
              wildcard_rank: qualType === 'wildcard' ? (slot.wildcardRank ?? null) : null
            });
          });
        } else if (div.knockoutStage.confirmedEntryIds) {
          div.knockoutStage.confirmedEntryIds.forEach((entId, idx) => {
            const isBye = !entId || entId === 'BYE';
            allKnockoutSlots.push({
              tournament_id: tournament.id,
              division_id: dbDivId,
              seed_no: idx + 1,
              entry_id: isBye ? null : getValidEntryId(entId, insertedEntryIds),
              source_label: `Seed ${idx + 1}`,
              is_wildcard: false,
              is_bye: isBye,
              source_group_id: null,
              source_group_rank: null,
              qualification_type: isBye ? 'bye' : 'group',
              wildcard_rank: null
            });
          });
        }
      }
    });

    if (allKnockoutSlots.length > 0) {
      const { error: slotError } = await supabase.from('knockout_slots').insert(allKnockoutSlots);
      if (slotError) {
        return { success: false, error: { module: 'knockout', operation: 'insert', message: slotError.message, details: JSON.stringify(slotError) } };
      }
    }

    // 3. Process Champions (Canonical multi-row & soft revoke per division)
    const allChampions: any[] = [];
    for (const div of validActiveDivisions) {
      const dbDivId = getDbDivisionId(div.id, tournament.id);

      if (div.podiumOfficial && div.officialPodium && div.officialPodium.entries) {
        // Soft-revoke previous active canonical rows for this division
        await supabase
          .from('champions')
          .update({
            revoked_at: new Date().toISOString(),
            revoked_reason: 'Pengesahan ulang'
          })
          .eq('tournament_id', tournament.id)
          .eq('division_id', dbDivId)
          .is('revoked_at', null);

        // Add new canonical active rows
        div.officialPodium.entries.forEach((pEntry, pIdx) => {
          const validId = getValidEntryId(pEntry.entryId, insertedEntryIds);
          if (validId) {
            allChampions.push({
              id: `c-${dbDivId}-${pEntry.placement}-${validId}-${pIdx}`,
              tournament_id: tournament.id,
              division_id: dbDivId,
              entry_id: validId,
              placement: pEntry.placement,
              placement_label: pEntry.label,
              is_shared: !!pEntry.isShared,
              source_match_id: pEntry.sourceMatchId || null,
              official_at: div.officialPodium?.officialAt || new Date().toISOString(),
              official_by: div.officialBy || div.officialPodium?.officialBy || null,
              revoked_at: null,
              revoked_reason: null
            });
          }
        });
      } else if (div.revokedAt && !div.podiumOfficial) {
        // Soft-revoke active canonical rows for this division
        await supabase
          .from('champions')
          .update({
            revoked_at: div.revokedAt,
            revoked_reason: div.podiumRevokedReason || 'Pencabutan pengesahan oleh admin'
          })
          .eq('tournament_id', tournament.id)
          .eq('division_id', dbDivId)
          .is('revoked_at', null);
      } else if (div.champions) {
        allChampions.push({
          id: `c-${dbDivId}`,
          tournament_id: tournament.id,
          division_id: dbDivId,
          champion_entry_id: getValidEntryId(div.champions.firstPlaceEntryId, insertedEntryIds),
          runner_up_entry_id: getValidEntryId(div.champions.secondPlaceEntryId, insertedEntryIds),
          third_place_entry_id: getValidEntryId(div.champions.thirdPlaceEntryId, insertedEntryIds)
        });
      }
    }

    if (allChampions.length > 0) {
      const { error: champError } = await supabase.from('champions').upsert(allChampions);
      if (champError) {
        return { success: false, error: { module: 'knockout', operation: 'insert', message: champError.message, details: JSON.stringify(champError) } };
      }
    }

    return { success: true, data: true };
  } catch (err: any) {
    return {
      success: false,
      error: {
        module: 'knockout',
        operation: 'insert',
        message: err?.message || 'Gagal menyimpan data knockout ke cloud.',
        details: JSON.stringify(err)
      }
    };
  }
}

/**
 * Load knockout slots and champions for a tournament from Supabase.
 */
export async function loadKnockoutSlotsAndChampionsForTournament(
  tournamentId: string
): Promise<ServiceResult<{ knockoutSlots: any[]; champions: any[] }>> {
  if (!isSupabaseConfigured) {
    return { success: false, error: { module: 'knockout', operation: 'load', message: 'Database cloud belum terkonfigurasi.' } };
  }

  try {
    const { data: slotData, error: slotErr } = await supabase
      .from('knockout_slots')
      .select('*')
      .eq('tournament_id', tournamentId);
    if (slotErr) return { success: false, error: { module: 'knockout', operation: 'load', message: slotErr.message, details: JSON.stringify(slotErr) } };

    const { data: champData, error: champErr } = await supabase
      .from('champions')
      .select('*')
      .eq('tournament_id', tournamentId);
    if (champErr) return { success: false, error: { module: 'knockout', operation: 'load', message: champErr.message, details: JSON.stringify(champErr) } };

    return {
      success: true,
      data: {
        knockoutSlots: slotData || [],
        champions: champData || []
      }
    };
  } catch (err: any) {
    return {
      success: false,
      error: { module: 'knockout', operation: 'load', message: err?.message || 'Gagal memuat data knockout dari cloud.' }
    };
  }
}

/**
 * Service to handle knockout stage bracket setups and matches.
 * Syncs the entire bracket tree structure cleanly with database rows.
 */
export async function updateKnockoutStage(
  tournament: Tournament,
  divisionId: string,
  knockoutStage: KnockoutStage | null
): Promise<boolean> {
  const updatedDivisions = tournament.activeDivisions.map(div => {
    if (div.id === divisionId) {
      return {
        ...div,
        knockoutStage
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
