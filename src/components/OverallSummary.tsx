/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tournament, Division, Entry } from '../types';
import { Trophy, Award, Medal, Users, Calendar, MapPin, CheckCircle, Clock, Download, Info, Calculator, Zap, ShieldAlert } from 'lucide-react';
import { exportTournamentToPDF } from '../utils/pdfExport';
import GroupStandingsCards from './GroupStandingsCards';

interface OverallSummaryProps {
  tournament: Tournament;
  onNavigateToDivision?: (divisionId: string) => void;
  isAdmin?: boolean;
  onExportPdf?: () => void;
}

export default function OverallSummary({ tournament, onNavigateToDivision, isAdmin = true, onExportPdf }: OverallSummaryProps) {
  const { name, date, location, activeDivisions } = tournament;

  // Calculate stats
  const totalDivisions = activeDivisions.length;
  const finishedDivisions = activeDivisions.filter(d => d.champions !== null).length;
  const totalEntries = activeDivisions.reduce((acc, d) => acc + d.entries.length, 0);

  // Divisions that have configured groups
  const configuredDivisions = activeDivisions.filter(d => d.groups && d.groups.length > 0);

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
              onClick={() => {
                if (onExportPdf) {
                  onExportPdf();
                } else {
                  const audit = tournament.activeDivisions.map(div => ({
                    id: div.id,
                    entryCount: div.entries?.length ?? 0,
                    entries: div.entries?.map(entry => ({
                      id: entry.id,
                      name1: entry.name1,
                      name2: entry.name2
                    }))
                  }));
                  console.log('PDF_BUTTON_STATE_AUDIT', audit);
                  const entriesByDivMap = new Map<string, Entry[]>();
                  (tournament.activeDivisions || []).forEach(div => {
                    const divId = String(div.id ?? '').trim();
                    entriesByDivMap.set(divId, div.entries || []);
                  });
                  exportTournamentToPDF({
                    tournament,
                    divisions: tournament.activeDivisions,
                    entriesByDivision: entriesByDivMap
                  });
                }
              }}
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

      {/* 2. KLASEMEN GRUP OTOMATIS UNTUK SEMUA DIVISI AKTIF (JIKA TELAH DIATUR) */}
      {configuredDivisions.length > 0 && (
        <section className="space-y-6" id="all-configured-standings-section">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 card-shadow flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-navy rounded-xl text-neon shrink-0 shadow-xs">
                <Trophy className="h-6 w-6 font-black" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-navy tracking-tight">Klasemen Grup Otomatis</h3>
                <p className="text-xs text-slate-500 font-medium">
                  Tampilan klasemen penyisihan grup otomatis untuk seluruh kategori divisi pertandingan yang aktif.
                </p>
              </div>
            </div>
            <span className="self-start md:self-auto px-3 py-1 bg-lime-100 text-lime-900 border border-lime-300/80 text-xs font-extrabold rounded-full shrink-0">
              {configuredDivisions.length} Divisi Aktif Terkonfigurasi
            </span>
          </div>

          <div className="space-y-8">
            {configuredDivisions.map(div => (
              <GroupStandingsCards
                key={div.id}
                division={div}
                onNavigateToDivision={onNavigateToDivision}
                showDivisionTitle={true}
              />
            ))}
          </div>
        </section>
      )}

      {/* 3. CHAMPIONS SUMMARIES BOARD */}
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
            <p className="text-xs text-slate-450">Pelajari cara kerja sistem, aturan perhitungan klasemen, mekanisme kelolosan, dan pengelolaan babak gugur.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Card 1: Tentang Aplikasi */}
          <div className="space-y-3 bg-softbg/40 p-5 rounded-2xl border border-slate-100 flex flex-col justify-between" id="guide-about-app">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-navy">
                <Zap className="h-4 w-4 text-navy fill-neon" />
                <h4 className="text-xs font-black uppercase tracking-wider">Tentang Aplikasi</h4>
              </div>
              <p className="text-xs leading-relaxed text-slate-600">
                PAINDO dirancang untuk membantu panitia mengelola turnamen pickleball secara terstruktur, mulai dari pendaftaran peserta hingga penetapan hasil akhir.
              </p>
              <p className="text-xs leading-relaxed text-slate-600">
                Sistem mendukung pertandingan tunggal maupun ganda, pengelompokan berdasarkan kategori dan kelompok umur, pembagian grup, penyusunan jadwal, pencatatan hasil pertandingan, klasemen, serta babak gugur.
              </p>
            </div>
            <ul className="text-[11px] text-slate-500 space-y-1.5 pl-4 list-disc mt-2">
              <li>Pendaftaran peserta dan pasangan per divisi</li>
              <li>Pembagian grup secara otomatis maupun manual</li>
              <li>Pembuatan jadwal round robin tanpa pertandingan ganda</li>
              <li>Pencatatan skor, Walkover, dan koreksi oleh admin</li>
              <li>Perhitungan klasemen dan penentuan peserta yang lolos</li>
              <li>Penyusunan bracket knockout dan rekap hasil akhir</li>
              <li>Penyimpanan data ke Cloud Database dan ekspor laporan PDF</li>
            </ul>
          </div>

          {/* Card 2: Kriteria & Tie-Breaker */}
          <div className="space-y-3 bg-softbg/40 p-5 rounded-2xl border border-slate-100 flex flex-col justify-between" id="guide-scoring-rules">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-navy">
                <Calculator className="h-4 w-4 text-navy" />
                <h4 className="text-xs font-black uppercase tracking-wider">Kriteria & Tie-Breaker</h4>
              </div>
              <p className="text-xs leading-relaxed text-slate-600">
                Peringkat pada fase grup ditentukan menggunakan urutan kriteria berikut:
              </p>
              <ol className="text-[11px] text-slate-500 space-y-2 pl-4 list-decimal">
                <li>
                  <strong className="text-slate-700">Jumlah Menang:</strong> Tim dengan jumlah kemenangan lebih banyak menempati peringkat yang lebih tinggi.
                </li>
                <li>
                  <strong className="text-slate-700">Poin Masuk:</strong> Jika jumlah kemenangan sama, tim dengan total poin yang dicetak lebih banyak berada di posisi lebih tinggi.
                </li>
                <li>
                  <strong className="text-slate-700">Selisih Poin:</strong> Jika masih sama, digunakan selisih antara poin masuk dan poin kemasukan.
                  <div className="mt-1 mb-0.5">
                    <span className="font-mono text-[10px] bg-slate-100 px-2 py-0.5 rounded text-navy border border-slate-200 font-bold inline-block">
                      Selisih Poin = Poin Masuk − Poin Kemasukan
                    </span>
                  </div>
                </li>
                <li>
                  <strong className="text-slate-700">Head-to-Head (H2H):</strong> Digunakan hanya apabila tepat dua tim masih memiliki nilai yang sama pada jumlah menang, poin masuk, dan selisih poin. Tim yang memenangkan pertemuan langsung ditempatkan lebih tinggi.
                </li>
                <li>
                  <strong className="text-slate-700">Keputusan Admin:</strong> Diperlukan apabila hasil masih seri, Head-to-Head tidak dapat diterapkan, atau terdapat tiga tim atau lebih dengan nilai yang sama. Keputusan admin wajib disertai alasan.
                </li>
              </ol>
            </div>
          </div>

          {/* Card 3: Mekanisme Kelolosan */}
          <div className="space-y-3 bg-softbg/40 p-5 rounded-2xl border border-slate-100 flex flex-col justify-between" id="guide-qualification">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-navy">
                <Trophy className="h-4 w-4 text-navy fill-neon" />
                <h4 className="text-xs font-black uppercase tracking-wider">Mekanisme Kelolosan</h4>
              </div>
              <p className="text-xs leading-relaxed text-slate-600">
                Perpindahan peserta dari fase grup ke babak gugur ditentukan berdasarkan konfigurasi kelolosan pada setiap divisi.
              </p>
              <ul className="text-[11px] text-slate-500 space-y-2 pl-4 list-disc">
                <li>
                  <strong className="text-slate-700">Lolos Langsung:</strong> Peserta terbaik dari setiap grup lolos sesuai kuota yang telah ditentukan, misalnya dua peringkat teratas dari masing-masing grup.
                </li>
                <li>
                  <strong className="text-slate-700">Wildcard:</strong> Jika jumlah peserta yang lolos langsung belum memenuhi kapasitas bracket, slot tambahan diberikan kepada peserta terbaik berikutnya berdasarkan perbandingan klasemen lintas grup.
                </li>
                <li>
                  <strong className="text-slate-700">Penempatan Bracket:</strong> Peserta yang lolos ditempatkan ke dalam slot knockout berdasarkan hasil grup dan aturan silang grup agar peserta dari grup yang sama tidak langsung bertemu apabila konfigurasi memungkinkan.
                </li>
                <li>
                  <strong className="text-slate-700">Walkover (WO):</strong> Kemenangan WO dapat dicatat dengan skor manual yang sah, misalnya 11–0, 15–0, atau 21–0. Alasan WO wajib dicantumkan.
                </li>
                <li>
                  <strong className="text-slate-700">Perebutan Juara 3:</strong> Penentuan peringkat ketiga mengikuti konfigurasi divisi: 1. pertandingan perebutan Juara 3; 2. dua peraih Juara 3 bersama; 3. atau tanpa penetapan Juara 3.
                </li>
              </ul>
            </div>
          </div>

        </div>

        {/* Hal Penting Lainnya Banner */}
        <div className="bg-amber-50 border border-amber-200/60 rounded-2xl p-4 flex gap-3 text-amber-900" id="guide-important-notes">
          <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1.5">
            <h5 className="text-xs font-black uppercase tracking-wider text-amber-800">Catatan Penting bagi Panitia</h5>
            <ul className="text-[11px] text-amber-700 space-y-1.5 list-disc pl-4">
              <li>Pastikan seluruh pertandingan dalam grup telah selesai dan hasilnya sudah tersimpan sebelum mengonfirmasi kelolosan ke babak gugur.</li>
              <li>Perubahan peserta, pasangan, atau pembagian grup dapat dibatasi apabila jadwal, skor, bracket, atau hasil akhir sudah terbentuk.</li>
              <li>Koreksi setelah pertandingan berjalan harus dilakukan melalui jalur admin dan wajib disertai alasan.</li>
              <li>Jangan membuat ulang jadwal grup apabila sudah terdapat skor, kecuali melalui fitur koreksi atau reset darurat yang tersedia bagi admin.</li>
              <li>Pemenang semifinal maju ke Final. Peserta yang kalah mengikuti mekanisme Juara 3 sesuai konfigurasi divisi.</li>
              <li>Setelah podium disahkan dan turnamen ditutup, data menjadi arsip hanya-baca. Pembukaan kembali turnamen harus dilakukan oleh admin dengan alasan yang tercatat.</li>
            </ul>
          </div>
        </div>
      </section>

    </div>
  );
}
