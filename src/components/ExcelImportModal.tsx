import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { FileSpreadsheet, Upload, FileText, Check, AlertCircle, X, Download, Copy, RefreshCw, Plus } from 'lucide-react';
import { Entry } from '../types';

interface ExcelImportModalProps {
  isOpen: boolean;
  isDouble: boolean;
  divisionName: string;
  onClose: () => void;
  onImport: (entries: Entry[], mode: 'append' | 'replace') => void;
}

export default function ExcelImportModal({
  isOpen,
  isDouble,
  divisionName,
  onClose,
  onImport
}: ExcelImportModalProps) {
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [pastedText, setPastedText] = useState('');
  const [parsedEntries, setParsedEntries] = useState<Entry[]>([]);
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  if (!isOpen) return null;

  // Helper to process row arrays / objects into Entry list
  const processRawRows = (rows: any[]) => {
    if (!rows || rows.length === 0) {
      setErrorMessage('Tabel/File kosong atau tidak memiliki data yang dapat dibaca.');
      setParsedEntries([]);
      return;
    }

    const timestamp = Date.now();
    const result: Entry[] = [];

    rows.forEach((row, idx) => {
      let n1 = '';
      let n2 = '';
      let aff = '';

      if (Array.isArray(row)) {
        // Row is an array of cells [Cell0, Cell1, Cell2]
        if (row.length === 0) return;
        
        // Skip header if first row has header keywords
        const firstStr = String(row[0] || '').toLowerCase();
        if (
          idx === 0 &&
          (firstStr.includes('nama') || firstStr.includes('pemain') || firstStr.includes('player') || firstStr.includes('no'))
        ) {
          return;
        }

        // If row[0] is number/No., offset index
        let startIdx = 0;
        if (!isNaN(Number(row[0])) && row.length > 1) {
          startIdx = 1;
        }

        n1 = String(row[startIdx] || '').trim();
        if (isDouble) {
          n2 = String(row[startIdx + 1] || '').trim();
          aff = String(row[startIdx + 2] || '').trim();
        } else {
          aff = String(row[startIdx + 1] || '').trim();
        }
      } else if (typeof row === 'object' && row !== null) {
        // Row is an object mapped by column keys
        const keys = Object.keys(row);
        
        // Find keys by fuzzy match
        const k1 = keys.find(k => /pemain\s*1|nama\s*1|player\s*1|nama\s*lengkap|nama/i.test(k));
        const k2 = keys.find(k => /pemain\s*2|nama\s*2|player\s*2|pasangan|partner/i.test(k));
        const kAff = keys.find(k => /klub|afiliasi|kota|tim|daerah/i.test(k));

        if (k1) n1 = String(row[k1] || '').trim();
        else if (keys[0]) n1 = String(row[keys[0]] || '').trim();

        if (isDouble) {
          if (k2) n2 = String(row[k2] || '').trim();
          else if (keys[1]) n2 = String(row[keys[1]] || '').trim();
        }

        if (kAff) aff = String(row[kAff] || '').trim();
        else if (keys[isDouble ? 2 : 1]) aff = String(row[keys[isDouble ? 2 : 1]] || '').trim();
      }

      // Validate player names
      if (n1 && (!isDouble || n2)) {
        result.push({
          id: `ent-imp-${idx}-${timestamp}`,
          name1: n1,
          name2: isDouble ? n2 : undefined,
          affiliation: aff || undefined
        });
      }
    });

    if (result.length === 0) {
      setErrorMessage('Tidak ditemukan baris yang memenuhi kriteria nama pemain.');
      setParsedEntries([]);
    } else {
      setErrorMessage(null);
      setParsedEntries(result);
    }
  };

  // Handle File Upload (.xlsx, .xls, .csv)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setErrorMessage(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert sheet to array of arrays
        const jsonRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        processRawRows(jsonRows);
      } catch (err: any) {
        setErrorMessage('Gagal membaca file Excel/CSV: ' + (err.message || 'Format tidak didukung'));
        setParsedEntries([]);
      }
    };
    reader.readAsBinaryString(file);
  };

  // Handle Text Paste (TSV / CSV / Tab Delimited)
  const handleParsePastedText = () => {
    if (!pastedText.trim()) {
      setErrorMessage('Silakan tempel (paste) data dari Excel atau Google Sheets.');
      return;
    }

    const lines = pastedText.trim().split(/\r?\n/);
    const rawRows = lines.map(line => {
      if (line.includes('\t')) return line.split('\t');
      if (line.includes(';')) return line.split(';');
      if (line.includes(',')) return line.split(',');
      return [line];
    });

    processRawRows(rawRows);
  };

  // Download template file (.csv)
  const handleDownloadTemplate = () => {
    let csvContent = '';
    if (isDouble) {
      csvContent = 'No,Pemain 1,Pemain 2,Klub/Afiliasi\n1,Farid,Iswan,PB Paindo\n2,Akram,Haedar,PB Jaya\n3,Amri,Pandi,Bebas';
    } else {
      csvContent = 'No,Nama Pemain,Klub/Afiliasi\n1,Farid,PB Paindo\n2,Iswan,PB Jaya\n3,Akram,Bebas';
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Template_Peserta_${isDouble ? 'Ganda' : 'Tunggal'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSubmitImport = () => {
    if (parsedEntries.length === 0) return;
    onImport(parsedEntries, importMode);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="excel-import-modal-overlay">
      <div className="bg-white rounded-2xl max-w-2xl w-full border border-slate-150 p-6 card-shadow shadow-2xl transform transition-all animate-scale-up max-h-[90vh] flex flex-col" id="excel-import-modal-card">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-150 shrink-0">
          <div>
            <h3 className="text-lg font-extrabold text-navy flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
              Impor Peserta dari Spreadsheet / Excel
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Divisi Target: <strong className="text-slate-700">{divisionName}</strong> ({isDouble ? 'Pasangan Ganda' : 'Pemain Tunggal'})
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition"
            id="excel-import-close-btn"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-slate-150 my-4 shrink-0">
          <button
            type="button"
            onClick={() => { setActiveTab('upload'); setErrorMessage(null); }}
            className={`px-4 py-2.5 text-xs font-bold flex items-center gap-2 border-b-2 transition ${
              activeTab === 'upload'
                ? 'border-emerald-600 text-emerald-700 bg-emerald-50/50'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
            id="tab-upload-file"
          >
            <Upload className="h-4 w-4" /> Unggah File (.xlsx, .csv)
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('paste'); setErrorMessage(null); }}
            className={`px-4 py-2.5 text-xs font-bold flex items-center gap-2 border-b-2 transition ${
              activeTab === 'paste'
                ? 'border-emerald-600 text-emerald-700 bg-emerald-50/50'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
            id="tab-paste-text"
          >
            <Copy className="h-4 w-4" /> Copy-Paste Tabel Excel / Sheets
          </button>
        </div>

        {/* Modal Body */}
        <div className="overflow-y-auto space-y-4 pr-1 flex-1">
          
          {/* UPLOAD TAB */}
          {activeTab === 'upload' && (
            <div className="space-y-4">
              <div className="border-2 border-dashed border-slate-200 hover:border-emerald-500 bg-slate-50 hover:bg-emerald-50/20 rounded-xl p-6 text-center transition cursor-pointer relative">
                <input
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  onChange={handleFileUpload}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  id="excel-file-input"
                />
                <FileSpreadsheet className="h-10 w-10 text-emerald-600 mx-auto mb-2" />
                <p className="text-sm font-bold text-slate-700">
                  {fileName ? `File Terpilih: ${fileName}` : 'Klik atau seret file Excel (.xlsx, .csv) ke sini'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Mendukung format Microsoft Excel (.xlsx, .xls) dan CSV
                </p>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500 bg-slate-100 p-3 rounded-xl border border-slate-200">
                <span>Format kolom yang disarankan: <strong>{isDouble ? 'Pemain 1, Pemain 2, Klub/Afiliasi' : 'Nama Pemain, Klub/Afiliasi'}</strong></span>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="text-emerald-700 font-bold hover:underline flex items-center gap-1 shrink-0"
                >
                  <Download className="h-3.5 w-3.5" /> Unduh Template CSV
                </button>
              </div>
            </div>
          )}

          {/* PASTE TAB */}
          {activeTab === 'paste' && (
            <div className="space-y-3">
              <label className="text-xs font-bold text-slate-600 block">
                Tempelkan (Paste) hasil copy dari kolom Excel atau Google Sheets:
              </label>
              <textarea
                rows={6}
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder={
                  isDouble
                    ? "Contoh format (3 kolom):\nFarid\tIswan\tPB Paindo\nAkram\tHaedar\tPB Jaya\nAmri\tPandi\tBebas"
                    : "Contoh format (2 kolom):\nFarid\tPB Paindo\nIswan\tPB Jaya\nAkram\tBebas"
                }
                className="w-full p-3 font-mono text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-800"
                id="excel-paste-textarea"
              />
              <button
                type="button"
                onClick={handleParsePastedText}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5"
                id="btn-process-pasted-text"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Diproses & Tampilkan Pratinjau
              </button>
            </div>
          )}

          {/* Error Alert */}
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-medium text-rose-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Parsed Preview Table */}
          {parsedEntries.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-navy flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-emerald-600" />
                  Pratinjau Data Terdeteksi ({parsedEntries.length} {isDouble ? 'Pasang' : 'Peserta'})
                </span>
                <span className="text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-bold border border-emerald-200">
                  Siap Diimpor
                </span>
              </div>

              <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600">
                      <th className="p-2 w-10 text-center">No</th>
                      <th className="p-2">{isDouble ? 'Pemain 1' : 'Nama Pemain'}</th>
                      {isDouble && <th className="p-2">Pemain 2</th>}
                      <th className="p-2">Klub/Afiliasi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150">
                    {parsedEntries.map((ent, idx) => (
                      <tr key={ent.id} className="hover:bg-slate-50">
                        <td className="p-2 text-center text-slate-400 font-mono">{idx + 1}</td>
                        <td className="p-2 font-bold text-slate-800">{ent.name1}</td>
                        {isDouble && <td className="p-2 font-bold text-slate-800">{ent.name2 || '-'}</td>}
                        <td className="p-2 text-slate-500">{ent.affiliation || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Import Mode Selection */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-150 space-y-2">
                <label className="text-xs font-extrabold text-slate-700 block">Metode Impor:</label>
                <div className="flex flex-col sm:flex-row gap-2 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer bg-white p-2.5 rounded-lg border border-slate-200 flex-1">
                    <input
                      type="radio"
                      name="importMode"
                      value="append"
                      checked={importMode === 'append'}
                      onChange={() => setImportMode('append')}
                      className="text-emerald-600 focus:ring-emerald-500"
                    />
                    <div>
                      <span className="font-bold text-slate-800 block">Tambahkan (Append)</span>
                      <span className="text-[10px] text-slate-400">Gabungkan dengan peserta yang sudah ada saat ini</span>
                    </div>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer bg-white p-2.5 rounded-lg border border-slate-200 flex-1">
                    <input
                      type="radio"
                      name="importMode"
                      value="replace"
                      checked={importMode === 'replace'}
                      onChange={() => setImportMode('replace')}
                      className="text-emerald-600 focus:ring-emerald-500"
                    />
                    <div>
                      <span className="font-bold text-rose-700 block">Ganti Semua (Replace)</span>
                      <span className="text-[10px] text-slate-400">Hapus daftar peserta lama & timpa dengan data baru ini</span>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-150 mt-4 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition"
            id="excel-import-cancel-btn"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={parsedEntries.length === 0}
            onClick={handleSubmitImport}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-lg text-xs transition card-shadow shadow-xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            id="excel-import-submit-btn"
          >
            <Plus className="h-4 w-4 stroke-[3]" />
            Impor {parsedEntries.length > 0 ? `${parsedEntries.length} Peserta` : ''} Sekarang
          </button>
        </div>

      </div>
    </div>
  );
}
