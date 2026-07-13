import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { Tournament, Division, TournamentEvent, AgeGroup, Entry, Group, Match, Champions, KnockoutStage } from '../types';

export interface UserProfile {
  id: string;
  full_name: string;
  role: string;
}

/**
 * Authentication and Profile Services
 */
export async function getCurrentUser() {
  if (!isSupabaseConfigured) return null;
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

export async function getCurrentProfile(): Promise<UserProfile | null> {
  if (!isSupabaseConfigured) return null;
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
}

/**
 * Tournament Sync Services
 */

// Helper to clean entry ID referencing fields from placeholder 'BYE' strings
const cleanEntryId = (id: string | null | undefined): string | null => {
  if (!id || id === 'BYE' || id === '') return null;
  return id;
};

// Helper to check if entry ID is valid and exists in current division's entries
const getValidEntryId = (id: string | null | undefined, validEntryIds: Set<string>): string | null => {
  const cleaned = cleanEntryId(id);
  if (cleaned && validEntryIds.has(cleaned)) {
    return cleaned;
  }
  return null;
};

// Save/Sync a complete tournament tree to the relational database
export async function saveTournamentToSupabase(tournament: Tournament): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  
  const user = await getCurrentUser();
  if (!user) {
    console.warn('User not authenticated. Cannot save to Supabase.');
    return false;
  }

  try {
    // 1. Upsert tournament header
    const { error: tError } = await supabase
      .from('tournaments')
      .upsert({
        id: tournament.id,
        owner_id: user.id,
        name: tournament.name,
        date: tournament.date,
        location: tournament.location || '',
        status: 'active',
        updated_at: new Date().toISOString()
      });

    if (tError) throw tError;

    // To prevent orphans and maintain a clean state, we delete existing child records 
    // for this tournament and insert the current ones in a fresh batch.
    // Thanks to CASCADE DELETES, removing the divisions first is safest because divisions
    // has references to match_types and age_groups. Then delete match_types and age_groups.
    const { error: d3Error } = await supabase.from('divisions').delete().eq('tournament_id', tournament.id);
    if (d3Error) throw d3Error;

    const { error: d1Error } = await supabase.from('match_types').delete().eq('tournament_id', tournament.id);
    if (d1Error) throw d1Error;

    const { error: d2Error } = await supabase.from('age_groups').delete().eq('tournament_id', tournament.id);
    if (d2Error) throw d2Error;

    // 2. Insert Match Types (events)
    if (tournament.events.length > 0) {
      const matchTypesData = tournament.events.map(ev => ({
        id: ev.id,
        tournament_id: tournament.id,
        name: ev.name,
        is_double: ev.isDouble,
        format_type: 'RR_KO'
      }));
      const { error: mtError } = await supabase.from('match_types').insert(matchTypesData);
      if (mtError) throw mtError;
    }

    // 3. Insert Age Groups
    if (tournament.ageGroups.length > 0) {
      const ageGroupsData = tournament.ageGroups.map(ag => ({
        id: ag.id,
        tournament_id: tournament.id,
        name: ag.name,
        is_open: ag.name.toLowerCase().includes('open') || ag.name.toLowerCase().includes('bebas')
      }));
      const { error: agError } = await supabase.from('age_groups').insert(ageGroupsData);
      if (agError) throw agError;
    }

    // 4. Insert Divisions
    if (tournament.activeDivisions.length > 0) {
      const divisionsData = tournament.activeDivisions.map(div => ({
        id: div.id,
        tournament_id: tournament.id,
        match_type_id: div.eventId,
        age_group_id: div.ageGroupId,
        name: `${div.eventName} ${div.ageGroupName}`,
        is_active: true,
        scoring_target: div.settings.targetScore,
        win_by_two: div.settings.winByTwo,
        group_size: div.settings.playersPerGroup,
        qualifiers_per_group: div.settings.playersQualifyingPerGroup,
        knockout_size: div.settings.bracketSize,
        wildcard_enabled: div.settings.wildcardActive,
        bye_enabled: div.settings.byeActive,
        status: div.knockoutStage ? 'knockout_stage' : (div.groups.length > 0 ? 'group_stage' : 'pending')
      }));
      const { error: divError } = await supabase.from('divisions').insert(divisionsData);
      if (divError) throw divError;

      // 5. Insert Entries (for all divisions)
      const allEntries: any[] = [];
      tournament.activeDivisions.forEach(div => {
        div.entries.forEach((ent, index) => {
          allEntries.push({
            id: ent.id,
            tournament_id: tournament.id,
            division_id: div.id,
            player1_name: ent.name1,
            player2_name: ent.name2 || null,
            club: ent.affiliation || null,
            seed: index + 1
          });
        });
      });

      if (allEntries.length > 0) {
        const { error: entError } = await supabase.from('entries').insert(allEntries);
        if (entError) throw entError;
      }

      // 6. Insert Division Groups
      const allGroups: any[] = [];
      tournament.activeDivisions.forEach(div => {
        div.groups.forEach(g => {
          allGroups.push({
            id: g.id,
            tournament_id: tournament.id,
            division_id: div.id,
            name: g.name.replace('Grup ', '') // Save as 'A', 'B', etc.
          });
        });
      });

      if (allGroups.length > 0) {
        const { error: gError } = await supabase.from('division_groups').insert(allGroups);
        if (gError) throw gError;

        // 7. Insert Group Members
        const allGroupMembers: any[] = [];
        tournament.activeDivisions.forEach(div => {
          const validEntryIds = new Set(div.entries.map(e => e.id));
          div.groups.forEach(g => {
            g.entryIds.forEach(entId => {
              const cleanedId = getValidEntryId(entId, validEntryIds);
              if (cleanedId) {
                allGroupMembers.push({
                  group_id: g.id,
                  entry_id: cleanedId
                });
              }
            });
          });
        });

        if (allGroupMembers.length > 0) {
          const { error: gmError } = await supabase.from('group_members').insert(allGroupMembers);
          if (gmError) throw gmError;
        }
      }

      // 8. Insert Matches (Round Robin + Knockout)
      const allMatches: any[] = [];
      tournament.activeDivisions.forEach(div => {
        const validEntryIds = new Set(div.entries.map(e => e.id));

        // Round Robin Matches
        div.roundRobinMatches.forEach((m, index) => {
          // Find group id by name
          const grp = div.groups.find(g => g.name === m.groupName);
          allMatches.push({
            id: m.id,
            tournament_id: tournament.id,
            division_id: div.id,
            group_id: grp ? grp.id : null,
            stage: 'round_robin',
            round: m.groupName || 'Round Robin',
            match_no: m.matchNum || index + 1,
            entry_a_id: getValidEntryId(m.entryId1, validEntryIds),
            entry_b_id: getValidEntryId(m.entryId2, validEntryIds),
            score_a: m.score1,
            score_b: m.score2,
            winner_entry_id: getValidEntryId(m.winnerId, validEntryIds),
            loser_entry_id: getValidEntryId(m.loserId, validEntryIds),
            status: m.status === 'selesai' ? 'completed' : (m.status === 'walkover' ? 'walkover' : 'scheduled'),
            is_walkover: m.status === 'walkover'
          });
        });

        // Knockout Stage Matches
        if (div.knockoutStage) {
          div.knockoutStage.matches.forEach((m, index) => {
            allMatches.push({
              id: m.id,
              tournament_id: tournament.id,
              division_id: div.id,
              group_id: null,
              stage: m.isBronzeMatch ? 'bronze' : (m.roundName === 'Final' ? 'final' : 'knockout'),
              round: m.roundName || 'Knockout',
              match_no: m.matchNum || index + 100,
              entry_a_id: getValidEntryId(m.entryId1, validEntryIds),
              entry_b_id: getValidEntryId(m.entryId2, validEntryIds),
              score_a: m.score1,
              score_b: m.score2,
              winner_entry_id: getValidEntryId(m.winnerId, validEntryIds),
              loser_entry_id: getValidEntryId(m.loserId, validEntryIds),
              status: m.status === 'selesai' ? 'completed' : (m.status === 'walkover' ? 'walkover' : 'scheduled'),
              is_walkover: m.status === 'walkover',
              next_match_id: null, // set later if needed, or simple direct state tracking
            });
          });
        }
      });

      if (allMatches.length > 0) {
        const { error: matchError } = await supabase.from('matches').insert(allMatches);
        if (matchError) throw matchError;
      }

      // 9. Insert Knockout Slots (Qualified entry rankings/seeds)
      const allKnockoutSlots: any[] = [];
      tournament.activeDivisions.forEach(div => {
        const validEntryIds = new Set(div.entries.map(e => e.id));
        if (div.knockoutStage && div.knockoutStage.confirmedEntryIds) {
          div.knockoutStage.confirmedEntryIds.forEach((entId, idx) => {
            allKnockoutSlots.push({
              tournament_id: tournament.id,
              division_id: div.id,
              seed_no: idx + 1,
              entry_id: getValidEntryId(entId, validEntryIds),
              source_label: `Seed ${idx + 1}`,
              is_wildcard: false,
              is_bye: entId === 'BYE'
            });
          });
        }
      });

      if (allKnockoutSlots.length > 0) {
        const { error: slotError } = await supabase.from('knockout_slots').insert(allKnockoutSlots);
        if (slotError) throw slotError;
      }

      // 10. Insert Champions
      const allChampions: any[] = [];
      tournament.activeDivisions.forEach(div => {
        const validEntryIds = new Set(div.entries.map(e => e.id));
        if (div.champions) {
          allChampions.push({
            id: `c-${div.id}`,
            tournament_id: tournament.id,
            division_id: div.id,
            champion_entry_id: getValidEntryId(div.champions.firstPlaceEntryId, validEntryIds),
            runner_up_entry_id: getValidEntryId(div.champions.secondPlaceEntryId, validEntryIds),
            third_place_entry_id: getValidEntryId(div.champions.thirdPlaceEntryId, validEntryIds)
          });
        }
      });

      if (allChampions.length > 0) {
        const { error: champError } = await supabase.from('champions').insert(allChampions);
        if (champError) throw champError;
      }
    }

    return true;
  } catch (err: any) {
    console.error('Failed to save tournament to Supabase:', err);
    if (typeof window !== 'undefined') {
      (window as any).lastSupabaseError = err?.message || err?.details || JSON.stringify(err);
    }
    return false;
  }
}

// Load a single deeply nested tournament object from relational tables
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

    // 2. Fetch Match Types
    const { data: mtData } = await supabase
      .from('match_types')
      .select('*')
      .eq('tournament_id', tournamentId);

    // 3. Fetch Age Groups
    const { data: agData } = await supabase
      .from('age_groups')
      .select('*')
      .eq('tournament_id', tournamentId);

    // 4. Fetch Divisions
    const { data: divData } = await supabase
      .from('divisions')
      .select('*')
      .eq('tournament_id', tournamentId);

    // 5. Fetch Entries
    const { data: entData } = await supabase
      .from('entries')
      .select('*')
      .eq('tournament_id', tournamentId);

    // 6. Fetch Division Groups
    const { data: gData } = await supabase
      .from('division_groups')
      .select('*')
      .eq('tournament_id', tournamentId);

    // 7. Fetch Group Members
    const groupIds = gData ? gData.map(g => g.id) : [];
    let gmData: any[] = [];
    if (groupIds.length > 0) {
      const { data: fetchedGm } = await supabase
        .from('group_members')
        .select('*')
        .in('group_id', groupIds);
      gmData = fetchedGm || [];
    }

    // 8. Fetch Matches
    const { data: matchData } = await supabase
      .from('matches')
      .select('*')
      .eq('tournament_id', tournamentId);

    // 9. Fetch Knockout Slots
    const { data: slotData } = await supabase
      .from('knockout_slots')
      .select('*')
      .eq('tournament_id', tournamentId);

    // 10. Fetch Champions
    const { data: champData } = await supabase
      .from('champions')
      .select('*')
      .eq('tournament_id', tournamentId);

    // Reconstruct Tournament Events
    const events: TournamentEvent[] = (mtData || []).map(mt => ({
      id: mt.id,
      name: mt.name,
      isDouble: mt.is_double
    }));

    // Reconstruct Age Groups
    const ageGroups: AgeGroup[] = (agData || []).map(ag => ({
      id: ag.id,
      name: ag.name
    }));

    // Reconstruct Active Divisions
    const activeDivisions: Division[] = (divData || []).map(div => {
      // Find divisions' entries
      const divEntries: Entry[] = (entData || [])
        .filter(e => e.division_id === div.id)
        .sort((a, b) => (a.seed || 0) - (b.seed || 0))
        .map(e => ({
          id: e.id,
          name1: e.player1_name,
          name2: e.player2_name || undefined,
          affiliation: e.club || undefined
        }));

      // Find division's groups
      const divGroups: Group[] = (gData || [])
        .filter(g => g.division_id === div.id)
        .map(g => {
          // get entryIds for this group
          const memberIds = gmData
            .filter(gm => gm.group_id === g.id)
            .map(gm => gm.entry_id);
          return {
            id: g.id,
            name: `Grup ${g.name}`,
            entryIds: memberIds
          };
        });

      // Find division's matches
      const divMatches = (matchData || []).filter(m => m.division_id === div.id);
      
      // Round Robin Matches
      const roundRobinMatches: Match[] = divMatches
        .filter(m => m.stage === 'round_robin')
        .map(m => ({
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
      const koMatches = divMatches.filter(m => m.stage === 'knockout' || m.stage === 'bronze' || m.stage === 'final');
      let knockoutStage: KnockoutStage | null = null;

      if (koMatches.length > 0 || (slotData && slotData.some(s => s.division_id === div.id))) {
        const sortedKoMatches: Match[] = koMatches.map(m => ({
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
          .filter(s => s.division_id === div.id)
          .sort((a, b) => a.seed_no - b.seed_no)
          .map(s => s.entry_id || 'BYE');

        knockoutStage = {
          matches: sortedKoMatches,
          isLocked: sortedKoMatches.some(m => m.status === 'selesai'),
          confirmedEntryIds: confirmedIds
        };
      }

      // Division Champions
      const dChamp = (champData || []).find(c => c.division_id === div.id);
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
      activeDivisions: activeDivisions,
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
}

// Delete tournament from Supabase
export async function deleteTournamentFromSupabase(tournamentId: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const { error } = await supabase
    .from('tournaments')
    .delete()
    .eq('id', tournamentId);

  if (error) {
    console.error('Error deleting tournament from Supabase:', error);
    return false;
  }

  return true;
}
