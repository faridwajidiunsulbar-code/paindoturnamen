import { saveTournamentToSupabase } from './tournamentService';
import { Tournament, Match } from '../types';

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

  return saveTournamentToSupabase({
    ...tournament,
    activeDivisions: updatedDivisions
  });
}
