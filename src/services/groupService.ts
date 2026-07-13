import { saveTournamentToSupabase } from './tournamentService';
import { Tournament, Group } from '../types';

/**
 * Service to handle tournament round-robin groups.
 * Ensures consistent group definitions are persistent on Supabase.
 */
export async function updateDivisionGroups(
  tournament: Tournament,
  divisionId: string,
  groups: Group[]
): Promise<boolean> {
  const updatedDivisions = tournament.activeDivisions.map(div => {
    if (div.id === divisionId) {
      return {
        ...div,
        groups
      };
    }
    return div;
  });

  return saveTournamentToSupabase({
    ...tournament,
    activeDivisions: updatedDivisions
  });
}
