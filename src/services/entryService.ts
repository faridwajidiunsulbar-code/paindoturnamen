import { saveTournamentToSupabase } from './tournamentService';
import { Tournament, Entry } from '../types';

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

  return saveTournamentToSupabase({
    ...tournament,
    activeDivisions: updatedDivisions
  });
}
