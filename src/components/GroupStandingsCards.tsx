/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Division, GroupStandingRow } from '../types';
import { calculateGroupStandings } from '../utils/tournamentHelpers';
import { Award, ArrowRight } from 'lucide-react';

interface GroupStandingsCardsProps {
  key?: string | number;
  division: Division;
  onNavigateToDivision?: (divisionId: string) => void;
  showDivisionTitle?: boolean;
}

export default function GroupStandingsCards({
  division,
  onNavigateToDivision,
  showDivisionTitle = false
}: GroupStandingsCardsProps) {
  const { entries, groups, roundRobinMatches, settings } = division;

  if (groups.length === 0) {
    return (
      <div className="bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-6 text-center text-xs text-slate-500">
        Pembagian grup untuk divisi <strong>{division.eventName} {division.ageGroupName}</strong> belum diatur oleh panitia.
      </div>
    );
  }

  return (
    <div className="space-y-6" id={`group-standings-division-${division.id}`}>
      {showDivisionTitle && (
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2.5">
            <Award className="h-5 w-5 text-neon stroke-navy fill-neon shrink-0" />
            <div>
              <h4 className="font-extrabold text-navy text-sm md:text-base">
                Kategori: {division.eventName} {division.ageGroupName}
              </h4>
              <span className="text-[11px] text-slate-500 font-medium">
                {entries.length} Peserta Terdaftar • {groups.length} Grup
              </span>
            </div>
          </div>
          {onNavigateToDivision && (
            <button
              onClick={() => onNavigateToDivision(division.id)}
              className="text-xs font-extrabold text-navy hover:text-navy-light flex items-center gap-1 transition hover:underline cursor-pointer"
            >
              <span>Detail Divisi & Skor Match</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {groups.map(group => {
          const topQualify = settings?.playersQualifyingPerGroup || 2;
          const rows: GroupStandingRow[] = calculateGroupStandings(group, roundRobinMatches, entries, topQualify);
          const hasBoundaryTie = rows.some(r => r.isTieBoundary);
          const hasAdminOverride = group.manualRankings && Object.keys(group.manualRankings).length > 0;

          return (
            <div
              key={group.id}
              className="bg-white rounded-2xl border border-slate-200 p-5 card-shadow hover:border-slate-300 transition-colors space-y-3"
              id={`group-card-${group.id}`}
            >
              {/* Card Header: Group Name + Qualify Badge */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h5 className="font-extrabold text-navy text-base tracking-tight">{group.name}</h5>
                  {hasAdminOverride && (
                    <span
                      className="px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-300 rounded text-[10px] font-bold"
                      title={group.manualRankingReason || 'Keputusan Admin/Panitia'}
                    >
                      ⚖️ Keputusan Admin
                    </span>
                  )}
                </div>
                <span className="text-[11px] font-extrabold px-3 py-1 bg-lime-100 text-lime-900 border border-lime-300/80 rounded-full shadow-2xs">
                  Qualify: Top {topQualify}
                </span>
              </div>

              {/* Warning Banner for Boundary Tie */}
              {hasBoundaryTie && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-2.5 text-xs text-rose-800 flex items-start gap-2">
                  <span className="text-base leading-none">⚠️</span>
                  <div>
                    <strong className="font-bold block">Seri di Batas Kelolosan!</strong>
                    <span className="text-[11px]">
                      Peserta di batas kelolosan (Posisi {topQualify}) memiliki statistik & H2H seimbang. Keputusan admin diperlukan.
                    </span>
                  </div>
                </div>
              )}

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      <th className="p-2 text-center w-10">RANK</th>
                      <th className="p-2">PESERTA</th>
                      <th className="p-2 text-center w-8">M</th>
                      <th className="p-2 text-center w-8">W</th>
                      <th className="p-2 text-center w-8">L</th>
                      <th className="p-2 text-center w-10">PF</th>
                      <th className="p-2 text-center w-10">PA</th>
                      <th className="p-2 text-center w-10">DIFF</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150 text-xs font-medium">
                    {rows.map(row => {
                      const isQualifying = row.rank <= topQualify;
                      return (
                        <tr
                          key={row.entryId}
                          className={`hover:bg-slate-50/60 transition ${
                            isQualifying ? 'border-l-4 border-l-navy' : 'border-l-4 border-l-transparent'
                          }`}
                        >
                          <td className="p-2 text-center">
                            <span
                              className={`inline-flex items-center justify-center w-5 h-5 rounded-full font-black text-[10px] ${
                                row.rank === 1
                                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                  : row.rank === 2
                                  ? 'bg-slate-100 text-slate-800 border border-slate-300'
                                  : 'text-slate-500'
                              }`}
                            >
                              {row.rank}
                            </span>
                          </td>
                          <td className="p-2 font-semibold text-slate-800 max-w-[180px]" title={row.tieBreakReason || row.entryName}>
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate">{row.entryName}</span>
                                {row.needsAdminDecision && !group.manualRankings && (
                                  <span
                                    className="inline-flex items-center justify-center text-[9px] text-rose-700 font-extrabold bg-rose-50 border border-rose-200 px-1 py-0.5 rounded shrink-0"
                                    title="Seri! Perlu keputusan admin."
                                  >
                                    ⚠️ TIE
                                  </span>
                                )}
                              </div>
                              {row.tieBreakReason && (
                                <span className="text-[10px] text-slate-400 font-normal truncate">
                                  {row.tieBreakReason}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-2 text-center text-slate-600 font-semibold">{row.played}</td>
                          <td className="p-2 text-center text-emerald-600 font-extrabold">{row.won}</td>
                          <td className="p-2 text-center text-rose-500 font-extrabold">{row.lost}</td>
                          <td className="p-2 text-center text-slate-600 font-mono">{row.pointsFor}</td>
                          <td className="p-2 text-center text-slate-600 font-mono">{row.pointsAgainst}</td>
                          <td
                            className={`p-2 text-center font-bold font-mono ${
                              row.pointDifference > 0
                                ? 'text-emerald-600'
                                : row.pointDifference < 0
                                ? 'text-rose-500'
                                : 'text-slate-400'
                            }`}
                          >
                            {row.pointDifference > 0 ? `+${row.pointDifference}` : row.pointDifference}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
