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

  // Local helper functions to scope event/age/division IDs per tournament in the database
  const getDbEventId = (id: string) => {
    if (!id) return id;
    if (id.includes(tournament.id)) return id;
    return `${id}-${tournament.id}`;
  };

  const getDbAgeGroupId = (id: string) => {
    if (!id) return id;
    if (id.includes(tournament.id)) return id;
    return `${id}-${tournament.id}`;
  };

  const getDbDivisionId = (id: string) => {
    if (!id) return id;
    if (id.includes(tournament.id)) return id;
    return `${id}-${tournament.id}`;
  };

  const getDbGroupId = (id: string, dbDivId: string) => {
    if (!id) return id;
    if (id.includes(dbDivId)) return id;
    return `${id}-${dbDivId}`;
  };

  try {
    // 0. Ensure user has a profile in public.profiles table to prevent foreign key violations on tournament owner_id
    const { data: profileCheck, error: checkErr } = await supabase
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
    // We explicitly clean up all child tables in correct dependency order to prevent
    // any duplicate key or foreign key violation issues.
    const { error: delChampError } = await supabase.from('champions').delete().eq('tournament_id', tournament.id);
    if (delChampError) throw delChampError;

    const { error: delSlotError } = await supabase.from('knockout_slots').delete().eq('tournament_id', tournament.id);
    if (delSlotError) throw delSlotError;

    const { error: delMatchError } = await supabase.from('matches').delete().eq('tournament_id', tournament.id);
    if (delMatchError) throw delMatchError;

    // Fetch and delete group_members associated with this tournament's division groups first
    // to prevent RLS cascade delete errors in PostgreSQL.
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
      if (delGMErr) throw delGMErr;
    }

    const { error: delGroupError } = await supabase.from('division_groups').delete().eq('tournament_id', tournament.id);
    if (delGroupError) throw delGroupError;

    const { error: delEntryError } = await supabase.from('entries').delete().eq('tournament_id', tournament.id);
    if (delEntryError) throw delEntryError;

    const { error: delDivError } = await supabase.from('divisions').delete().eq('tournament_id', tournament.id);
    if (delDivError) throw delDivError;

    const { error: delMTError } = await supabase.from('match_types').delete().eq('tournament_id', tournament.id);
    if (delMTError) throw delMTError;

    const { error: delAGError } = await supabase.from('age_groups').delete().eq('tournament_id', tournament.id);
    if (delAGError) throw delAGError;

    // 2. Insert Match Types (events) - de-duplicated by database-scoped ID
    if (tournament.events.length > 0) {
      const uniqueEventsMap = new Map<string, any>();
      tournament.events.forEach(ev => {
        const dbId = getDbEventId(ev.id);
        uniqueEventsMap.set(dbId, {
          id: dbId,
          tournament_id: tournament.id,
          name: ev.name,
          is_double: ev.isDouble,
          format_type: 'RR_KO'
        });
      });
      
      const matchTypesData = Array.from(uniqueEventsMap.values());
      const { error: mtError } = await supabase.from('match_types').insert(matchTypesData);
      if (mtError) throw mtError;
    }

    // 3. Insert Age Groups - de-duplicated by database-scoped ID
    if (tournament.ageGroups.length > 0) {
      const uniqueAgeGroupsMap = new Map<string, any>();
      tournament.ageGroups.forEach(ag => {
        const dbId = getDbAgeGroupId(ag.id);
        uniqueAgeGroupsMap.set(dbId, {
          id: dbId,
          tournament_id: tournament.id,
          name: ag.name,
          is_open: ag.name.toLowerCase().includes('open') || ag.name.toLowerCase().includes('bebas')
        });
      });

      const ageGroupsData = Array.from(uniqueAgeGroupsMap.values());
      const { error: agError } = await supabase.from('age_groups').insert(ageGroupsData);
      if (agError) throw agError;
    }

    // 4. Insert Divisions - de-duplicated by database-scoped ID
    // CRITICAL: We only save active divisions that point to currently valid event IDs and age group IDs
    const validEventIds = new Set(tournament.events.map(ev => ev.id));
    const validAgeGroupIds = new Set(tournament.ageGroups.map(ag => ag.id));
    const validActiveDivisions = (tournament.activeDivisions || []).filter(div => 
      validEventIds.has(div.eventId) && validAgeGroupIds.has(div.ageGroupId)
    );

    if (validActiveDivisions.length > 0) {
      const uniqueDivisionsMap = new Map<string, any>();
      validActiveDivisions.forEach(div => {
        const dbId = getDbDivisionId(div.id);
        uniqueDivisionsMap.set(dbId, {
          id: dbId,
          tournament_id: tournament.id,
          match_type_id: getDbEventId(div.eventId),
          age_group_id: getDbAgeGroupId(div.ageGroupId),
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
        });
      });

      const divisionsData = Array.from(uniqueDivisionsMap.values());
      const { error: divError } = await supabase.from('divisions').insert(divisionsData);
      if (divError) throw divError;

      // 5. Insert Entries (for all divisions) - de-duplicated by ID
      const uniqueEntriesMap = new Map<string, any>();
      validActiveDivisions.forEach(div => {
        const dbDivId = getDbDivisionId(div.id);
        div.entries.forEach((ent, index) => {
          uniqueEntriesMap.set(ent.id, {
            id: ent.id,
            tournament_id: tournament.id,
            division_id: dbDivId,
            player1_name: ent.name1,
            player2_name: ent.name2 || null,
            club: ent.affiliation || null,
            seed: index + 1
          });
        });
      });

      const allEntries = Array.from(uniqueEntriesMap.values());
      if (allEntries.length > 0) {
        const { error: entError } = await supabase.from('entries').insert(allEntries);
        if (entError) throw entError;
      }

      // 6. Insert Division Groups - de-duplicated by ID
      const uniqueGroupsMap = new Map<string, any>();
      validActiveDivisions.forEach(div => {
        const dbDivId = getDbDivisionId(div.id);
        div.groups.forEach(g => {
          const dbGrpId = getDbGroupId(g.id, dbDivId);
          uniqueGroupsMap.set(dbGrpId, {
            id: dbGrpId,
            tournament_id: tournament.id,
            division_id: dbDivId,
            name: g.name.replace('Grup ', '') // Save as 'A', 'B', etc.
          });
        });
      });

      const allGroups = Array.from(uniqueGroupsMap.values());
      if (allGroups.length > 0) {
        const { error: gError } = await supabase.from('division_groups').insert(allGroups);
        if (gError) throw gError;

        // 7. Insert Group Members
        const allGroupMembers: any[] = [];
        validActiveDivisions.forEach(div => {
          const dbDivId = getDbDivisionId(div.id);
          const validEntryIds = new Set(div.entries.map(e => e.id));
          div.groups.forEach(g => {
            const dbGrpId = getDbGroupId(g.id, dbDivId);
            g.entryIds.forEach(entId => {
              const cleanedId = getValidEntryId(entId, validEntryIds);
              if (cleanedId) {
                allGroupMembers.push({
                  group_id: dbGrpId,
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
      const uniqueMatchesMap = new Map<string, any>();
      validActiveDivisions.forEach(div => {
        const dbDivId = getDbDivisionId(div.id);
        const validEntryIds = new Set(div.entries.map(e => e.id));

        // Round Robin Matches
        div.roundRobinMatches.forEach((m, index) => {
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
            uniqueMatchesMap.set(m.id, {
              id: m.id,
              tournament_id: tournament.id,
              division_id: dbDivId,
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
              next_match_id: null,
            });
          });
        }
      });

      const allMatches = Array.from(uniqueMatchesMap.values());
      if (allMatches.length > 0) {
        const { error: matchError } = await supabase.from('matches').insert(allMatches);
        if (matchError) throw matchError;
      }

      // 9. Insert Knockout Slots (Qualified entry rankings/seeds)
      const allKnockoutSlots: any[] = [];
      validActiveDivisions.forEach(div => {
        const dbDivId = getDbDivisionId(div.id);
        const validEntryIds = new Set(div.entries.map(e => e.id));
        if (div.knockoutStage && div.knockoutStage.confirmedEntryIds) {
          div.knockoutStage.confirmedEntryIds.forEach((entId, idx) => {
            allKnockoutSlots.push({
              tournament_id: tournament.id,
              division_id: dbDivId,
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
      validActiveDivisions.forEach(div => {
        const dbDivId = getDbDivisionId(div.id);
        const validEntryIds = new Set(div.entries.map(e => e.id));
        if (div.champions) {
          allChampions.push({
            id: `c-${dbDivId}`,
            tournament_id: tournament.id,
            division_id: dbDivId,
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
      .eq('id', tournamentId);

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
