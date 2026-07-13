/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tournament, Division } from '../types';
import { Trophy, Award, Medal, Users, Calendar, MapPin, CheckCircle, Clock, Download } from 'lucide-react';
import { exportTournamentToPDF } from '../utils/pdfExport';

interface OverallSummaryProps {
  tournament: Tournament;
  onNavigateToDivision?: (divisionId: string) => void;
}

export default function OverallSummary({ tournament, onNavigateToDivision }: OverallSummaryProps) {
  const { name, date, location, activeDivisions } = tournament;

  // Calculate stats
  const totalDivisions = activeDivisions.length;
  const finishedDivisions = activeDivisions.filter(d => d.champions !== null).length;
  const totalEntries = activeDivisions.reduce((acc, d) => acc + d.entries.length, 0);

  const getEntryLabel = (division: Division, id: string | null) => {
    if (!id) return '-';
    const ent = division.entries.find(e => e.id === id);
    if (!ent) return '-';
    return `${ent.name1}${ent.name2 ? ` / ${ent.name2}` : ''} ${ent.affiliation ? `(${ent.affiliation})` : ''}`;
  };

  return (
    <div className="space-y-8 animate-fade-in" id="overall-summary-panel">
      
      {/* 1. HERO BRANDING CARD */}
      <div className="bg-navy rounded-3xl p-8 text-white card-shadow relative overflow-hidden border border-navy-light" id="summary-hero-card">
        {/* Decorative background vectors */}
        <div className="absolute right-0 bottom-0 opacity-5 transform translate-x-12 translate-y-12">
          <Trophy className="h-96 w-96 text-neon" />
        </div>

        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 relative z-10">
          <div className="space-y-4 max-w-3xl">
            <span className="inline-block px-3 py-1 bg-neon/15 text-neon text-xs font-black rounded-full uppercase tracking-wider">
              Tournament Dashboard Rekapitulasi
            </span>
            <h2 className="text-3xl font-black tracking-tight">{name || 'Nama Turnamen Belum Diisi'}</h2>
            
            <div className="flex flex-wrap gap-x-6 gap-y-2 pt-2 text-sm text-slate-300">
              <div className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-neon" />
                <span>{date ? new Date(date).toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'Tanggal belum diatur'}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-neon" />
                <span>{location || 'Lokasi belum diatur'}</span>
              </div>
            </div>

            {/* Core numerical stats row */}
            <div className="grid grid-cols-3 gap-4 pt-6 border-t border-navy-light max-w-lg" id="summary-stats-counters">
              <div className="space-y-1">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Total Divisi</span>
                <div className="text-xl font-black text-white">{totalDivisions} <span className="text-xs text-slate-400 font-medium">Divisi</span></div>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Selesai Dimainkan</span>
                <div className="text-xl font-black text-neon">{finishedDivisions} <span className="text-xs text-slate-400 font-medium">Selesai</span></div>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Total Peserta</span>
                <div className="text-xl font-black text-white">{totalEntries} <span className="text-xs text-slate-400 font-medium">Entry</span></div>
              </div>
            </div>
          </div>

          {/* Export PDF Button */}
          <button
            onClick={() => exportTournamentToPDF(tournament)}
            className="flex items-center gap-2 px-5 py-3 bg-neon text-navy font-black text-xs uppercase tracking-wider rounded-xl transition duration-200 hover:bg-white hover:scale-105 shadow-md shrink-0 self-start border border-navy/10 cursor-pointer"
            title="Ekspor Seluruh Data Hasil Akhir dan Pertandingan ke PDF"
            id="export-pdf-hero-btn"
          >
            <Download className="h-4 w-4" />
            <span>Ekspor PDF</span>
          </button>
        </div>
      </div>

      {/* 2. CHAMPIONS SUMMARIES BOARD */}
      <section className="space-y-4" id="champions-recap-section">
        <h3 className="text-base font-extrabold text-navy flex items-center gap-2">
          <Trophy className="h-5 w-5 text-neon stroke-navy fill-neon" />
          Rekapitulasi Juara & Status Divisi
        </h3>

        {totalDivisions === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-150 card-shadow" id="empty-divisions-summary">
            <Users className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-600">Belum ada Divisi Pertandingan Aktif.</p>
            <p className="text-xs text-slate-450 mt-1">Harap aktifkan divisi pertandingan pada tab "Atur Turnamen & Matriks".</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" id="divisions-summary-grid">
            {activeDivisions.map(div => {
              const isFinished = div.champions !== null;
              
              return (
                <div
                  key={div.id}
                  className={`bg-white rounded-2xl border p-6 card-shadow flex flex-col justify-between transition hover:border-navy/30 ${
                    isFinished ? 'border-neon ring-1 ring-neon/20 bg-navy/[0.005]' : 'border-slate-200'
                  }`}
                  id={`div-summary-card-${div.id}`}
                >
                  <div className="space-y-4">
                    {/* Header: Title and badge */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Divisi Pertandingan</span>
                        <h4 className="font-extrabold text-navy text-sm leading-tight">
                          {div.eventName} {div.ageGroupName}
                        </h4>
                      </div>
                      
                      {isFinished ? (
                        <span className="px-2.5 py-1 bg-neon/15 text-navy text-[10px] font-black rounded-full flex items-center gap-1 shrink-0 border border-neon/30">
                          <CheckCircle className="h-3 w-3" /> Selesai
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 bg-slate-100 text-slate-700 text-[10px] font-bold rounded-full flex items-center gap-1 shrink-0 border border-slate-200">
                          <Clock className="h-3 w-3 animate-pulse" /> Berlangsung ({div.entries.length} Tim)
                        </span>
                      )}
                    </div>

                    {/* Content: Champions or Stats */}
                    {isFinished && div.champions ? (
                      <div className="space-y-2.5 pt-2 border-t border-slate-100" id={`champions-podium-list-${div.id}`}>
                        {/* Gold */}
                        <div className="flex items-center gap-2 text-xs">
                          <span className="w-6 h-6 rounded-full bg-neon text-navy flex items-center justify-center font-black font-mono shrink-0 border border-navy/10 text-[11px]">1</span>
                          <div className="min-w-0">
                            <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">🥇 Champion</span>
                            <span className="font-bold text-navy truncate block">{getEntryLabel(div, div.champions.firstPlaceEntryId)}</span>
                          </div>
                        </div>

                        {/* Silver */}
                        <div className="flex items-center gap-2 text-xs">
                          <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-800 flex items-center justify-center font-bold font-mono shrink-0 border border-slate-200 text-[11px]">2</span>
                          <div className="min-w-0">
                            <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">🥈 Runner Up</span>
                            <span className="font-bold text-slate-700 truncate block">{getEntryLabel(div, div.champions.secondPlaceEntryId)}</span>
                          </div>
                        </div>

                        {/* Bronze */}
                        <div className="flex items-center gap-2 text-xs">
                          <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-900 flex items-center justify-center font-bold font-mono shrink-0 border border-amber-200 text-[11px]">3</span>
                          <div className="min-w-0">
                            <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">🥉 Juara 3</span>
                            <span className="font-bold text-slate-700 truncate block">{getEntryLabel(div, div.champions.thirdPlaceEntryId)}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="pt-4 border-t border-slate-100 space-y-2 text-xs text-slate-500" id={`in-progress-info-${div.id}`}>
                        <div className="flex justify-between">
                          <span>Jumlah Peserta Terdaftar:</span>
                          <strong className="text-slate-700">{div.entries.length} Peserta</strong>
                        </div>
                        <div className="flex justify-between">
                          <span>Jumlah Grup Terbentuk:</span>
                          <strong className="text-slate-700">{div.groups.length} Grup</strong>
                        </div>
                        <div className="flex justify-between">
                          <span>Jadwal Round Robin:</span>
                          <strong className="text-slate-700">
                            {div.roundRobinMatches.length > 0 
                              ? `${div.roundRobinMatches.filter(m => m.status !== 'belum_dimainkan').length} / ${div.roundRobinMatches.length} Pertandingan`
                              : 'Belum di-generate'}
                          </strong>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Quick link button to manage */}
                  {onNavigateToDivision && (
                    <div className="pt-4 mt-4 border-t border-slate-100/60 flex justify-end">
                      <button
                        onClick={() => onNavigateToDivision(div.id)}
                        className="text-xs font-extrabold text-navy hover:text-navy-light flex items-center gap-0.5 transition hover:underline"
                        id={`navigate-button-${div.id}`}
                      >
                        Kelola Divisi <Award className="h-3.5 w-3.5 text-neon stroke-navy fill-neon" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

    </div>
  );
}
