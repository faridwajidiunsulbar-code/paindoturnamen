import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { Tournament, Division, TournamentEvent, AgeGroup, Entry, Group, Match, Champions, KnockoutStage, ServiceResult } from '../types';
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
export async function saveTournamentToSupabase(tournament: Tournament): Promise<ServiceResult<boolean>> {
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

    // 1. Upsert tournament header
    const tourneyPayload: any = {
      id: tournament.id,
      name: tournament.name,
      date: tournament.date,
      location: tournament.location || '',
      status: 'active',
      updated_at: new Date().toISOString()
    };
    if (user?.id) {
      tourneyPayload.owner_id = user.id;
    }

    const { error: tError } = await supabase
      .from('tournaments')
      .upsert(tourneyPayload);

    if (tError) {
      return {
        success: false,
        error: { module: 'tournament', operation: 'insert', message: `[Tournaments Table] ${tError.message || JSON.stringify(tError)}` }
      };
    }

    // 2. Delegate Division Domain save (cleans & upserts match_types, age_groups, divisions)
    const divResult = await saveDivisionsToSupabase(tournament);
    if (!divResult.success) {
      return divResult;
    }

    // 3. Delegate Entry Domain save (cleans & upserts entries)
    const entResult = await saveEntriesToSupabase(tournament);
    if (!entResult.success) {
      return { success: false, error: (entResult as { success: false; error: any }).error };
    }
    const insertedEntryIds = entResult.data.insertedEntryIds;

    // 4. Delegate Group Domain save (cleans & upserts division_groups and group_members)
    const grpResult = await saveGroupsAndMembersToSupabase(tournament, insertedEntryIds);
    if (!grpResult.success) {
      return grpResult;
    }

    // 5. Delegate Match Domain save (cleans & upserts round_robin and knockout matches)
    const matchResult = await saveMatchesToSupabase(tournament, insertedEntryIds);
    if (!matchResult.success) {
      return matchResult;
    }

    // 6. Delegate Knockout & Champions Domain save (cleans & upserts knockout_slots and champions)
    const koResult = await saveKnockoutSlotsAndChampionsToSupabase(tournament, insertedEntryIds);
    if (!koResult.success) {
      return koResult;
    }

    return { success: true, data: true };
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
          return {
            id: g.id,
            name: groupName,
            entryIds: memberIds
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

      if (koMatches.length > 0 || (slotData && slotData.some((s: any) => s.division_id === div.id))) {
        const sortedKoMatches: Match[] = koMatches.map((m: any) => ({
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
          matchNum: m.match_no
        }));

        const confirmedIds = (slotData || [])
          .filter((s: any) => s.division_id === div.id)
          .sort((a: any, b: any) => a.seed_no - b.seed_no)
          .map((s: any) => s.entry_id || 'BYE');

        knockoutStage = {
          matches: sortedKoMatches,
          isLocked: sortedKoMatches.some(m => m.status === 'selesai'),
          confirmedEntryIds: confirmedIds
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
          byeActive: div.bye_enabled
        },
        entries: divEntries,
        groups: divGroups,
        roundRobinMatches,
        knockoutStage,
        champions
      };
    });

    const reconstructedTournament: Tournament = {
      id: tData.id,
      name: tData.name,
      date: tData.date,
      location: tData.location || '',
      events,
      ageGroups,
      activeDivisions,
      ownerId: tData.owner_id
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

// Delete tournament from Supabase
export async function deleteTournamentFromSupabase(tournamentId: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  try {
    const { error } = await supabase
      .from('tournaments')
      .delete()
      .eq('tournament_id', tournamentId) || await supabase.from('tournaments').delete().eq('id', tournamentId);

    if (error) {
      console.error('Error deleting tournament from Supabase:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Error in deleteTournamentFromSupabase:', err);
    return false;
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
