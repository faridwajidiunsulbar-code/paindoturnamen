/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Tournament, TournamentEvent, AgeGroup, Division, DivisionSettings } from '../types';
import { Settings, Plus, Trash2, CheckSquare, Square, Calendar, MapPin, Award, Edit2, Check, X, AlertTriangle } from 'lucide-react';

interface TournamentConfigProps {
  tournament: Tournament;
  onChange: (updated: Tournament) => void;
  isAdmin?: boolean;
}

export interface DivisionDataSummary {
  hasData: boolean;
  entryCount: number;
  groupCount: number;
  matchCount: number;
  hasKnockout: boolean;
  hasChampions: boolean;
}

/**
 * Centralized helper to inspect if a division has any associated data
 * (entries, groups, matches, knockout stage, or champions).
 */
export function inspectDivisionData(div?: Division | null): DivisionDataSummary {
  if (!div) {
    return { hasData: false, entryCount: 0, groupCount: 0, matchCount: 0, hasKnockout: false, hasChampions: false };
  }
  const entryCount = div.entries?.length || 0;
  const groupCount = div.groups?.length || 0;
  const matchCount = div.roundRobinMatches?.length || 0;
  const hasKnockout = !!(
    div.knockoutStage &&
    ((div.knockoutStage.matches && div.knockoutStage.matches.length > 0) ||
     (div.knockoutStage.confirmedEntryIds && div.knockoutStage.confirmedEntryIds.length > 0))
  );
  const hasChampions = !!(
    div.champions &&
    (div.champions.firstPlaceEntryId || div.champions.secondPlaceEntryId || div.champions.thirdPlaceEntryId)
  );

  const hasData = entryCount > 0 || groupCount > 0 || matchCount > 0 || hasKnockout || hasChampions;
  return { hasData, entryCount, groupCount, matchCount, hasKnockout, hasChampions };
}

/**
 * Helper to normalize name strings (strip leading/trailing whitespace and collapse internal spaces).
 */
export function normalizeName(str: string): string {
  return str.trim().replace(/\s+/g, ' ');
}

export default function TournamentConfig({ tournament, onChange, isAdmin = true }: TournamentConfigProps) {
  // Add Event Form State
  const [newEventName, setNewEventName] = useState('');
  const [newEventIsDouble, setNewEventIsDouble] = useState(true);
  const [eventErrorMsg, setEventErrorMsg] = useState('');

  // Inline Editing Event State
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editEventName, setEditEventName] = useState('');
  const [editEventIsDouble, setEditEventIsDouble] = useState(true);
  const [editEventErrorMsg, setEditEventErrorMsg] = useState('');

  // Add Age Group Form State
  const [newAgeGroupName, setNewAgeGroupName] = useState('');
  const [ageGroupErrorMsg, setAgeGroupErrorMsg] = useState('');

  // Inline Editing Age Group State
  const [editingAgeGroupId, setEditingAgeGroupId] = useState<string | null>(null);
  const [editAgeGroupName, setEditAgeGroupName] = useState('');
  const [editAgeGroupErrorMsg, setEditAgeGroupErrorMsg] = useState('');

  // General Info Validation State
  const [generalErrorMsg, setGeneralErrorMsg] = useState('');

  // Custom confirmation modal state
  const [showConfirm, setShowConfirm] = useState<{
    title: string;
    message: string;
    details?: string[];
    onConfirm: () => void;
  } | null>(null);

  // Update general tournament details with validation
  const updateGeneral = (field: keyof Tournament, value: string) => {
    if (field === 'name') {
      const clean = normalizeName(value);
      if (!clean && value.trim() === '') {
        setGeneralErrorMsg('Nama turnamen wajib diisi.');
      } else {
        setGeneralErrorMsg('');
      }
    }
    onChange({
      ...tournament,
      [field]: value
    });
  };

  // Add a new game event (Nomor Pertandingan)
  const addEvent = (e: React.FormEvent) => {
    e.preventDefault();
    setEventErrorMsg('');
    const cleanName = normalizeName(newEventName);

    if (!cleanName) {
      setEventErrorMsg('Nama nomor pertandingan wajib diisi.');
      return;
    }

    // Case-insensitive duplicate check
    const isDuplicate = tournament.events.some(
      ev => normalizeName(ev.name).toLowerCase() === cleanName.toLowerCase()
    );

    if (isDuplicate) {
      setEventErrorMsg(`Nomor pertandingan "${cleanName}" sudah ada (tidak membedakan huruf besar/kecil).`);
      return;
    }

    const id = `ev-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newEvent: TournamentEvent = {
      id,
      name: cleanName,
      isDouble: newEventIsDouble
    };

    onChange({
      ...tournament,
      events: [...tournament.events, newEvent]
    });

    setNewEventName('');
    setEventErrorMsg('');
  };

  // Start Inline Editing Event
  const startEditEvent = (ev: TournamentEvent) => {
    setEditingEventId(ev.id);
    setEditEventName(ev.name);
    setEditEventIsDouble(ev.isDouble);
    setEditEventErrorMsg('');
  };

  // Save Inline Editing Event
  const saveEditEvent = (ev: TournamentEvent) => {
    setEditEventErrorMsg('');
    const cleanName = normalizeName(editEventName);

    if (!cleanName) {
      setEditEventErrorMsg('Nama nomor pertandingan wajib diisi.');
      return;
    }

    // Duplicate check excluding current event
    const isDuplicate = tournament.events.some(
      item => item.id !== ev.id && normalizeName(item.name).toLowerCase() === cleanName.toLowerCase()
    );

    if (isDuplicate) {
      setEditEventErrorMsg(`Nomor pertandingan "${cleanName}" sudah ada.`);
      return;
    }

    // Check if single/double type changed and division has data
    if (ev.isDouble !== editEventIsDouble) {
      const affectedDivs = tournament.activeDivisions.filter(d => d.eventId === ev.id);
      const divsWithData = affectedDivs.filter(d => inspectDivisionData(d).hasData);

      if (divsWithData.length > 0) {
        setShowConfirm({
          title: 'Ubah Jenis Pertandingan',
          message: `Mengubah jenis pertandingan "${ev.name}" dari ${ev.isDouble ? 'Ganda' : 'Tunggal'} menjadi ${editEventIsDouble ? 'Ganda' : 'Tunggal'} akan memengaruhi ${divsWithData.length} divisi yang sudah memiliki peserta/data. Lanjutkan?`,
          onConfirm: () => {
            applyEventEdit(ev.id, cleanName, editEventIsDouble);
            setShowConfirm(null);
          }
        });
        return;
      }
    }

    applyEventEdit(ev.id, cleanName, editEventIsDouble);
  };

  const applyEventEdit = (id: string, newName: string, isDouble: boolean) => {
    const updatedEvents = tournament.events.map(ev =>
      ev.id === id ? { ...ev, name: newName, isDouble } : ev
    );

    // Synchronize eventName in activeDivisions
    const updatedDivisions = tournament.activeDivisions.map(div => {
      if (div.eventId === id) {
        return {
          ...div,
          eventName: newName
        };
      }
      return div;
    });

    onChange({
      ...tournament,
      events: updatedEvents,
      activeDivisions: updatedDivisions
    });

    setEditingEventId(null);
    setEditEventErrorMsg('');
  };

  // Delete game event with comprehensive data inspection
  const removeEvent = (id: string) => {
    const affectedDivs = tournament.activeDivisions.filter(div => div.eventId === id);
    const eventName = tournament.events.find(ev => ev.id === id)?.name || 'Nomor Pertandingan';

    let totalEntries = 0;
    let totalGroups = 0;
    let totalMatches = 0;
    let hasData = false;
    const detailsList: string[] = [];

    affectedDivs.forEach(div => {
      const summary = inspectDivisionData(div);
      if (summary.hasData) {
        hasData = true;
        totalEntries += summary.entryCount;
        totalGroups += summary.groupCount;
        totalMatches += summary.matchCount;
      }
    });

    if (totalEntries > 0) detailsList.push(`${totalEntries} peserta terdaftar`);
    if (totalGroups > 0) detailsList.push(`${totalGroups} pool/grup`);
    if (totalMatches > 0) detailsList.push(`${totalMatches} pertandingan/skor`);

    const executeRemoveEvent = () => {
      const updatedDivisions = tournament.activeDivisions.filter(div => div.eventId !== id);
      onChange({
        ...tournament,
        events: tournament.events.filter(ev => ev.id !== id),
        activeDivisions: updatedDivisions
      });
      setShowConfirm(null);
    };

    if (hasData) {
      setShowConfirm({
        title: 'Hapus Nomor Pertandingan',
        message: `PERINGATAN KRUSIAL: Menghapus nomor pertandingan "${eventName}" akan menghapus ${affectedDivs.length} divisi aktif beserta data di dalamnya:`,
        details: detailsList.length > 0 ? detailsList : ['Data peserta, grup, dan pertandingan'],
        onConfirm: executeRemoveEvent
      });
    } else if (affectedDivs.length > 0) {
      setShowConfirm({
        title: 'Hapus Nomor Pertandingan',
        message: `Menghapus nomor pertandingan "${eventName}" akan menghapus ${affectedDivs.length} divisi aktif yang terkait. Lanjutkan?`,
        onConfirm: executeRemoveEvent
      });
    } else {
      executeRemoveEvent();
    }
  };

  // Add age group (Kelompok Umur)
  const addAgeGroup = (e: React.FormEvent) => {
    e.preventDefault();
    setAgeGroupErrorMsg('');
    const cleanName = normalizeName(newAgeGroupName);

    if (!cleanName) {
      setAgeGroupErrorMsg('Nama kelompok umur wajib diisi.');
      return;
    }

    // Case-insensitive duplicate check
    const isDuplicate = tournament.ageGroups.some(
      ag => normalizeName(ag.name).toLowerCase() === cleanName.toLowerCase()
    );

    if (isDuplicate) {
      setAgeGroupErrorMsg(`Kelompok umur "${cleanName}" sudah ada (tidak membedakan huruf besar/kecil).`);
      return;
    }

    const id = `ag-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newAg: AgeGroup = {
      id,
      name: cleanName
    };

    onChange({
      ...tournament,
      ageGroups: [...tournament.ageGroups, newAg]
    });

    setNewAgeGroupName('');
    setAgeGroupErrorMsg('');
  };

  // Start Inline Editing Age Group
  const startEditAgeGroup = (ag: AgeGroup) => {
    setEditingAgeGroupId(ag.id);
    setEditAgeGroupName(ag.name);
    setEditAgeGroupErrorMsg('');
  };

  // Save Inline Editing Age Group
  const saveEditAgeGroup = (ag: AgeGroup) => {
    setEditAgeGroupErrorMsg('');
    const cleanName = normalizeName(editAgeGroupName);

    if (!cleanName) {
      setEditAgeGroupErrorMsg('Nama kelompok umur wajib diisi.');
      return;
    }

    // Duplicate check excluding current age group
    const isDuplicate = tournament.ageGroups.some(
      item => item.id !== ag.id && normalizeName(item.name).toLowerCase() === cleanName.toLowerCase()
    );

    if (isDuplicate) {
      setEditAgeGroupErrorMsg(`Kelompok umur "${cleanName}" sudah ada.`);
      return;
    }

    const updatedAgeGroups = tournament.ageGroups.map(item =>
      item.id === ag.id ? { ...item, name: cleanName } : item
    );

    // Synchronize ageGroupName in activeDivisions
    const updatedDivisions = tournament.activeDivisions.map(div => {
      if (div.ageGroupId === ag.id) {
        return {
          ...div,
          ageGroupName: cleanName
        };
      }
      return div;
    });

    onChange({
      ...tournament,
      ageGroups: updatedAgeGroups,
      activeDivisions: updatedDivisions
    });

    setEditingAgeGroupId(null);
    setEditAgeGroupErrorMsg('');
  };

  // Delete age group with comprehensive data inspection
  const removeAgeGroup = (id: string) => {
    const affectedDivs = tournament.activeDivisions.filter(div => div.ageGroupId === id);
    const ageGroupName = tournament.ageGroups.find(ag => ag.id === id)?.name || 'Kelompok Umur';

    let totalEntries = 0;
    let totalGroups = 0;
    let totalMatches = 0;
    let hasData = false;
    const detailsList: string[] = [];

    affectedDivs.forEach(div => {
      const summary = inspectDivisionData(div);
      if (summary.hasData) {
        hasData = true;
        totalEntries += summary.entryCount;
        totalGroups += summary.groupCount;
        totalMatches += summary.matchCount;
      }
    });

    if (totalEntries > 0) detailsList.push(`${totalEntries} peserta terdaftar`);
    if (totalGroups > 0) detailsList.push(`${totalGroups} pool/grup`);
    if (totalMatches > 0) detailsList.push(`${totalMatches} pertandingan/skor`);

    const executeRemoveAgeGroup = () => {
      const updatedDivisions = tournament.activeDivisions.filter(div => div.ageGroupId !== id);
      onChange({
        ...tournament,
        ageGroups: tournament.ageGroups.filter(ag => ag.id !== id),
        activeDivisions: updatedDivisions
      });
      setShowConfirm(null);
    };

    if (hasData) {
      setShowConfirm({
        title: 'Hapus Kelompok Umur',
        message: `PERINGATAN KRUSIAL: Menghapus kelompok umur "${ageGroupName}" akan menghapus ${affectedDivs.length} divisi aktif beserta data di dalamnya:`,
        details: detailsList.length > 0 ? detailsList : ['Data peserta, grup, dan pertandingan'],
        onConfirm: executeRemoveAgeGroup
      });
    } else if (affectedDivs.length > 0) {
      setShowConfirm({
        title: 'Hapus Kelompok Umur',
        message: `Menghapus kelompok umur "${ageGroupName}" akan menghapus ${affectedDivs.length} divisi aktif yang terkait. Lanjutkan?`,
        onConfirm: executeRemoveAgeGroup
      });
    } else {
      executeRemoveAgeGroup();
    }
  };

  // Toggle division state in matrix with centralized data safety check
  const toggleDivision = (event: TournamentEvent, age: AgeGroup) => {
    const targetDivId = `${event.id}-${age.id}`;
    
    // Find division by ID or eventId+ageGroupId to support legacy/cloud items
    const existingDiv = tournament.activeDivisions.find(
      d => d.id === targetDivId || (d.eventId === event.id && d.ageGroupId === age.id)
    );

    if (existingDiv) {
      // Deactivating division - inspect all data
      const summary = inspectDivisionData(existingDiv);

      if (summary.hasData) {
        const detailsList: string[] = [];
        if (summary.entryCount > 0) detailsList.push(`${summary.entryCount} peserta terdaftar`);
        if (summary.groupCount > 0) detailsList.push(`${summary.groupCount} pool/grup`);
        if (summary.matchCount > 0) detailsList.push(`${summary.matchCount} pertandingan round robin`);
        if (summary.hasKnockout) detailsList.push('Bagan & pertandingan knockout');
        if (summary.hasChampions) detailsList.push('Data pemenang / juara podium');

        setShowConfirm({
          title: `Nonaktifkan Divisi "${event.name} ${age.name}"`,
          message: `PERINGATAN: Divisi ini sudah berisi data aktif yang akan TERHAPUS PERMANEN jika dinonaktifkan:`,
          details: detailsList,
          onConfirm: () => {
            onChange({
              ...tournament,
              activeDivisions: tournament.activeDivisions.filter(d => d.id !== existingDiv.id)
            });
            setShowConfirm(null);
          }
        });
      } else {
        // Division is completely empty, uncheck immediately
        onChange({
          ...tournament,
          activeDivisions: tournament.activeDivisions.filter(d => d.id !== existingDiv.id)
        });
      }
    } else {
      // Activating division - create new clean division
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
        id: targetDivId,
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
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Nama Turnamen <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              id="tournament-name-input"
              value={tournament.name}
              onChange={(e) => updateGeneral('name', e.target.value)}
              placeholder="Contoh: Pickleball Championship Cup"
              disabled={!isAdmin}
              className={`w-full px-4 py-2.5 rounded-lg border ${
                generalErrorMsg ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'
              } focus:outline-none focus:ring-2 focus:ring-navy/15 focus:border-navy text-slate-800 font-medium transition disabled:bg-slate-50 disabled:text-slate-450 disabled:cursor-not-allowed`}
            />
            {generalErrorMsg && (
              <p className="text-xs text-rose-600 font-medium mt-1">{generalErrorMsg}</p>
            )}
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
                value={tournament.location || ''}
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
            <div className="mb-6">
              <form onSubmit={addEvent} className="flex gap-2" id="add-event-form">
                <div className="flex-1 flex flex-col md:flex-row gap-2">
                  <input
                    type="text"
                    id="new-event-name-input"
                    value={newEventName}
                    onChange={(e) => {
                      setNewEventName(e.target.value);
                      if (eventErrorMsg) setEventErrorMsg('');
                    }}
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
              {eventErrorMsg && (
                <p className="text-xs text-rose-600 font-medium mt-1.5 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {eventErrorMsg}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1" id="events-list">
            {tournament.events.map((ev) => {
              const isEditing = editingEventId === ev.id;
              const affectedDivCount = tournament.activeDivisions.filter(d => d.eventId === ev.id).length;

              if (isEditing) {
                return (
                  <div key={ev.id} className="p-3 rounded-lg bg-navy/5 border border-navy/20 space-y-2 text-sm" id={`edit-event-row-${ev.id}`}>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editEventName}
                        onChange={(e) => setEditEventName(e.target.value)}
                        className="flex-1 px-3 py-1.5 rounded border border-slate-300 text-sm text-slate-800 focus:outline-none focus:border-navy"
                        placeholder="Nama nomor pertandingan"
                        autoFocus
                      />
                      <select
                        value={editEventIsDouble ? 'double' : 'single'}
                        onChange={(e) => setEditEventIsDouble(e.target.value === 'double')}
                        className="px-2 py-1.5 rounded border border-slate-300 text-xs text-slate-700 bg-white"
                      >
                        <option value="double">Ganda</option>
                        <option value="single">Tunggal</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => saveEditEvent(ev)}
                        className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold transition"
                        title="Simpan Nama"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingEventId(null)}
                        className="p-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded transition"
                        title="Batal"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    {editEventErrorMsg && (
                      <p className="text-xs text-rose-600 font-medium">{editEventErrorMsg}</p>
                    )}
                  </div>
                );
              }

              return (
                <div key={ev.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-150 text-sm hover:border-slate-300 transition" id={`event-row-${ev.id}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-700">{ev.name}</span>
                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded font-mono">
                      {ev.isDouble ? 'Ganda' : 'Tunggal'}
                    </span>
                    {affectedDivCount > 0 && (
                      <span className="text-[10px] text-navy font-bold bg-neon/15 border border-neon/30 px-1.5 py-0.5 rounded-full">
                        {affectedDivCount} Divisi
                      </span>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => startEditEvent(ev)}
                        className="p-1 text-slate-400 hover:text-navy rounded transition"
                        title="Edit nama/jenis nomor"
                        id={`edit-event-button-${ev.id}`}
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      {tournament.events.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeEvent(ev.id)}
                          className="p-1 text-slate-400 hover:text-rose-500 rounded transition"
                          title="Hapus nomor pertandingan"
                          id={`delete-event-button-${ev.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Age Groups Column */}
        <section className="bg-white rounded-2xl border border-slate-150 p-6 card-shadow" id="age-groups-section">
          <h3 className="text-sm font-extrabold text-navy mb-4 flex items-center gap-2">
            <Calendar className="h-5 w-5 text-neon stroke-navy fill-neon" />
            Kelompok Umur (KU)
          </h3>
          
          {isAdmin && (
            <div className="mb-6">
              <form onSubmit={addAgeGroup} className="flex gap-2" id="add-age-group-form">
                <input
                  type="text"
                  id="new-age-group-name-input"
                  value={newAgeGroupName}
                  onChange={(e) => {
                    setNewAgeGroupName(e.target.value);
                    if (ageGroupErrorMsg) setAgeGroupErrorMsg('');
                  }}
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
              {ageGroupErrorMsg && (
                <p className="text-xs text-rose-600 font-medium mt-1.5 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {ageGroupErrorMsg}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1" id="age-groups-list">
            {tournament.ageGroups.map((ag) => {
              const isEditing = editingAgeGroupId === ag.id;
              const affectedDivCount = tournament.activeDivisions.filter(d => d.ageGroupId === ag.id).length;

              if (isEditing) {
                return (
                  <div key={ag.id} className="p-3 rounded-lg bg-navy/5 border border-navy/20 space-y-2 text-sm" id={`edit-age-group-row-${ag.id}`}>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editAgeGroupName}
                        onChange={(e) => setEditAgeGroupName(e.target.value)}
                        className="flex-1 px-3 py-1.5 rounded border border-slate-300 text-sm text-slate-800 focus:outline-none focus:border-navy"
                        placeholder="Nama kelompok umur"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => saveEditAgeGroup(ag)}
                        className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold transition"
                        title="Simpan Nama"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingAgeGroupId(null)}
                        className="p-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded transition"
                        title="Batal"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    {editAgeGroupErrorMsg && (
                      <p className="text-xs text-rose-600 font-medium">{editAgeGroupErrorMsg}</p>
                    )}
                  </div>
                );
              }

              return (
                <div key={ag.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-150 text-sm hover:border-slate-300 transition" id={`age-group-row-${ag.id}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-700">{ag.name}</span>
                    {affectedDivCount > 0 && (
                      <span className="text-[10px] text-navy font-bold bg-neon/15 border border-neon/30 px-1.5 py-0.5 rounded-full">
                        {affectedDivCount} Divisi
                      </span>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => startEditAgeGroup(ag)}
                        className="p-1 text-slate-400 hover:text-navy rounded transition"
                        title="Edit nama kelompok umur"
                        id={`edit-age-group-button-${ag.id}`}
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      {tournament.ageGroups.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeAgeGroup(ag.id)}
                          className="p-1 text-slate-400 hover:text-rose-500 rounded transition"
                          title="Hapus kelompok umur"
                          id={`delete-age-group-button-${ag.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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
                    const targetDivId = `${ev.id}-${ag.id}`;
                    const existingDiv = tournament.activeDivisions.find(
                      d => d.id === targetDivId || (d.eventId === ev.id && d.ageGroupId === ag.id)
                    );
                    const isActive = !!existingDiv;
                    const summary = existingDiv ? inspectDivisionData(existingDiv) : null;
                    
                    return (
                      <td key={ag.id} className="p-4 text-center">
                        <button
                          type="button"
                          onClick={() => isAdmin && toggleDivision(ev, ag)}
                          disabled={!isAdmin}
                          title={
                            isActive
                              ? summary?.hasData
                                ? `Divisi Aktif (${summary.entryCount} peserta, ${summary.groupCount} pool, ${summary.matchCount} match)`
                                : `Divisi Aktif (Kosong)`
                              : 'Klik untuk mengaktifkan divisi ini'
                          }
                          className={`inline-flex items-center justify-center p-2 rounded-lg transition-all relative ${
                            isActive
                              ? 'text-navy bg-neon/15 border border-neon/40 shadow-xs'
                              : 'text-slate-300 hover:text-slate-500 hover:bg-slate-100 border border-slate-200'
                          } disabled:opacity-75 disabled:cursor-not-allowed`}
                          id={`matrix-checkbox-${ev.id}-${ag.id}`}
                        >
                          {isActive ? (
                            <CheckSquare className="h-5 w-5 fill-neon/30 text-navy" />
                          ) : (
                            <Square className="h-5 w-5" />
                          )}
                          {isActive && summary?.hasData && (
                            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-navy opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-navy border border-white"></span>
                            </span>
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
            {tournament.activeDivisions.map(div => {
              const summary = inspectDivisionData(div);
              return (
                <span
                  key={div.id}
                  className="px-2.5 py-1 text-xs font-bold text-navy bg-neon/10 border border-neon/35 rounded-full card-shadow flex items-center gap-1.5"
                >
                  <span>{div.eventName} {div.ageGroupName}</span>
                  {summary.entryCount > 0 && (
                    <span className="text-[10px] font-mono text-slate-500 bg-white px-1.5 py-0.2 rounded-full border border-slate-200">
                      {summary.entryCount} Entry
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      </section>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="custom-confirm-modal">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-150 p-6 shadow-2xl transform transition-all animate-scale-up" id="custom-confirm-card">
            <h3 className="text-lg font-extrabold text-slate-900 mb-2 flex items-center gap-2">
              <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-rose-50 border border-rose-200 text-rose-600 font-bold text-lg shrink-0">⚠️</span>
              {showConfirm.title}
            </h3>
            <p className="text-sm text-slate-600 mb-3 leading-relaxed">
              {showConfirm.message}
            </p>

            {showConfirm.details && showConfirm.details.length > 0 && (
              <div className="bg-rose-50/50 border border-rose-150 rounded-xl p-3 mb-5 space-y-1">
                <span className="text-xs font-bold text-rose-900 block mb-1">Rincian Data Terkait:</span>
                <ul className="list-disc list-inside text-xs text-rose-700 space-y-0.5">
                  {showConfirm.details.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

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

