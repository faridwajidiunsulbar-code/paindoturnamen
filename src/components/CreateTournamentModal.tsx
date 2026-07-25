import React, { useState, useEffect } from 'react';
import { Trophy, Calendar, MapPin, X, Plus, AlertCircle, CheckCircle2, Sparkles, Activity } from 'lucide-react';

interface CreateTournamentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: {
    name: string;
    date: string;
    location: string;
    sportType: 'badminton' | 'pickleball' | 'tennis' | 'table_tennis' | 'other';
  }) => void;
}

export default function CreateTournamentModal({
  isOpen,
  onClose,
  onCreate
}: CreateTournamentModalProps) {
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [location, setLocation] = useState('');
  const [sportType, setSportType] = useState<'badminton' | 'pickleball' | 'tennis' | 'table_tennis' | 'other'>('badminton');
  
  const [errors, setErrors] = useState<{ name?: string; date?: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName('');
      setDate(new Date().toISOString().split('T')[0]);
      setLocation('');
      setSportType('badminton');
      setErrors({});
      setIsSubmitting(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const validate = () => {
    const newErrors: { name?: string; date?: string } = {};

    if (!name || !name.trim()) {
      newErrors.name = 'Nama turnamen wajib diisi.';
    } else if (name.trim().length < 3) {
      newErrors.name = 'Nama turnamen minimal 3 karakter.';
    }

    if (!date) {
      newErrors.date = 'Tanggal pelaksanaan wajib dipilih.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);

    setTimeout(() => {
      onCreate({
        name: name.trim(),
        date,
        location: location.trim(),
        sportType
      });
      setIsSubmitting(false);
      onClose();
    }, 200);
  };

  return (
    <div className="fixed inset-0 bg-navy/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="create-tournament-modal-overlay">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl border border-slate-100 overflow-hidden relative flex flex-col" id="create-tournament-modal">
        
        {/* Header */}
        <div className="bg-navy p-6 text-white flex items-center justify-between border-b border-navy-light/60">
          <div className="flex items-center gap-3">
            <div className="bg-neon p-2.5 rounded-xl text-navy shadow-md">
              <Trophy className="h-6 w-6 font-black" />
            </div>
            <div>
              <h3 className="text-base font-black tracking-tight text-white uppercase">Buat Turnamen Baru</h3>
              <p className="text-xs text-slate-350 font-medium">Lengkapi parameter utama turnamen sebelum pendaftaran</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-navy-light/50 hover:bg-navy-light text-slate-400 hover:text-white transition"
            id="close-create-modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          
          {/* 1. Nama Turnamen */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
              <span>Nama Turnamen <span className="text-rose-500">*</span></span>
              <span className="text-[10px] text-slate-400 font-normal">Contoh: Kejuaraan Bulutangkis PB Cempaka 2026</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (errors.name) setErrors(prev => ({ ...prev, name: undefined }));
                }}
                placeholder="Masukkan nama resmi turnamen..."
                className={`w-full bg-slate-50 border rounded-xl py-2.5 pl-3.5 pr-4 text-xs font-semibold text-slate-800 outline-none transition ${
                  errors.name
                    ? 'border-rose-500 ring-2 ring-rose-500/20 bg-rose-50/30'
                    : 'border-slate-200 focus:border-neon focus:ring-2 focus:ring-neon/30 focus:bg-white'
                }`}
                autoFocus
                id="input-tournament-name"
              />
            </div>
            {errors.name && (
              <p className="text-[11px] font-bold text-rose-500 flex items-center gap-1 mt-1">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {errors.name}
              </p>
            )}
          </div>

          {/* 2. Tanggal Pelaksanaan & Lokasi Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* Tanggal */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 text-neon" /> Tanggal Pelaksanaan <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  if (errors.date) setErrors(prev => ({ ...prev, date: undefined }));
                }}
                className={`w-full bg-slate-50 border rounded-xl py-2.5 px-3.5 text-xs font-semibold text-slate-800 outline-none transition ${
                  errors.date
                    ? 'border-rose-500 ring-2 ring-rose-500/20 bg-rose-50/30'
                    : 'border-slate-200 focus:border-neon focus:ring-2 focus:ring-neon/30 focus:bg-white'
                }`}
                id="input-tournament-date"
              />
              {errors.date && (
                <p className="text-[11px] font-bold text-rose-500 flex items-center gap-1 mt-1">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {errors.date}
                </p>
              )}
            </div>

            {/* Lokasi */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-neon" /> Lokasi / GOR (Opsional)
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Contoh: GOR Sudirman, Surabaya"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3.5 text-xs font-semibold text-slate-800 outline-none focus:border-neon focus:ring-2 focus:ring-neon/30 focus:bg-white transition"
                id="input-tournament-location"
              />
            </div>

          </div>

          {/* 3. Jenis Cabang Olahraga Preset */}
          <div className="space-y-2 pt-1 border-t border-slate-100">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-neon" /> Preset Cabang Olahraga
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { id: 'badminton', label: 'Bulutangkis' },
                { id: 'pickleball', label: 'Pickleball' },
                { id: 'tennis', label: 'Tenis Lapangan' },
                { id: 'table_tennis', label: 'Tenis Meja' },
                { id: 'other', label: 'Umum / Lainnya' }
              ].map(sport => (
                <button
                  type="button"
                  key={sport.id}
                  onClick={() => setSportType(sport.id as any)}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-between ${
                    sportType === sport.id
                      ? 'bg-navy text-neon border-navy shadow-sm'
                      : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600'
                  }`}
                >
                  <span>{sport.label}</span>
                  {sportType === sport.id && <CheckCircle2 className="h-3.5 w-3.5 text-neon" />}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 italic">
              *Format preset akan menyesuaikan pilihan nomor pertandingan awal (Ganda Putra, Ganda Putri, Tunggal, dll). Anda dapat mengubah nomor lomba kapan saja.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 border border-slate-200 hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-bold transition"
              id="cancel-create-tournament"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 bg-neon hover:bg-neon/90 text-navy font-black rounded-xl text-xs uppercase tracking-wider transition shadow-md flex items-center gap-2"
              id="submit-create-tournament"
            >
              <Sparkles className="h-4 w-4" />
              <span>{isSubmitting ? 'Membuat...' : 'Buat Turnamen'}</span>
            </button>
          </div>

        </form>

      </div>
    </div>
  );
}
