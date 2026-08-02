import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { Tournament, Division, TournamentEvent, AgeGroup, Entry, Group, Match, Champions, KnockoutStage, KnockoutSlot, ServiceResult } from '../types';
import { saveDivisionsToSupabase, loadDivisionsForTournament } from './divisionService';
import { saveEntriesToSupabase, loadEntriesForTournament } from './entryService';
import { saveGroupsAndMembersToSupabase, loadGroupsForTournament } from './groupService';
import { saveMatchesToSupabase, loadMatchesForTournament } from './matchService';
import { saveKnockoutSlotsAndChampionsToSupabase, loadKnockoutSlotsAndChampionsForTournament } from './knockoutService';

export interface UserProfile {
  id: string;
  full_name: string;
  role: string;
}

let isSaveInProgress = false;

/**
 * Authentication and Profile Services
 */
export async function getCurrentUser() {
  if (!isSupabaseConfigured) return null;
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    return user;
  } catch (err) {
    console.error('Error in getCurrentUser:', err);
    return null;
  }
}

export async function getCurrentProfile(): Promise<UserProfile | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const user = await getCurrentUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('Error fetching profile:', error);
      return null;
    }
    return data as UserProfile;
  } catch (err) {
    console.error('Error in getCurrentProfile:', err);
    return null;
  }
}

/**
 * Tournament Sync Services (Orchestrator)
 */

// Save/Sync a complete tournament tree to the relational database using domain services
export async function saveTournamentToSupabase(tournament: Tournament): Promise<ServiceResult<{
  savedAt: string;
  cloudRevision: number;
  cloudUpdatedAt: string;
  cloudSaveStatus: 'complete';
}>> {
  if (!isSupabaseConfigured) {
    return {
      success: false,
      error: { module: 'tournament', operation: 'insert', message: 'Database Cloud (Supabase) belum terkonfigurasi.' }
    };
  }

  if (isSaveInProgress) {
    return {
      success: false,
      error: { module: 'tournament', operation: 'insert', message: 'Proses penyimpanan ke cloud sedang berlangsung. Mohon tunggu.' }
    };
  }
  
  const user = await getCurrentUser();
  if (!user) {
    return {
      success: false,
      error: { module: 'tournament', operation: 'insert', message: 'Silakan login terlebih dahulu untuk menyinkronkan data ke Supabase Cloud.' }
    };
  }

  isSaveInProgress = true;

  try {
    // 0. Ensure user has a profile if logged in
    if (user) {
      const { data: profileCheck } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle();

      if (!profileCheck) {
        const { error: insErr } = await supabase
          .from('profiles')
          .upsert({
            id: user.id,
            full_name: user.user_metadata?.full_name || user.email || 'Admin',
            role: 'admin'
          });
        if (insErr) {
          console.warn('Could not auto-create user profile in database:', insErr);
        }
      }
    }

    // 1. Validasi Expected Revision
    const rawRev = tournament.cloudRevision;
    const expectedRevision = typeof rawRev === 'number'
      ? rawRev
      : (rawRev ? parseInt(String(rawRev), 10) : 1);

    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return {
        success: false,
        error: {
          code: 'INVALID_CLOUD_REVISION',
          module: 'tournament',
          operation: 'reserve_revision',
          message: 'Metadata revisi cloud tidak valid. Muat ulang turnamen sebelum menyimpan.'
        }
      };
    }

    // Check if tournament already exists in Supabase Cloud
    const { data: existingCloudTourney } = await supabase
      .from('tournaments')
      .select('id, revision, updated_at, save_status, owner_id')
      .eq('id', tournament.id)
      .maybeSingle();

    let reservedRevision = 1;

    if (existingCloudTourney) {
      // Existing tournament in Cloud -> Perform Atomic Conditional Update Reservation
      // CRITICAL: expectedRevision comes strictly from tournament.cloudRevision
      // DO NOT fallback to cloud revision or overwrite expectedRevision!

      const reservePayload: any = {
        name: tournament.name,
        date: tournament.date,
        location: tournament.location || '',
        status: 'active',
        revision: expectedRevision + 1,
        save_status: 'saving'
      };
      if (user?.id) {
        reservePayload.owner_id = user.id;
      }

      const { data: reservedData, error: reservationError } = await supabase
        .from('tournaments')
        .update(reservePayload)
        .eq('id', tournament.id)
        .eq('revision', expectedRevision)
        .select('revision, updated_at, save_status');

      if (reservationError) {
        return {
          success: false,
          error: {
            code: 'RESERVATION_FAILED',
            module: 'tournament',
            operation: 'reserve_revision',
            message: `Gagal melakukan reservasi revisi: ${reservationError.message}`
          }
        };
      }

      // Instrumentation logging for PAINDO-007E1 verification
      console.info('[Hotfix PAINDO-007E1] Reservation result:', {
        tournamentId: tournament.id,
        expectedRevision,
        reservedDataLength: reservedData ? reservedData.length : 0,
        isConflict: !reservedData || reservedData.length === 0
      });

      // Zero rows returned -> Concurrency Conflict!
      if (!reservedData || reservedData.length === 0) {
        const { data: latestCloud } = await supabase
          .from('tournaments')
          .select('revision, updated_at')
          .eq('id', tournament.id)
          .maybeSingle();

        const latestCloudRev = latestCloud?.revision ? Number(latestCloud.revision) : expectedRevision + 1;

        return {
          success: false,
          isConflict: true,
          partialSave: false,
          error: {
            code: 'CONCURRENCY_CONFLICT',
            module: 'tournament',
            operation: 'reserve_revision',
            message: 'Data turnamen di Cloud telah diperbarui dari tab atau perangkat lain. Penyimpanan dibatalkan agar data terbaru tidak tertimpa.'
          },
          conflictDetails: {
            localRevision: expectedRevision,
            cloudRevision: latestCloudRev,
            localLoadedAt: tournament.cloudUpdatedAt || tournament.updatedAt,
            cloudUpdatedAt: latestCloud?.updated_at
          }
        };
      }

      if (reservedData.length > 1) {
        return {
          success: false,
          error: {
            code: 'REVISION_RESERVATION_INTEGRITY_ERROR',
            module: 'tournament',
            operation: 'reserve_revision',
            message: 'Terjadi kesalahan integritas saat reservasi revisi.'
          }
        };
      }

      reservedRevision = Number(reservedData[0].revision);
    } else {
      // New tournament creation -> Insert new row with revision 1 and save_status 'saving'
      const newPayload: any = {
        id: tournament.id,
        name: tournament.name,
        date: tournament.date,
        location: tournament.location || '',
        status: 'active',
        revision: 1,
        save_status: 'saving'
      };
      if (user?.id) {
        newPayload.owner_id = user.id;
      }

      const { data: insertedData, error: insertError } = await supabase
        .from('tournaments')
        .insert(newPayload)
        .select('revision, updated_at, save_status');

      if (insertError || !insertedData || insertedData.length === 0) {
        return {
          success: false,
          error: {
            module: 'tournament',
            operation: 'insert',
            message: `[Tournaments Table] ${insertError?.message || 'Gagal membuat header turnamen baru'}`
          }
        };
      }

      reservedRevision = Number(insertedData[0].revision);
    }

    // 2. Delegate child domain saves
    let childErrorModule = '';
    let childErrorMsg = '';

    // 2.1 Divisions Domain
    const divResult = await saveDivisionsToSupabase(tournament);
    if (!divResult.success) {
      childErrorModule = 'divisions';
      childErrorMsg = (divResult as any).error?.message || 'Gagal menyimpan divisi.';
    }

    // 2.2 Entries Domain
    let insertedEntryIds: Set<string> = new Set();
    if (!childErrorModule) {
      const entResult = await saveEntriesToSupabase(tournament);
      if (!entResult.success) {
        childErrorModule = 'entries';
        childErrorMsg = (entResult as any).error?.message || 'Gagal menyimpan peserta.';
      } else {
        insertedEntryIds = entResult.data.insertedEntryIds;
      }
    }

    // 2.3 Groups Domain
    if (!childErrorModule) {
      const grpResult = await saveGroupsAndMembersToSupabase(tournament, insertedEntryIds);
      if (!grpResult.success) {
        childErrorModule = 'groups';
        childErrorMsg = (grpResult as any).error?.message || 'Gagal menyimpan grup.';
      }
    }

    // 2.4 Matches Domain
    if (!childErrorModule) {
      const matchResult = await saveMatchesToSupabase(tournament, insertedEntryIds);
      if (!matchResult.success) {
        childErrorModule = 'matches';
        childErrorMsg = (matchResult as any).error?.message || 'Gagal menyimpan pertandingan.';
      }
    }

    // 2.5 Knockout & Champions Domain
    if (!childErrorModule) {
      const koResult = await saveKnockoutSlotsAndChampionsToSupabase(tournament, insertedEntryIds);
      if (!koResult.success) {
        childErrorModule = 'knockout';
        childErrorMsg = (koResult as any).error?.message || 'Gagal menyimpan babak gugur/juara.';
      }
    }

    // If any child domain failed, mark save_status as 'failed' in Supabase
    if (childErrorModule) {
      try {
        await supabase
          .from('tournaments')
          .update({ save_status: 'failed' })
          .eq('id', tournament.id)
          .eq('revision', reservedRevision);
      } catch (markErr) {
        console.warn('Could not mark save_status as failed:', markErr);
      }

      return {
        success: false,
        partialSave: true,
        error: {
          code: 'PARTIAL_SAVE_FAILED',
          module: childErrorModule,
          operation: 'save_domain',
          message: `Penyimpanan ke cloud tidak selesai pada modul ${childErrorModule}: ${childErrorMsg}. Sebagian data mungkin telah diperbarui. Data lokal tetap dipertahankan. Silakan periksa koneksi dan coba simpan ulang.`
        },
        partialDetails: {
          reservedRevision,
          cloudSaveStatus: 'failed'
        }
      } as any;
    }

    // 3. Finalization: Update save_status = 'complete'
    const { data: finalizedRows, error: finalizeError } = await supabase
      .from('tournaments')
      .update({ save_status: 'complete' })
      .eq('id', tournament.id)
      .eq('revision', reservedRevision)
      .select('revision, updated_at, save_status');

    if (finalizeError || !finalizedRows || finalizedRows.length !== 1) {
      return {
        success: false,
        error: {
          code: 'FINALIZATION_FAILED',
          module: 'tournament',
          operation: 'finalize_save',
          message: 'Gagal memfinalisasi status penyimpanan cloud.'
        }
      };
    }

    const finalRevision = Number(finalizedRows[0].revision);
    const finalUpdatedAt = finalizedRows[0].updated_at;

    return {
      success: true,
      data: {
        savedAt: finalUpdatedAt,
        cloudRevision: finalRevision,
        cloudUpdatedAt: finalUpdatedAt,
        cloudSaveStatus: 'complete'
      } as any
    };
  } catch (err: any) {
    console.error('Failed to save tournament to Supabase:', err);
    const msg = err?.message || err?.details || (typeof err === 'string' ? err : 'Gagal menyimpan data turnamen ke Supabase Cloud.');
    if (typeof window !== 'undefined') {
      (window as any).lastSupabaseError = msg;
    }
    return {
      success: false,
      error: {
        module: 'tournament',
        operation: 'insert',
        message: msg,
        details: err?.details || JSON.stringify(err)
      }
    };
  } finally {
    isSaveInProgress = false;
  }
}

// Load a single deeply nested tournament object from relational tables using domain services
export async function loadTournamentFromSupabase(tournamentId: string): Promise<Tournament | null> {
  if (!isSupabaseConfigured) return null;

  try {
    // 1. Fetch Tournament Header
    const { data: tData, error: tError } = await supabase
      .from('tournaments')
      .select('*')
      .eq('id', tournamentId)
      .single();

    if (tError || !tData) return null;

    // 2. Load Divisions Domain (match_types, age_groups, divisions)
    const divResult = await loadDivisionsForTournament(tournamentId);
    if (!divResult.success) return null;
    const { matchTypes, ageGroups: dbAgeGroups, divisions: dbDivisions } = divResult.data;

    // 3. Load Entries Domain
    const entResult = await loadEntriesForTournament(tournamentId);
    const entData = entResult.success ? entResult.data : [];

    // 4. Load Groups Domain
    const grpResult = await loadGroupsForTournament(tournamentId);
    const { groups: gData, groupMembers: gmData } = grpResult.success ? grpResult.data : { groups: [], groupMembers: [] };

    // 5. Load Matches Domain
    const matchResult = await loadMatchesForTournament(tournamentId);
    const matchData = matchResult.success ? matchResult.data : [];

    // 6. Load Knockout & Champions Domain
    const koResult = await loadKnockoutSlotsAndChampionsForTournament(tournamentId);
    const { knockoutSlots: slotData, champions: champData } = koResult.success ? koResult.data : { knockoutSlots: [], champions: [] };

    // Reconstruct Tournament Events
    const events: TournamentEvent[] = (matchTypes || []).map((mt: any) => ({
      id: mt.id,
      name: mt.name,
      isDouble: mt.is_double
    }));

    // Reconstruct Age Groups
    const ageGroups: AgeGroup[] = (dbAgeGroups || []).map((ag: any) => ({
      id: ag.id,
      name: ag.name
    }));

    // Reconstruct Active Divisions
    const activeDivisions: Division[] = (dbDivisions || []).map((div: any) => {
      // Find division's entries
      const divEntries: Entry[] = (entData || [])
        .filter((e: any) => e.division_id === div.id)
        .sort((a: any, b: any) => (a.seed || 0) - (b.seed || 0))
        .map((e: any) => ({
          id: e.id,
          name1: e.player1_name,
          name2: e.player2_name || undefined,
          affiliation: e.club || undefined
        }));

      // Find division's groups
      const divGroups: Group[] = (gData || [])
        .filter((g: any) => g.division_id === div.id)
        .map((g: any) => {
          const memberIds = (gmData || [])
            .filter((gm: any) => gm.group_id === g.id)
            .map((gm: any) => gm.entry_id);
          const dbName = g.name || '';
          let groupName = dbName;
          if (!dbName.toLowerCase().startsWith('grup') && !dbName.toLowerCase().startsWith('pool')) {
            groupName = dbName.length <= 2 ? `Grup ${dbName}` : dbName;
          }
          // Validate cloud manual_rankings
          let validatedManualRankings: Record<string, number> | undefined = undefined;
          if (g.manual_rankings && typeof g.manual_rankings === 'object' && !Array.isArray(g.manual_rankings)) {
            const entriesInGroupSet = new Set(memberIds);
            const keys = Object.keys(g.manual_rankings);
            const seenRanks = new Set<number>();
            let isValid = keys.length > 0;

            for (const entryId of keys) {
              if (!entriesInGroupSet.has(entryId)) {
                isValid = false;
                break;
              }
              const rank = g.manual_rankings[entryId];
              if (!Number.isInteger(rank) || rank <= 0 || seenRanks.has(rank)) {
                isValid = false;
                break;
              }
              seenRanks.add(rank);
            }

            if (isValid) {
              validatedManualRankings = g.manual_rankings;
            } else {
              console.warn(`[Integrity Warning] Invalid manual_rankings ignored for group ${g.id}:`, g.manual_rankings);
            }
          }

          return {
            id: g.id,
            name: groupName,
            entryIds: memberIds,
            manualRankings: validatedManualRankings,
            manualRankingReason: g.manual_ranking_reason?.trim() || undefined
          };
        });

      // Find division's matches
      const divMatches = (matchData || []).filter((m: any) => m.division_id === div.id);
      
      // Round Robin Matches
      const roundRobinMatches: Match[] = divMatches
        .filter((m: any) => m.stage === 'round_robin')
        .map((m: any) => ({
          id: m.id,
          divisionId: m.division_id,
          groupName: m.round || undefined,
          type: 'ROUND_ROBIN',
          entryId1: m.entry_a_id,
          entryId2: m.entry_b_id,
          score1: m.score_a,
          score2: m.score_b,
          status: m.status === 'completed' ? 'selesai' : (m.status === 'walkover' ? 'walkover' : 'belum_dimainkan'),
          winnerId: m.winner_entry_id,
          loserId: m.loser_entry_id
        }));

      // Knockout Stage Matches
      const koMatches = divMatches.filter((m: any) => m.stage === 'knockout' || m.stage === 'bronze' || m.stage === 'final');
      let knockoutStage: KnockoutStage | null = null;

      if (koMatches.length > 0 || (slotData && slotData.some((s: any) => s.division_id === div.id)) || div.bracket_arrangement_mode || div.group_cross_pairings || div.manual_slot_assignments) {
        const sortedKoMatches: Match[] = koMatches.map((m: any) => {
          let nextMatchNum: number | undefined = undefined;
          if (m.next_match_id) {
            const parts = String(m.next_match_id).split('-');
            const lastNum = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(lastNum)) nextMatchNum = lastNum;
          }

          return {
            id: m.id,
            divisionId: m.division_id,
            roundName: m.round || undefined,
            type: 'KNOCKOUT',
            isBronzeMatch: m.stage === 'bronze',
            entryId1: m.entry_a_id,
            entryId2: m.entry_b_id,
            score1: m.score_a,
            score2: m.score_b,
            status: m.status === 'completed' ? 'selesai' : (m.status === 'walkover' ? 'walkover' : 'belum_dimainkan'),
            winnerId: m.winner_entry_id,
            loserId: m.loser_entry_id,
            matchNum: m.match_no,
            nextMatchNum,
            notes: m.notes || undefined
          };
        });

        // Validate cloud wildcard_manual_rankings & cluster
        let validatedWildcardManualRankings: Record<string, number> | undefined = undefined;
        let validatedWildcardManualCluster: { entryIds: string[]; rankingMode: 'total' | 'normalized' } | undefined = undefined;

        if (
          div.wildcard_manual_rankings &&
          typeof div.wildcard_manual_rankings === 'object' &&
          !Array.isArray(div.wildcard_manual_rankings)
        ) {
          const keys = Object.keys(div.wildcard_manual_rankings);
          const seenRanks = new Set<number>();
          let isValid = keys.length > 0;
          for (const k of keys) {
            const r = div.wildcard_manual_rankings[k];
            if (!Number.isInteger(r) || r <= 0 || seenRanks.has(r)) {
              isValid = false;
              break;
            }
            seenRanks.add(r);
          }
          if (isValid) {
            validatedWildcardManualRankings = div.wildcard_manual_rankings;
          } else {
            console.warn(`[Integrity Warning] Invalid wildcard_manual_rankings ignored for division ${div.id}:`, div.wildcard_manual_rankings);
          }
        }

        if (div.wildcard_manual_cluster && typeof div.wildcard_manual_cluster === 'object') {
          const { entryIds, rankingMode } = div.wildcard_manual_cluster;
          if (Array.isArray(entryIds) && (rankingMode === 'total' || rankingMode === 'normalized')) {
            validatedWildcardManualCluster = { entryIds, rankingMode };
          } else {
            console.warn(`[Integrity Warning] Invalid wildcard_manual_cluster ignored for division ${div.id}:`, div.wildcard_manual_cluster);
          }
        }

        // Validate PAINDO-008E arrangement fields
        const validModes = ['automatic', 'group_cross', 'manual'];
        const validatedMode = validModes.includes(div.bracket_arrangement_mode)
          ? div.bracket_arrangement_mode
          : 'automatic';

        let validatedGroupCrossPairings: any[] | undefined = undefined;
        if (Array.isArray(div.group_cross_pairings)) {
          const validPairings: any[] = [];
          const usedGroupIds = new Set<string>();
          let isValid = true;
          for (const p of div.group_cross_pairings) {
            if (
              p &&
              typeof p === 'object' &&
              typeof p.id === 'string' &&
              typeof p.groupOneId === 'string' &&
              typeof p.groupTwoId === 'string' &&
              p.groupOneId !== p.groupTwoId &&
              !usedGroupIds.has(p.groupOneId) &&
              !usedGroupIds.has(p.groupTwoId)
            ) {
              usedGroupIds.add(p.groupOneId);
              usedGroupIds.add(p.groupTwoId);
              validPairings.push({
                id: p.id,
                groupOneId: p.groupOneId,
                groupTwoId: p.groupTwoId,
                order: Number.isInteger(p.order) ? p.order : validPairings.length + 1
              });
            } else {
              isValid = false;
              break;
            }
          }
          if (isValid && validPairings.length > 0) {
            validatedGroupCrossPairings = validPairings;
          } else if (!isValid) {
            console.warn(`[Integrity Warning] Invalid group_cross_pairings ignored for division ${div.id}:`, div.group_cross_pairings);
          }
        }

        let validatedManualSlotAssignments: Record<string, any> | undefined = undefined;
        if (div.manual_slot_assignments && typeof div.manual_slot_assignments === 'object' && !Array.isArray(div.manual_slot_assignments)) {
          const validMap: Record<string, any> = {};
          const validSources = ['group_rank', 'wildcard_rank', 'bye', 'manual'];
          let isValid = true;
          for (const [k, val] of Object.entries(div.manual_slot_assignments)) {
            if (val && typeof val === 'object' && validSources.includes((val as any).sourceType)) {
              validMap[k] = val;
            } else if (val === null) {
              validMap[k] = null;
            } else {
              isValid = false;
              break;
            }
          }
          if (isValid && Object.keys(validMap).length > 0) {
            validatedManualSlotAssignments = validMap;
          } else if (!isValid) {
            console.warn(`[Integrity Warning] Invalid manual_slot_assignments ignored for division ${div.id}:`, div.manual_slot_assignments);
          }
        }

        const divSlots = (slotData || [])
          .filter((s: any) => s.division_id === div.id)
          .sort((a: any, b: any) => a.seed_no - b.seed_no);

        const confirmedIds = divSlots.map((s: any) => s.entry_id || 'BYE');

        const reconstructedSlots: KnockoutSlot[] = divSlots.map((s: any) => {
          const qualType = s.qualification_type || (
            (!s.entry_id || s.entry_id === 'BYE' || s.is_bye) ? 'bye' : (s.is_wildcard ? 'wildcard' : 'group')
          );

          let groupName: string | undefined = undefined;
          if (s.source_group_id) {
            const grp = divGroups.find(g => g.id === s.source_group_id);
            if (grp) groupName = grp.name;
          }

          return {
            seedNo: s.seed_no,
            entryId: s.entry_id || null,
            sourceLabel: s.source_label || `Seed ${s.seed_no}`,
            isWildcard: qualType === 'wildcard' || !!s.is_wildcard,
            isBye: qualType === 'bye' || !s.entry_id || s.entry_id === 'BYE' || !!s.is_bye,
            sourceGroupId: qualType === 'bye' ? undefined : (s.source_group_id || undefined),
            sourceGroupName: groupName,
            sourceGroupRank: Number.isInteger(s.source_group_rank) ? s.source_group_rank : undefined,
            qualificationType: qualType as 'group' | 'wildcard' | 'bye',
            wildcardRank: Number.isInteger(s.wildcard_rank) ? s.wildcard_rank : undefined
          };
        });

        knockoutStage = {
          matches: sortedKoMatches,
          isLocked: sortedKoMatches.some(m => m.status === 'selesai'),
          confirmedEntryIds: confirmedIds,
          slots: reconstructedSlots,
          wildcardManualRankings: validatedWildcardManualRankings,
          wildcardManualReason: div.wildcard_manual_reason?.trim() || undefined,
          wildcardManualCluster: validatedWildcardManualCluster,
          bracketArrangementMode: validatedMode,
          groupCrossPairings: validatedGroupCrossPairings,
          manualSlotAssignments: validatedManualSlotAssignments,
          manualArrangementReason: div.manual_arrangement_reason?.trim() || undefined,
          arrangementConfirmedAt: div.arrangement_confirmed_at || undefined,
          arrangementLocked: !!div.arrangement_locked,
          arrangementInvalidatedReason: div.arrangement_invalidated_reason || undefined
        };
      }

      // Division Champions
      const dChamp = (champData || []).find((c: any) => c.division_id === div.id);
      let champions: Champions | null = null;
      if (dChamp) {
        champions = {
          firstPlaceEntryId: dChamp.champion_entry_id,
          secondPlaceEntryId: dChamp.runner_up_entry_id,
          thirdPlaceEntryId: dChamp.third_place_entry_id
        };
      }

      // Division Event and Age details
      const matchedEv = events.find(e => e.id === div.match_type_id);
      const matchedAg = ageGroups.find(a => a.id === div.age_group_id);

      return {
        id: div.id,
        eventId: div.match_type_id,
        eventName: matchedEv ? matchedEv.name : 'Unknown Event',
        ageGroupId: div.age_group_id,
        ageGroupName: matchedAg ? matchedAg.name : 'Unknown Age',
        settings: {
          format: 'RR_KO',
          targetScore: div.scoring_target as any,
          winByTwo: div.win_by_two,
          playersPerGroup: div.group_size as any,
          playersQualifyingPerGroup: div.qualifiers_per_group,
          bracketSize: div.knockout_size as any,
          wildcardActive: div.wildcard_enabled,
          byeActive: div.bye_enabled,
          thirdPlaceEnabled: div.third_place_mode ? div.third_place_mode !== 'none' : (div.third_place_enabled !== false),
          thirdPlaceMode: (div.third_place_mode as any) || (div.third_place_enabled === false ? 'none' : 'playoff')
        },
        entries: divEntries,
        groups: divGroups,
        roundRobinMatches,
        knockoutStage,
        champions
      };
    });

    const revision = typeof tData.revision === 'number'
      ? tData.revision
      : (tData.revision ? parseInt(tData.revision, 10) : 1);
    const saveStatus: 'complete' | 'saving' | 'failed' =
      (tData.save_status === 'saving' || tData.save_status === 'failed') ? tData.save_status : 'complete';

    const reconstructedTournament: Tournament = {
      id: tData.id,
      name: tData.name,
      date: tData.date,
      location: tData.location || '',
      events,
      ageGroups,
      activeDivisions,
      ownerId: tData.owner_id,
      updatedAt: tData.updated_at,
      cloudUpdatedAt: tData.updated_at,
      cloudRevision: revision,
      cloudSaveStatus: saveStatus,
      cloudSyncedAt: new Date().toISOString()
    };

    return reconstructedTournament;
  } catch (err) {
    console.error('Error loading tournament from Supabase:', err);
    return null;
  }
}

// Fetch all tournaments owned by current authenticated user
export async function listUserTournaments(): Promise<{ id: string; name: string; date: string }[]> {
  if (!isSupabaseConfigured) return [];
  
  try {
    const user = await getCurrentUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('tournaments')
      .select('id, name, date')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error listing tournaments:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('Error in listUserTournaments:', err);
    return [];
  }
}

// Delete tournament from Supabase with full relational cleanup and detailed ServiceResult reporting
export async function deleteTournamentFromSupabase(tournamentId: string): Promise<ServiceResult<boolean>> {
  if (!isSupabaseConfigured) {
    return {
      success: false,
      error: {
        module: 'tournament',
        operation: 'delete',
        message: 'Database Cloud belum terkonfigurasi.',
        details: 'isSupabaseConfigured is false'
      }
    };
  }

  if (!tournamentId || !tournamentId.trim()) {
    return {
      success: false,
      error: {
        module: 'tournament',
        operation: 'delete',
        message: 'ID Turnamen tidak valid.',
        details: 'tournamentId parameter is empty'
      }
    };
  }

  try {
    const user = await getCurrentUser();
    if (!user) {
      return {
        success: false,
        error: {
          module: 'tournament',
          operation: 'delete',
          message: 'Akses ditolak: Anda harus login ke Akun Cloud untuk menghapus turnamen.',
          details: 'No active user session found'
        }
      };
    }

    // 1. Check if tournament exists and verify ownership
    const { data: existingTourney, error: fetchErr } = await supabase
      .from('tournaments')
      .select('id, owner_id, name')
      .eq('id', tournamentId)
      .maybeSingle();

    if (fetchErr) {
      return {
        success: false,
        error: {
          module: 'tournament',
          operation: 'fetch_before_delete',
          message: `Gagal memeriksa turnamen: ${fetchErr.message}`,
          details: JSON.stringify(fetchErr),
          code: fetchErr.code
        }
      };
    }

    if (!existingTourney) {
      return {
        success: false,
        error: {
          module: 'tournament',
          operation: 'delete',
          message: `Turnamen tidak ditemukan di Cloud Database (ID: ${tournamentId}).`,
          details: 'Tournament record does not exist in tournaments table'
        }
      };
    }

    if (existingTourney.owner_id && existingTourney.owner_id !== user.id) {
      return {
        success: false,
        error: {
          module: 'tournament',
          operation: 'delete_authorization',
          message: `Akses ditolak: Turnamen "${existingTourney.name}" dimiliki oleh pengguna lain.`,
          details: `Current user ID (${user.id}) does not match tournament owner ID (${existingTourney.owner_id}).`
        }
      };
    }

    // 2. Explicitly delete child relational tables in reverse dependency order
    // a. Champions
    const { error: champErr } = await supabase
      .from('champions')
      .delete()
      .eq('tournament_id', tournamentId);
    if (champErr) {
      return {
        success: false,
        error: {
          module: 'knockout',
          operation: 'delete_champions',
          message: `Gagal menghapus data juara: ${champErr.message}`,
          details: JSON.stringify(champErr),
          code: champErr.code
        }
      };
    }

    // b. Knockout Slots
    const { error: slotErr } = await supabase
      .from('knockout_slots')
      .delete()
      .eq('tournament_id', tournamentId);
    if (slotErr) {
      return {
        success: false,
        error: {
          module: 'knockout',
          operation: 'delete_knockout_slots',
          message: `Gagal menghapus bagan knockout: ${slotErr.message}`,
          details: JSON.stringify(slotErr),
          code: slotErr.code
        }
      };
    }

    // c. Matches
    const { error: matchErr } = await supabase
      .from('matches')
      .delete()
      .eq('tournament_id', tournamentId);
    if (matchErr) {
      return {
        success: false,
        error: {
          module: 'match',
          operation: 'delete_matches',
          message: `Gagal menghapus data pertandingan: ${matchErr.message}`,
          details: JSON.stringify(matchErr),
          code: matchErr.code
        }
      };
    }

    // d. Group Members (members of division_groups for this tournament)
    const { data: groupRows } = await supabase
      .from('division_groups')
      .select('id')
      .eq('tournament_id', tournamentId);

    if (groupRows && groupRows.length > 0) {
      const groupIds = groupRows.map(g => g.id);
      const { error: gmErr } = await supabase
        .from('group_members')
        .delete()
        .in('group_id', groupIds);
      if (gmErr) {
        return {
          success: false,
          error: {
            module: 'group',
            operation: 'delete_group_members',
            message: `Gagal menghapus anggota pool/grup: ${gmErr.message}`,
            details: JSON.stringify(gmErr),
            code: gmErr.code
          }
        };
      }
    }

    // e. Division Groups
    const { error: groupErr } = await supabase
      .from('division_groups')
      .delete()
      .eq('tournament_id', tournamentId);
    if (groupErr) {
      return {
        success: false,
        error: {
          module: 'group',
          operation: 'delete_division_groups',
          message: `Gagal menghapus data pool/grup: ${groupErr.message}`,
          details: JSON.stringify(groupErr),
          code: groupErr.code
        }
      };
    }

    // f. Entries (Peserta)
    const { error: entryErr } = await supabase
      .from('entries')
      .delete()
      .eq('tournament_id', tournamentId);
    if (entryErr) {
      return {
        success: false,
        error: {
          module: 'entry',
          operation: 'delete_entries',
          message: `Gagal menghapus data peserta: ${entryErr.message}`,
          details: JSON.stringify(entryErr),
          code: entryErr.code
        }
      };
    }

    // g. Divisions
    const { error: divErr } = await supabase
      .from('divisions')
      .delete()
      .eq('tournament_id', tournamentId);
    if (divErr) {
      return {
        success: false,
        error: {
          module: 'division',
          operation: 'delete_divisions',
          message: `Gagal menghapus data divisi: ${divErr.message}`,
          details: JSON.stringify(divErr),
          code: divErr.code
        }
      };
    }

    // h. Match Types (Nomor Pertandingan)
    const { error: mtErr } = await supabase
      .from('match_types')
      .delete()
      .eq('tournament_id', tournamentId);
    if (mtErr) {
      return {
        success: false,
        error: {
          module: 'division',
          operation: 'delete_match_types',
          message: `Gagal menghapus nomor pertandingan: ${mtErr.message}`,
          details: JSON.stringify(mtErr),
          code: mtErr.code
        }
      };
    }

    // i. Age Groups (Kelompok Umur)
    const { error: agErr } = await supabase
      .from('age_groups')
      .delete()
      .eq('tournament_id', tournamentId);
    if (agErr) {
      return {
        success: false,
        error: {
          module: 'division',
          operation: 'delete_age_groups',
          message: `Gagal menghapus kelompok umur: ${agErr.message}`,
          details: JSON.stringify(agErr),
          code: agErr.code
        }
      };
    }

    // j. Delete Parent Tournament row using correct primary key column 'id'
    const { error: tourneyErr } = await supabase
      .from('tournaments')
      .delete()
      .eq('id', tournamentId);

    if (tourneyErr) {
      return {
        success: false,
        error: {
          module: 'tournament',
          operation: 'delete_tournament_row',
          message: `Gagal menghapus induk turnamen dari Cloud: ${tourneyErr.message}`,
          details: JSON.stringify(tourneyErr),
          code: tourneyErr.code
        }
      };
    }

    return { success: true, data: true };
  } catch (err: any) {
    console.error('Error in deleteTournamentFromSupabase:', err);
    return {
      success: false,
      error: {
        module: 'tournament',
        operation: 'delete',
        message: err?.message || 'Terjadi kesalahan internal saat menghapus turnamen dari cloud.',
        details: JSON.stringify(err)
      }
    };
  }
}

// Fetch the single most recently updated or created tournament from Supabase
export async function getLatestTournamentFromSupabase(): Promise<Tournament | null> {
  if (!isSupabaseConfigured) return null;

  try {
    const { data, error } = await supabase
      .from('tournaments')
      .select('id')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data || !data.id) {
      console.warn('No tournament found or error fetching latest:', error);
      return null;
    }

    return await loadTournamentFromSupabase(data.id);
  } catch (err) {
    console.error('Error in getLatestTournamentFromSupabase:', err);
    return null;
  }
}
