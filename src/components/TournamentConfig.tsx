/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Tournament, TournamentEvent, AgeGroup, Division, DivisionSettings } from '../types';
import { Settings, Plus, Trash2, CheckSquare, Square, Calendar, MapPin, Award } from 'lucide-react';

interface TournamentConfigProps {
  tournament: Tournament;
  onChange: (updated: Tournament) => void;
  isAdmin?: boolean;
}

export default function TournamentConfig({ tournament, onChange, isAdmin = true }: TournamentConfigProps) {
  const [newEventName, setNewEventName] = useState('');
  const [newEventIsDouble, setNewEventIsDouble] = useState(true);
  
  const [newAgeGroupName, setNewAgeGroupName] = useState('');

  // Custom confirmation state for dialogs to prevent iframe bugs
  const [showConfirm, setShowConfirm] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // Update general tournament details
  const updateGeneral = (field: keyof Tournament, value: string) => {
    onChange({
      ...tournament,
      [field]: value
    });
  };

  // Add a new game event
  const addEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEventName.trim()) return;

    const id = `ev-${Date.now()}`;
    const newEvent: TournamentEvent = {
      id,
      name: newEventName.trim(),
      isDouble: newEventIsDouble
    };

    onChange({
      ...tournament,
      events: [...tournament.events, newEvent]
    });

    setNewEventName('');
  };

  // Delete game event
  const removeEvent = (id: string) => {
    const affectedDivs = tournament.activeDivisions.filter(div => div.eventId === id);
    const totalEntries = affectedDivs.reduce((sum, d) => sum + d.entries.length, 0);
    const eventName = tournament.events.find(ev => ev.id === id)?.name || 'Nomor';
    
    const executeRemoveEvent = () => {
      const updatedDivisions = tournament.activeDivisions.filter(div => div.eventId !== id);
      onChange({
        ...tournament,
        events: tournament.events.filter(ev => ev.id !== id),
        activeDivisions: updatedDivisions
      });
      setShowConfirm(null);
    };

    if (totalEntries > 0) {
      setShowConfirm({
        title: 'Hapus Nomor Pertandingan',
        message: `PERINGATAN: Menghapus nomor pertandingan "${eventName}" akan menghapus ${affectedDivs.length} divisi aktif yang terkait dan total ${totalEntries} peserta terdaftar beserta seluruh data pertandingan! Apakah Anda yakin ingin menghapus?`,
        onConfirm: executeRemoveEvent
      });
    } else if (affectedDivs.length > 0) {
      setShowConfirm({
        title: 'Hapus Nomor Pertandingan',
        message: `Menghapus nomor pertandingan "${eventName}" akan menghapus divisi aktif yang terkait. Lanjutkan?`,
        onConfirm: executeRemoveEvent
      });
    } else {
      executeRemoveEvent();
    }
  };

  // Add age group
  const addAgeGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgeGroupName.trim()) return;

    const id = `ag-${Date.now()}`;
    const newAg: AgeGroup = {
      id,
      name: newAgeGroupName.trim()
    };

    onChange({
      ...tournament,
      ageGroups: [...tournament.ageGroups, newAg]
    });

    setNewAgeGroupName('');
  };

  // Delete age group
  const removeAgeGroup = (id: string) => {
    const affectedDivs = tournament.activeDivisions.filter(div => div.ageGroupId === id);
    const totalEntries = affectedDivs.reduce((sum, d) => sum + d.entries.length, 0);
    const ageGroupName = tournament.ageGroups.find(ag => ag.id === id)?.name || 'Kelompok Umur';

    const executeRemoveAgeGroup = () => {
      const updatedDivisions = tournament.activeDivisions.filter(div => div.ageGroupId !== id);
      onChange({
        ...tournament,
        ageGroups: tournament.ageGroups.filter(ag => ag.id !== id),
        activeDivisions: updatedDivisions
      });
      setShowConfirm(null);
    };

    if (totalEntries > 0) {
      setShowConfirm({
        title: 'Hapus Kelompok Umur',
        message: `PERINGATAN: Menghapus kelompok umur "${ageGroupName}" akan menghapus ${affectedDivs.length} divisi aktif yang terkait dan total ${totalEntries} peserta terdaftar beserta seluruh data pertandingan! Apakah Anda yakin ingin menghapus?`,
        onConfirm: executeRemoveAgeGroup
      });
    } else if (affectedDivs.length > 0) {
      setShowConfirm({
        title: 'Hapus Kelompok Umur',
        message: `Menghapus kelompok umur "${ageGroupName}" akan menghapus divisi aktif yang terkait. Lanjutkan?`,
        onConfirm: executeRemoveAgeGroup
      });
    } else {
      executeRemoveAgeGroup();
    }
  };

  // Toggle division state in matrix
  const toggleDivision = (event: TournamentEvent, age: AgeGroup) => {
    const divisionId = `${event.id}-${age.id}`;
    const isCurrentlyActive = tournament.activeDivisions.some(div => div.id === divisionId);

    if (isCurrentlyActive) {
      // Remove division
      const div = tournament.activeDivisions.find(d => d.id === divisionId);
      const entryCount = div?.entries.length || 0;
      
      if (entryCount > 0) {
        const confirmMsg = `PERINGATAN: Divisi "${event.name} ${age.name}" saat ini memiliki ${entryCount} peserta terdaftar. Menonaktifkan divisi ini akan menghapus semua data peserta dan pertandingan! Apakah Anda yakin?`;
        setShowConfirm({
          title: 'Nonaktifkan Divisi',
          message: confirmMsg,
          onConfirm: () => {
            onChange({
              ...tournament,
              activeDivisions: tournament.activeDivisions.filter(div => div.id !== divisionId)
            });
            setShowConfirm(null);
          }
        });
      } else {
        // No entries registered yet, uncheck immediately
        onChange({
          ...tournament,
          activeDivisions: tournament.activeDivisions.filter(div => div.id !== divisionId)
        });
      }
    } else {
      // Add division
      const defaultSettings: DivisionSettings = {
        format: 'RR_KO',
        targetScore: 11,
        winByTwo: true,
        playersPerGroup: 4,
        playersQualifyingPerGroup: 2,
        bracketSize: 4,
        wildcardActive: false,
        byeActive: false
      };

      const newDiv: Division = {
        id: divisionId,
        eventId: event.id,
        eventName: event.name,
        ageGroupId: age.id,
        ageGroupName: age.name,
        settings: defaultSettings,
        entries: [],
        groups: [],
        roundRobinMatches: [],
        knockoutStage: null,
        champions: null
      };

      onChange({
        ...tournament,
        activeDivisions: [...tournament.activeDivisions, newDiv]
      });
    }
  };

  return (
    <div className="space-y-8 animate-fade-in" id="tournament-config">
      {!isAdmin && (
        <div className="p-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl flex items-start gap-3 text-sm">
          <span className="text-xl">👁️</span>
          <div>
            <p className="font-extrabold text-amber-900">Mode Lihat Saja (Publik)</p>
            <p className="text-xs text-amber-700 mt-0.5">Anda sedang membuka turnamen ini melalui tautan publik. Anda dapat melihat pengaturan divisi dan matriks ini, namun tidak dapat melakukan perubahan kecuali Anda login sebagai admin penyelenggara.</p>
          </div>
        </div>
      )}

      {/* 1. General Tournament Details */}
      <section className="bg-white rounded-2xl border border-slate-150 p-6 card-shadow" id="general-info-section">
        <h2 className="text-base font-extrabold text-navy mb-4 flex items-center gap-2">
          <Settings className="h-5 w-5 text-neon stroke-navy fill-neon" />
          Informasi Utama Turnamen
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Nama Turnamen</label>
            <input
              type="text"
              id="tournament-name-input"
              value={tournament.name}
              onChange={(e) => updateGeneral('name', e.target.value)}
              placeholder="Contoh: Pickleball Championship Cup"
              disabled={!isAdmin}
              className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy text-slate-800 font-medium transition disabled:bg-slate-50 disabled:text-slate-450 disabled:cursor-not-allowed"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tanggal</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                type="date"
                id="tournament-date-input"
                value={tournament.date}
                onChange={(e) => updateGeneral('date', e.target.value)}
                disabled={!isAdmin}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy text-slate-800 font-medium transition disabled:bg-slate-50 disabled:text-slate-450 disabled:cursor-not-allowed"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Lokasi Lapangan</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                type="text"
                id="tournament-location-input"
                value={tournament.location}
                onChange={(e) => updateGeneral('location', e.target.value)}
                placeholder="Contoh: Gading Serpong, Tangerang"
                disabled={!isAdmin}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy text-slate-800 font-medium transition disabled:bg-slate-50 disabled:text-slate-450 disabled:cursor-not-allowed"
              />
            </div>
          </div>
        </div>
      </section>

      {/* 2. Events & Age Groups Management */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8" id="categories-management-grid">
        {/* Events Column */}
        <section className="bg-white rounded-2xl border border-slate-150 p-6 card-shadow" id="events-section">
          <h3 className="text-sm font-extrabold text-navy mb-4 flex items-center gap-2">
            <Award className="h-5 w-5 text-neon stroke-navy fill-neon" />
            Nomor Pertandingan
          </h3>
          
          {isAdmin && (
            <form onSubmit={addEvent} className="flex gap-2 mb-6" id="add-event-form">
              <div className="flex-1 flex flex-col md:flex-row gap-2">
                <input
                  type="text"
                  id="new-event-name-input"
                  value={newEventName}
                  onChange={(e) => setNewEventName(e.target.value)}
                  placeholder="Tambah Nomor (Contoh: Ganda Campuran)"
                  className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy text-sm text-slate-800 transition"
                />
                <select
                  id="new-event-type-select"
                  value={newEventIsDouble ? 'double' : 'single'}
                  onChange={(e) => setNewEventIsDouble(e.target.value === 'double')}
                  className="px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy text-sm text-slate-700 bg-slate-50 transition"
                >
                  <option value="double">Ganda (2 Pemain)</option>
                  <option value="single">Tunggal (1 Pemain)</option>
                </select>
              </div>
              <button
                type="submit"
                id="add-event-submit-button"
                className="px-4 py-2.5 bg-navy hover:bg-navy-light text-neon rounded-lg font-extrabold transition flex items-center gap-1 shrink-0 text-sm card-shadow"
              >
                <Plus className="h-4 w-4" /> Add
              </button>
            </form>
          )}

          <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1" id="events-list">
            {tournament.events.map((ev) => (
              <div key={ev.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-150 text-sm" id={`event-row-${ev.id}`}>
                <div>
                  <span className="font-semibold text-slate-700">{ev.name}</span>
                  <span className="ml-2 text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                    {ev.isDouble ? 'Ganda' : 'Tunggal'}
                  </span>
                </div>
                {isAdmin && tournament.events.length > 1 && (
                  <button
                    onClick={() => removeEvent(ev.id)}
                    className="p-1 text-slate-400 hover:text-rose-500 rounded transition"
                    title="Hapus nomor pertandingan"
                    id={`delete-event-button-${ev.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Age Groups Column */}
        <section className="bg-white rounded-2xl border border-slate-150 p-6 card-shadow" id="age-groups-section">
          <h3 className="text-sm font-extrabold text-navy mb-4 flex items-center gap-2">
            <Calendar className="h-5 w-5 text-neon stroke-navy fill-neon" />
            Kelompok Umur (KU)
          </h3>
          
          {isAdmin && (
            <form onSubmit={addAgeGroup} className="flex gap-2 mb-6" id="add-age-group-form">
              <input
                type="text"
                id="new-age-group-name-input"
                value={newAgeGroupName}
                onChange={(e) => setNewAgeGroupName(e.target.value)}
                placeholder="Tambah KU (Contoh: 45+, Amatir, Open)"
                className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy text-sm text-slate-800 transition"
              />
              <button
                type="submit"
                id="add-age-group-submit-button"
                className="px-4 py-2.5 bg-navy hover:bg-navy-light text-neon rounded-lg font-extrabold transition flex items-center gap-1 shrink-0 text-sm card-shadow"
              >
                <Plus className="h-4 w-4" /> Add
              </button>
            </form>
          )}

          <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1" id="age-groups-list">
            {tournament.ageGroups.map((ag) => (
              <div key={ag.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-150 text-sm" id={`age-group-row-${ag.id}`}>
                <span className="font-semibold text-slate-700">{ag.name}</span>
                {isAdmin && tournament.ageGroups.length > 1 && (
                  <button
                    onClick={() => removeAgeGroup(ag.id)}
                    className="p-1 text-slate-400 hover:text-rose-500 rounded transition"
                    title="Hapus kelompok umur"
                    id={`delete-age-group-button-${ag.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* 3. Active Divisions Matrix */}
      <section className="bg-white rounded-2xl border border-slate-150 p-6 card-shadow" id="division-matrix-section">
        <div className="mb-4">
          <h2 className="text-base font-extrabold text-navy flex items-center gap-2">
            <CheckSquare className="h-5 w-5 text-neon stroke-navy fill-neon" />
            Matriks Divisi Pertandingan Aktif
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Centang kombinasi Nomor Pertandingan dan Kelompok Umur yang dimainkan pada turnamen ini. Setiap kombinasi yang dicentang akan membuat satu Divisi Pertandingan mandiri.
          </p>
        </div>

        <div className="overflow-x-auto border border-slate-150 rounded-xl" id="matrix-table-container">
          <table className="w-full text-left border-collapse" id="matrix-table">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-150">
                <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Nomor Pertandingan</th>
                {tournament.ageGroups.map(ag => (
                  <th key={ag.id} className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">
                    {ag.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150">
              {tournament.events.map(ev => (
                <tr key={ev.id} className="hover:bg-slate-50/50 transition" id={`matrix-row-${ev.id}`}>
                  <td className="p-4">
                    <span className="font-medium text-slate-700 block">{ev.name}</span>
                    <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-mono">
                      {ev.isDouble ? 'Double' : 'Single'}
                    </span>
                  </td>
                  {tournament.ageGroups.map(ag => {
                    const divisionId = `${ev.id}-${ag.id}`;
                    const isActive = tournament.activeDivisions.some(div => div.id === divisionId);
                    
                    return (
                      <td key={ag.id} className="p-4 text-center">
                        <button
                          type="button"
                          onClick={() => isAdmin && toggleDivision(ev, ag)}
                          disabled={!isAdmin}
                          className={`inline-flex items-center justify-center p-2 rounded-lg transition-all ${
                            isActive
                              ? 'text-navy bg-neon/15 border border-neon/40'
                              : 'text-slate-300 hover:text-slate-500 hover:bg-slate-100 border border-slate-200'
                          } disabled:opacity-75 disabled:cursor-not-allowed`}
                          id={`matrix-checkbox-${ev.id}-${ag.id}`}
                        >
                          {isActive ? (
                            <CheckSquare className="h-5 w-5 fill-neon/30 text-navy" />
                          ) : (
                            <Square className="h-5 w-5" />
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {/* Dynamic Summary */}
        <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-150 flex flex-wrap gap-4 items-center justify-between text-sm" id="matrix-summary">
          <span className="text-slate-500">
            Total Divisi Pertandingan Aktif: <strong className="text-navy font-extrabold">{tournament.activeDivisions.length} divisi</strong>
          </span>
          <div className="flex flex-wrap gap-1.5" id="active-badges-list">
            {tournament.activeDivisions.map(div => (
              <span key={div.id} className="px-2.5 py-1 text-xs font-bold text-navy bg-neon/10 border border-neon/35 rounded-full card-shadow">
                {div.eventName} {div.ageGroupName}
              </span>
            ))}
          </div>
        </div>
      </section>

      {showConfirm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="custom-confirm-modal">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-150 p-6 shadow-2xl transform transition-all animate-scale-up" id="custom-confirm-card">
            <h3 className="text-lg font-extrabold text-slate-900 mb-2 flex items-center gap-2">
              <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-rose-50 border border-rose-200 text-rose-600 font-bold text-lg shrink-0">⚠️</span>
              {showConfirm.title}
            </h3>
            <p className="text-sm text-slate-600 mb-6 leading-relaxed">
              {showConfirm.message}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowConfirm(null)}
                className="px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-slate-200 rounded-lg transition"
                id="confirm-cancel-button"
              >
                Batalkan
              </button>
              <button
                type="button"
                onClick={showConfirm.onConfirm}
                className="px-4 py-2 text-sm font-extrabold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition"
                id="confirm-submit-button"
              >
                Ya, Lanjutkan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
