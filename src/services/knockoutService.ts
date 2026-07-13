import { saveTournamentToSupabase } from './tournamentService';
import { Tournament, KnockoutStage } from '../types';

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

  return saveTournamentToSupabase({
    ...tournament,
    activeDivisions: updatedDivisions
  });
}
