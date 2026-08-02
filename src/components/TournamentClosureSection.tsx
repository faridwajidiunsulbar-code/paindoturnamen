import React, { useState } from 'react';
import { Tournament, Division } from '../types';
import { validateTournamentClosureReadiness, isTournamentReadOnly } from '../utils/closureHelpers';
import { closeTournamentOfficial, reopenTournamentOfficial } from '../services/tournamentService';
import {
  Lock,
  Unlock,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Trophy,
  Award,
  Medal,
  FileText,
  Calendar,
  UserCheck,
  RotateCcw,
  Sparkles
} from 'lucide-react';

interface TournamentClosureSectionProps {
  tournament: Tournament;
  onUpdateTournament: (updated: Tournament) => void;
  isAdmin?: boolean;
  currentUserEmail?: string;
}

export default function TournamentClosureSection({
  tournament,
  onUpdateTournament,
  isAdmin = true,
  currentUserEmail = 'Admin'
}: TournamentClosureSectionProps) {
  const readiness = validateTournamentClosureReadiness(tournament);
  const isReadOnly = isTournamentReadOnly(tournament);

  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const [closeConfirmed, setCloseConfirmed] = useState(false);

  const [isReopenModalOpen, setIsReopenModalOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [alertError, setAlertError] = useState<string | null>(null);

  const handleCloseSubmit = async () => {
    if (!closeReason || closeReason.trim().length < 5) {
      setAlertError('Alasan penutupan turnamen wajib diisi minimal 5 karakter.');
      return;
    }
    if (!closeConfirmed) {
      setAlertError('Anda harus menyetujui pernyataan konfirmasi penutupan.');
      return;
    }

    setIsSubmitting(true);
    setAlertError(null);

    const res = await closeTournamentOfficial(tournament, closeReason, currentUserEmail);
    setIsSubmitting(false);

    if (!res.success) {
      setAlertError('error' in res && res.error?.message ? res.error.message : 'Gagal menutup turnamen.');
    } else {
      onUpdateTournament(res.data);
      setIsCloseModalOpen(false);
      setCloseReason('');
      setCloseConfirmed(false);
    }
  };

  const handleReopenSubmit = async () => {
    if (!reopenReason || reopenReason.trim().length < 5) {
      setAlertError('Alasan pembukaan kembali wajib diisi minimal 5 karakter.');
      return;
    }

    setIsSubmitting(true);
    setAlertError(null);

    const res = await reopenTournamentOfficial(tournament, reopenReason, currentUserEmail);
    setIsSubmitting(false);

    if (!res.success) {
      setAlertError('error' in res && res.error?.message ? res.error.message : 'Gagal membuka kembali turnamen.');
    } else {
      onUpdateTournament(res.data);
      setIsReopenModalOpen(false);
      setReopenReason('');
    }
  };

  const getEntryName = (div: Division, entryId?: string | null) => {
    if (!entryId) return '-';
    const entry = div.entries.find(e => e.id === entryId);
    if (!entry) return '-';
    return `${entry.name1}${entry.name2 ? ` / ${entry.name2}` : ''} ${entry.affiliation ? `(${entry.affiliation})` : ''}`;
  };

  return (
    <div className="space-y-6 animate-fade-in" id="tournament-closure-section">
      
      {/* 1. STATUS BANNER CARD */}
      {isReadOnly ? (
        <div className="bg-amber-900/10 border-2 border-amber-500/40 rounded-2xl p-6 text-slate-800 space-y-4 shadow-sm" id="closure-closed-banner">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-3 bg-amber-500 text-white rounded-xl shrink-0">
                <Lock className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 bg-amber-500 text-white text-[10px] font-black uppercase tracking-wider rounded-full">
                    Arsip Read-Only
                  </span>
                  <h3 className="text-xl font-black text-navy">TURNAMEN TELAH RESMI DITUTUP</h3>
                </div>
                <p className="text-sm text-slate-600">
                  Seluruh hasil pertandingan dan pengesahan podium divisi telah dikunci. Data dalam mode baca-saja.
                </p>
              </div>
            </div>

            {isAdmin && (
              <button
                onClick={() => { setAlertError(null); setIsReopenModalOpen(true); }}
                className="px-4 py-2.5 bg-navy text-white text-xs font-bold rounded-xl hover:bg-navy-light transition flex items-center gap-2 shrink-0 self-start sm:self-center cursor-pointer shadow-sm"
                id="reopen-tournament-btn"
              >
                <Unlock className="h-4 w-4 text-neon" />
                <span>Buka Kembali Turnamen</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-amber-200 text-xs text-slate-700">
            <div>
              <span className="font-semibold text-slate-500 block text-[10px] uppercase">Waktu Penutupan:</span>
              <span className="font-mono font-medium">
                {tournament.closedAt ? new Date(tournament.closedAt).toLocaleString('id-ID') : '-'}
              </span>
            </div>
            <div>
              <span className="font-semibold text-slate-500 block text-[10px] uppercase">Penanggung Jawab / Admin:</span>
              <span className="font-medium">{tournament.closedBy || 'Admin'}</span>
            </div>
            <div>
              <span className="font-semibold text-slate-500 block text-[10px] uppercase">Catatan / Alasan:</span>
              <span className="font-medium italic">"{tournament.closeReason || '-'}"</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 card-shadow" id="closure-active-banner">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className={`p-3 rounded-xl shrink-0 ${readiness.canClose ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                {readiness.canClose ? <ShieldCheck className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider rounded-full ${readiness.canClose ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                    {readiness.canClose ? 'Siap Ditutup' : 'Belum Lengkap'}
                  </span>
                  <h3 className="text-xl font-black text-navy">Penutupan Turnamen & Penguncian Hasil</h3>
                </div>
                <p className="text-sm text-slate-600">
                  {readiness.canClose
                    ? 'Seluruh divisi dan pertandingan telah selesai dan disahkan. Turnamen siap ditutup secara resmi.'
                    : 'Lengkapi seluruh tahapan pertandingan dan pengesahan podium pada setiap divisi aktif sebelum melakukan penutupan.'}
                </p>
              </div>
            </div>

            {isAdmin && (
              <button
                disabled={!readiness.canClose}
                onClick={() => { setAlertError(null); setIsCloseModalOpen(true); }}
                className={`px-5 py-3 text-xs font-black uppercase tracking-wider rounded-xl transition flex items-center gap-2 shrink-0 self-start sm:self-center cursor-pointer shadow-md ${
                  readiness.canClose
                    ? 'bg-navy text-neon hover:bg-navy-light hover:scale-105'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-60'
                }`}
                id="close-tournament-official-btn"
              >
                <Lock className="h-4 w-4" />
                <span>Tutup Turnamen Resmi</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 2. OVERALL PODIUM SUMMARY PER DIVISION */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 card-shadow space-y-4" id="closure-podium-summary">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-500" />
            <h3 className="text-base font-black text-navy">Rekapitulasi Hasil Resmi Podium Turnamen</h3>
          </div>
          <span className="text-xs text-slate-500 font-medium">
            {tournament.activeDivisions.filter(d => d.podiumOfficial).length} / {tournament.activeDivisions.length} Divisi Disahkan
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tournament.activeDivisions.map(div => {
            const isDivOfficial = div.podiumOfficial && div.officialPodium;
            const entries = div.officialPodium?.entries || [];
            const p1 = entries.find(e => e.placement === 1);
            const p2 = entries.find(e => e.placement === 2);
            const p3List = entries.filter(e => e.placement === 3);
            const p4 = entries.find(e => e.placement === 4);

            return (
              <div key={div.id} className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-navy">{div.eventName} {div.ageGroupName}</span>
                  {isDivOfficial ? (
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-extrabold uppercase rounded-full flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Disahkan
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold uppercase rounded-full">
                      Belum Disahkan
                    </span>
                  )}
                </div>

                {isDivOfficial ? (
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between p-2 bg-amber-50 rounded-lg border border-amber-200 text-amber-900">
                      <span className="font-black flex items-center gap-1.5">
                        <Trophy className="h-3.5 w-3.5 text-amber-500" /> Juara 1 (Emas):
                      </span>
                      <span className="font-bold">{getEntryName(div, p1?.entryId || div.champions?.firstPlaceEntryId)}</span>
                    </div>

                    <div className="flex items-center justify-between p-2 bg-slate-100 rounded-lg border border-slate-200 text-slate-800">
                      <span className="font-bold flex items-center gap-1.5">
                        <Award className="h-3.5 w-3.5 text-slate-400" /> Runner-up (Perak):
                      </span>
                      <span className="font-semibold">{getEntryName(div, p2?.entryId || div.champions?.secondPlaceEntryId)}</span>
                    </div>

                    {p3List.length > 0 ? (
                      p3List.map((p3, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2 bg-amber-900/5 rounded-lg border border-amber-900/10 text-amber-900">
                          <span className="font-semibold flex items-center gap-1.5">
                            <Medal className="h-3.5 w-3.5 text-amber-700" /> Juara 3 {p3List.length > 1 ? `Bersama #${idx + 1}` : '(Perunggu)'}:
                          </span>
                          <span className="font-semibold">{getEntryName(div, p3.entryId)}</span>
                        </div>
                      ))
                    ) : (
                      div.champions?.thirdPlaceEntryId && (
                        <div className="flex items-center justify-between p-2 bg-amber-900/5 rounded-lg border border-amber-900/10 text-amber-900">
                          <span className="font-semibold flex items-center gap-1.5">
                            <Medal className="h-3.5 w-3.5 text-amber-700" /> Juara 3:
                          </span>
                          <span className="font-semibold">{getEntryName(div, div.champions.thirdPlaceEntryId)}</span>
                        </div>
                      )
                    )}

                    {p4 && (
                      <div className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-200 text-slate-600">
                        <span className="font-medium">Peringkat 4:</span>
                        <span>{getEntryName(div, p4.entryId)}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic p-3 bg-white rounded-lg border border-slate-200">
                    Hasil pertandingan belum disahkan oleh Panitia untuk divisi ini.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. READINESS CHECKLIST FOR ALL DIVISIONS */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 card-shadow space-y-4" id="closure-readiness-checklist">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-navy" />
            <h3 className="text-base font-black text-navy">Pemeriksaan Kesiapan Penutupan Turnamen</h3>
          </div>
          <span className="text-xs font-bold text-slate-500">
            {readiness.divisionSummaries.filter(s => s.blockers.length === 0).length} / {readiness.divisionSummaries.length} Divisi Siap
          </span>
        </div>

        <div className="space-y-3">
          {readiness.divisionSummaries.map(sum => (
            <div key={sum.divisionId} className={`border rounded-xl p-4 transition ${sum.blockers.length === 0 ? 'border-emerald-200 bg-emerald-50/30' : 'border-amber-200 bg-amber-50/30'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-extrabold text-sm text-navy">{sum.divisionName}</span>
                {sum.blockers.length === 0 ? (
                  <span className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" /> Lengkap
                  </span>
                ) : (
                  <span className="text-xs font-bold text-amber-700 flex items-center gap-1">
                    <XCircle className="h-4 w-4" /> Belum Siap ({sum.blockers.length} kendala)
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                <div className={`p-2 rounded-lg border text-center ${sum.groupStageComplete ? 'bg-emerald-100/60 border-emerald-300 text-emerald-900' : 'bg-slate-100 border-slate-300 text-slate-500'}`}>
                  <span className="block text-[10px] uppercase font-bold text-slate-500">Fase Grup</span>
                  <span className="font-bold">{sum.groupStageComplete ? 'Selesai' : 'Belum'}</span>
                </div>
                <div className={`p-2 rounded-lg border text-center ${sum.bracketValid ? 'bg-emerald-100/60 border-emerald-300 text-emerald-900' : 'bg-slate-100 border-slate-300 text-slate-500'}`}>
                  <span className="block text-[10px] uppercase font-bold text-slate-500">Bagan Gugur</span>
                  <span className="font-bold">{sum.bracketValid ? 'Dikunci' : 'Belum'}</span>
                </div>
                <div className={`p-2 rounded-lg border text-center ${sum.finalComplete ? 'bg-emerald-100/60 border-emerald-300 text-emerald-900' : 'bg-slate-100 border-slate-300 text-slate-500'}`}>
                  <span className="block text-[10px] uppercase font-bold text-slate-500">Final</span>
                  <span className="font-bold">{sum.finalComplete ? 'Selesai' : 'Belum'}</span>
                </div>
                <div className={`p-2 rounded-lg border text-center ${sum.podiumOfficial ? 'bg-emerald-100/60 border-emerald-300 text-emerald-900' : 'bg-slate-100 border-slate-300 text-slate-500'}`}>
                  <span className="block text-[10px] uppercase font-bold text-slate-500">Podium</span>
                  <span className="font-bold">{sum.podiumOfficial ? 'Disahkan' : 'Belum'}</span>
                </div>
                <div className={`p-2 rounded-lg border text-center ${sum.divisionCompleted ? 'bg-emerald-100/60 border-emerald-300 text-emerald-900' : 'bg-slate-100 border-slate-300 text-slate-500'}`}>
                  <span className="block text-[10px] uppercase font-bold text-slate-500">Status</span>
                  <span className="font-bold">{sum.divisionCompleted ? 'Completed' : 'Pending'}</span>
                </div>
              </div>

              {sum.blockers.length > 0 && (
                <div className="mt-3 p-3 bg-white border border-amber-300 rounded-lg text-xs text-amber-900 space-y-1">
                  <span className="font-bold flex items-center gap-1 text-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5" /> Kendala yang harus diselesaikan:
                  </span>
                  <ul className="list-disc list-inside space-y-0.5 text-slate-700 pl-1">
                    {sum.blockers.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 4. CLOSE CONFIRMATION MODAL */}
      {isCloseModalOpen && (
        <div className="fixed inset-0 bg-navy/80 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="close-tournament-modal">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-5 card-shadow border border-slate-200">
            <div className="flex items-center gap-3 text-navy">
              <div className="p-3 bg-amber-500 text-white rounded-xl">
                <Lock className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-xl font-black">Konfirmasi Penutupan Resmi Turnamen</h3>
                <p className="text-xs text-slate-500">{tournament.name}</p>
              </div>
            </div>

            {alertError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                <span>{alertError}</span>
              </div>
            )}

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2 text-slate-700">
              <p className="font-bold text-navy">
                Penutupan turnamen akan mengubah seluruh status turnamen menjadi READ-ONLY / ARSIP.
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-600">
                <li>Seluruh skor pertandingan, bagan babak gugur, dan podium tidak dapat diubah lagi.</li>
                <li>Hanya Panitia Admin yang dapat membuka kembali turnamen ini jika diperlukan.</li>
              </ul>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-extrabold text-navy uppercase tracking-wider mb-1">
                  Alasan Penutupan (Wajib, min 5 karakter) <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={closeReason}
                  onChange={(e) => setCloseReason(e.target.value)}
                  placeholder="Contoh: Seluruh babak final telah selesai dimainkan dan juara telah mendapatkan piala resmi."
                  className="w-full text-xs p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-navy focus:outline-none min-h-[80px]"
                />
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer pt-2">
                <input
                  type="checkbox"
                  checked={closeConfirmed}
                  onChange={(e) => setCloseConfirmed(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-navy focus:ring-navy h-4 w-4 cursor-pointer"
                />
                <span className="text-xs font-semibold text-slate-700">
                  Saya telah memeriksa seluruh hasil pertandingan dan mengonfirmasi penutupan resmi turnamen ini.
                </span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                disabled={isSubmitting}
                onClick={() => setIsCloseModalOpen(false)}
                className="px-4 py-2.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-200 transition cursor-pointer"
              >
                Batal
              </button>
              <button
                disabled={isSubmitting || !closeConfirmed || closeReason.trim().length < 5}
                onClick={handleCloseSubmit}
                className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl transition flex items-center gap-2 cursor-pointer ${
                  closeConfirmed && closeReason.trim().length >= 5 && !isSubmitting
                    ? 'bg-amber-600 text-white hover:bg-amber-700 shadow-md'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
                id="submit-close-tournament-btn"
              >
                {isSubmitting ? 'Menutup Turnamen...' : 'Tutup Turnamen Sekarang'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. REOPEN CONFIRMATION MODAL */}
      {isReopenModalOpen && (
        <div className="fixed inset-0 bg-navy/80 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="reopen-tournament-modal">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-5 card-shadow border border-slate-200">
            <div className="flex items-center gap-3 text-navy">
              <div className="p-3 bg-navy text-neon rounded-xl">
                <Unlock className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-xl font-black">Buka Kembali Turnamen</h3>
                <p className="text-xs text-slate-500">{tournament.name}</p>
              </div>
            </div>

            {alertError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                <span>{alertError}</span>
              </div>
            )}

            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                Perhatian:
              </p>
              <p>
                Membuka kembali turnamen akan mengizinkan pengubahan data kembali. Seluruh hasil pertandingan dan pengesahan podium akan tetap dipertahankan.
              </p>
            </div>

            <div>
              <label className="block text-xs font-extrabold text-navy uppercase tracking-wider mb-1">
                Alasan Pembukaan Kembali (Wajib, min 5 karakter) <span className="text-rose-500">*</span>
              </label>
              <textarea
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                placeholder="Contoh: Perlu koreksi skor pertandingan pada babak semifinal divisi Ganda Putra."
                className="w-full text-xs p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-navy focus:outline-none min-h-[80px]"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                disabled={isSubmitting}
                onClick={() => setIsReopenModalOpen(false)}
                className="px-4 py-2.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-200 transition cursor-pointer"
              >
                Batal
              </button>
              <button
                disabled={isSubmitting || reopenReason.trim().length < 5}
                onClick={handleReopenSubmit}
                className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl transition cursor-pointer ${
                  reopenReason.trim().length >= 5 && !isSubmitting
                    ? 'bg-navy text-neon hover:bg-navy-light shadow-md'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
                id="submit-reopen-tournament-btn"
              >
                {isSubmitting ? 'Membuka Turnamen...' : 'Buka Kembali Turnamen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
