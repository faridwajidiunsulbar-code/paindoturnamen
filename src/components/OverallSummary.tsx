/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tournament, Division } from '../types';
import { Trophy, Award, Medal, Users, Calendar, MapPin, CheckCircle, Clock, Download, Info, Calculator, Zap, ShieldAlert } from 'lucide-react';
import { exportTournamentToPDF } from '../utils/pdfExport';

interface OverallSummaryProps {
  tournament: Tournament;
  onNavigateToDivision?: (divisionId: string) => void;
  isAdmin?: boolean;
}

export default function OverallSummary({ tournament, onNavigateToDivision, isAdmin = true }: OverallSummaryProps) {
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
          {isAdmin && (
            <button
              onClick={() => exportTournamentToPDF(tournament)}
              className="flex items-center gap-2 px-5 py-3 bg-neon text-navy font-black text-xs uppercase tracking-wider rounded-xl transition duration-200 hover:bg-white hover:scale-105 shadow-md shrink-0 self-start border border-navy/10 cursor-pointer"
              title="Ekspor Seluruh Data Hasil Akhir dan Pertandingan ke PDF"
              id="export-pdf-hero-btn"
            >
              <Download className="h-4 w-4" />
              <span>Ekspor PDF</span>
            </button>
          )}
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
                        {isAdmin ? 'Kelola Divisi' : 'Lihat Detail Divisi'} <Award className="h-3.5 w-3.5 text-neon stroke-navy fill-neon" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. GUIDE & SYSTEM EXPLANATION PANEL */}
      <section className="bg-white rounded-3xl border border-slate-200 p-6 md:p-8 card-shadow space-y-6" id="tournament-system-guide">
        <div className="border-b border-slate-100 pb-4 flex items-center gap-3">
          <div className="p-2 bg-navy rounded-xl text-neon shrink-0">
            <Info className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-navy">Panduan & Informasi Sistem Turnamen</h3>
            <p className="text-xs text-slate-450">Pelajari cara kerja sistem, perhitungan klasemen, dan kelulusan ke babak gugur.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Card 1: Tentang Aplikasi */}
          <div className="space-y-3 bg-softbg/40 p-5 rounded-2xl border border-slate-100" id="guide-about-app">
            <div className="flex items-center gap-2 text-navy">
              <Zap className="h-4 w-4 text-navy fill-neon" />
              <h4 className="text-xs font-black uppercase tracking-wider">Tentang Aplikasi</h4>
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              Aplikasi ini dirancang khusus untuk mengelola Turnamen <strong>Pickleball</strong> secara komprehensif dan profesional. 
              Sistem mendukung pembentukan divisi pertandingan berdasarkan kategori (Tunggal/Ganda) dan kelompok umur secara fleksibel.
            </p>
            <ul className="text-[11px] text-slate-500 space-y-1 pl-4 list-disc">
              <li>Pendaftaran praktis terintegrasi kolam pemain</li>
              <li>Pembagian grup & pembuatan jadwal otomatis</li>
              <li>Penyusunan klasemen real-time babak penyisihan</li>
              <li>Generasi bagan babak gugur instan dan ekspor PDF</li>
            </ul>
          </div>

          {/* Card 2: Perhitungan Klasemen */}
          <div className="space-y-3 bg-softbg/40 p-5 rounded-2xl border border-slate-100" id="guide-scoring-rules">
            <div className="flex items-center gap-2 text-navy">
              <Calculator className="h-4 w-4 text-navy" />
              <h4 className="text-xs font-black uppercase tracking-wider">Kriteria & Tie-Breaker</h4>
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              Peringkat dalam penyisihan grup ditentukan secara berurutan berdasarkan kriteria baku berikut untuk menjamin keadilan:
            </p>
            <ol className="text-[11px] text-slate-500 space-y-1.5 pl-4 list-decimal">
              <li>
                <strong className="text-slate-700">Jumlah Menang:</strong> Dihitung berdasarkan jumlah pertandingan yang berhasil dimenangkan.
              </li>
              <li>
                <strong className="text-slate-700">Selisih Poin:</strong> Total skor yang dicetak dikurangi skor kemasukan <span className="font-mono text-[10px] bg-slate-100 px-1 py-0.5 rounded text-navy">(Poin Masuk - Poin Keluar)</span>.
              </li>
              <li>
                <strong className="text-slate-700">Head-to-Head (H2H):</strong> Berlaku eksklusif jika <strong>hanya terdapat tepat 2 tim</strong> yang memiliki jumlah kemenangan & selisih poin yang sama.
              </li>
              <li>
                <strong className="text-slate-700">Poin Masuk Terbanyak:</strong> Tim dengan akumulasi poin mencetak angka tertinggi.
              </li>
              <li>
                <strong className="text-slate-700">Keputusan Admin:</strong> Diperlukan intervensi manual jika seluruh parameter di atas sepenuhnya seri.
              </li>
            </ol>
          </div>

          {/* Card 3: Kelulusan & Babak Gugur */}
          <div className="space-y-3 bg-softbg/40 p-5 rounded-2xl border border-slate-100" id="guide-qualification">
            <div className="flex items-center gap-2 text-navy">
              <Trophy className="h-4 w-4 text-navy fill-neon" />
              <h4 className="text-xs font-black uppercase tracking-wider">Mekanisme Kelulusan</h4>
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              Transisi dari babak penyisihan (grup) menuju ke babak gugur (Knockout) diatur melalui parameter berikut:
            </p>
            <ul className="text-[11px] text-slate-500 space-y-1.5 pl-4 list-disc">
              <li>
                <strong className="text-slate-700">Direct Qualifier (Lolos Langsung):</strong> Berdasarkan kuota kelulusan per grup (misal: Top 2 terbaik dari setiap grup).
              </li>
              <li>
                <strong className="text-slate-700">Wildcard (Kuota Tambahan):</strong> Jika total tim yang lolos langsung kurang dari kapasitas ukuran bagan (bracket 4, 8, atau 16), sistem akan memilih tim berperingkat terbaik berikutnya dari lintas grup.
              </li>
              <li>
                <strong className="text-slate-700">Aturan Win by 2 & WO:</strong> Skor target dapat menggunakan aturan <em>Win by 2</em>. Untuk kemenangan WO (Walkover), tim pemenang mendapat poin penuh sesuai target skor (misal: 11-0 atau 15-0).
              </li>
            </ul>
          </div>

        </div>

        {/* Hal Penting Lainnya Banner */}
        <div className="bg-amber-50 border border-amber-200/60 rounded-2xl p-4 flex gap-3 text-amber-900" id="guide-important-notes">
          <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h5 className="text-xs font-black uppercase tracking-wider text-amber-800">Catatan Penting bagi Panitia</h5>
            <ul className="text-[11px] text-amber-700 space-y-1 list-disc pl-4">
              <li>Pastikan semua pertandingan dalam satu grup diselesaikan dan diinput skornya sebelum melakukan konfirmasi kelulusan ke babak gugur.</li>
              <li>Mengubah pendaftaran peserta atau pembagian grup setelah jadwal pertandingan digenerate akan me-reset data pertandingan grup tersebut.</li>
              <li>Pada babak gugur, pemenang babak Semifinal akan melaju secara otomatis ke partai <strong>Final</strong>, sedangkan tim yang kalah otomatis melaju ke perebutan <strong>Juara 3</strong>.</li>
            </ul>
          </div>
        </div>
      </section>

    </div>
  );
}
