import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { FileSpreadsheet, Upload, FileText, Check, AlertCircle, X, Download, Copy, RefreshCw, Plus, CheckCircle, XCircle } from 'lucide-react';
import { Entry } from '../types';
import { normalizeName, cleanDisplayName } from '../services/entryService';

interface ExcelImportModalProps {
  isOpen: boolean;
  isDouble: boolean;
  divisionName: string;
  onClose: () => void;
  onImport: (entries: Entry[], mode: 'append' | 'replace') => void;
}

export interface ImportRowReport {
  rowNum: number;
  name1: string;
  name2?: string;
  affiliation?: string;
  status: 'valid' | 'invalid';
  reason?: string;
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
  const [rowReports, setRowReports] = useState<ImportRowReport[]>([]);
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  // Workbook & Sheet selection state
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');

  if (!isOpen) return null;

  // Helper to process row arrays / objects into Entry list with per-row validation report
  const processRawRows = (rows: any[]) => {
    if (!rows || rows.length === 0) {
      setErrorMessage('Tabel/File kosong atau tidak memiliki data yang dapat dibaca.');
      setParsedEntries([]);
      setRowReports([]);
      return;
    }

    const timestamp = Date.now();
    const validEntries: Entry[] = [];
    const reports: ImportRowReport[] = [];
    const seenPlayersInImport = new Set<string>();
    const seenPairsInImport = new Set<string>();

    rows.forEach((row, idx) => {
      const rowNum = idx + 1;
      let n1 = '';
      let n2 = '';
      let aff = '';

      if (Array.isArray(row)) {
        if (row.length === 0) return;
        
        // Skip header if first row has header keywords
        const firstStr = String(row[0] || '').toLowerCase();
        if (
          idx === 0 &&
          (firstStr.includes('nama') || firstStr.includes('pemain') || firstStr.includes('player') || firstStr.includes('no'))
        ) {
          return;
        }

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
        const keys = Object.keys(row);
        
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

      // Check row validity
      const cleanedN1 = cleanDisplayName(n1);
      const cleanedN2 = cleanDisplayName(n2);
      const norm1 = normalizeName(n1);
      const norm2 = normalizeName(n2);

      if (!norm1 && (!isDouble || !norm2)) {
        // Empty row, skip silently
        return;
      }

      if (!norm1) {
        reports.push({
          rowNum,
          name1: cleanedN1 || '-',
          name2: isDouble ? cleanedN2 || '-' : undefined,
          affiliation: aff || undefined,
          status: 'invalid',
          reason: 'Nama Pemain 1 kosong'
        });
        return;
      }

      if (isDouble) {
        if (!norm2) {
          reports.push({
            rowNum,
            name1: cleanedN1,
            name2: '-',
            affiliation: aff || undefined,
            status: 'invalid',
            reason: 'Nama Pemain 2 kosong'
          });
          return;
        }

        if (norm1 === norm2) {
          reports.push({
            rowNum,
            name1: cleanedN1,
            name2: cleanedN2,
            affiliation: aff || undefined,
            status: 'invalid',
            reason: 'Pemain 1 dan Pemain 2 tidak boleh orang yang sama'
          });
          return;
        }

        // Symmetric Pair check in current import file
        const pairKey1 = `${norm1}|${norm2}`;
        const pairKey2 = `${norm2}|${norm1}`;
        if (seenPairsInImport.has(pairKey1) || seenPairsInImport.has(pairKey2)) {
          reports.push({
            rowNum,
            name1: cleanedN1,
            name2: cleanedN2,
            affiliation: aff || undefined,
            status: 'invalid',
            reason: 'Pasangan duplikat/terbalik dalam file impor'
          });
          return;
        }

        // Check if player is already assigned in another row in this file
        if (seenPlayersInImport.has(norm1) || seenPlayersInImport.has(norm2)) {
          const dupPlayer = seenPlayersInImport.has(norm1) ? cleanedN1 : cleanedN2;
          reports.push({
            rowNum,
            name1: cleanedN1,
            name2: cleanedN2,
            affiliation: aff || undefined,
            status: 'invalid',
            reason: `Pemain [${dupPlayer}] sudah muncul di baris lain dalam file ini`
          });
          return;
        }

        seenPairsInImport.add(pairKey1);
        seenPlayersInImport.add(norm1);
        seenPlayersInImport.add(norm2);
      } else {
        // Single
        if (seenPlayersInImport.has(norm1)) {
          reports.push({
            rowNum,
            name1: cleanedN1,
            affiliation: aff || undefined,
            status: 'invalid',
            reason: `Pemain [${cleanedN1}] duplikat dalam file ini`
          });
          return;
        }
        seenPlayersInImport.add(norm1);
      }

      // Valid entry row!
      validEntries.push({
        id: `ent-imp-${idx}-${timestamp}`,
        name1: cleanedN1,
        name2: isDouble ? cleanedN2 : undefined,
        affiliation: aff ? cleanDisplayName(aff) : undefined
      });

      reports.push({
        rowNum,
        name1: cleanedN1,
        name2: isDouble ? cleanedN2 : undefined,
        affiliation: aff || undefined,
        status: 'valid'
      });
    });

    setRowReports(reports);

    if (validEntries.length === 0) {
      setErrorMessage('Tidak ditemukan baris yang memenuhi kriteria pendaftaran valid.');
      setParsedEntries([]);
    } else {
      setErrorMessage(null);
      setParsedEntries(validEntries);
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
        const wb = XLSX.read(bstr, { type: 'binary' });
        setWorkbook(wb);
        setSheetNames(wb.SheetNames || []);

        const firstSheetName = wb.SheetNames[0] || '';
        setSelectedSheet(firstSheetName);

        if (firstSheetName && wb.Sheets[firstSheetName]) {
          const worksheet = wb.Sheets[firstSheetName];
          const jsonRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          processRawRows(jsonRows);
        } else {
          setErrorMessage('Workbook tidak memiliki sheet yang valid.');
          setParsedEntries([]);
        }
      } catch (err: any) {
        setErrorMessage('Gagal membaca file Excel/CSV: ' + (err.message || 'Format tidak didukung'));
        setParsedEntries([]);
        setWorkbook(null);
        setSheetNames([]);
        setSelectedSheet('');
      }
    };
    reader.readAsBinaryString(file);
  };

  // Handle Sheet Change
  const handleSheetChange = (sheetName: string) => {
    setSelectedSheet(sheetName);
    if (workbook && workbook.Sheets[sheetName]) {
      const worksheet = workbook.Sheets[sheetName];
      const jsonRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      processRawRows(jsonRows);
    }
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

              {sheetNames.length > 0 && (
                <div className="flex items-center gap-2 text-xs bg-emerald-50/80 border border-emerald-200 p-3 rounded-xl animate-fade-in">
                  <FileSpreadsheet className="h-4 w-4 text-emerald-700 shrink-0" />
                  <label htmlFor="sheet-select" className="font-bold text-slate-700 whitespace-nowrap">
                    Pilih Sheet ({sheetNames.length} sheet):
                  </label>
                  <select
                    id="sheet-select"
                    value={selectedSheet}
                    onChange={(e) => handleSheetChange(e.target.value)}
                    className="flex-1 bg-white border border-emerald-300 rounded-lg px-2.5 py-1.5 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-xs shadow-xs cursor-pointer"
                  >
                    {sheetNames.map((s) => (
                      <option key={s} value={s}>
                        📄 {s}
                      </option>
                    ))}
                  </select>
                </div>
              )}

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

          {/* Parsed Preview & Report Table */}
          {rowReports.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-navy flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-emerald-600" />
                  Laporan Hasil Analisis Impor ({parsedEntries.length} Valid / {rowReports.filter(r => r.status === 'invalid').length} Ditolak)
                </span>
                <div className="flex gap-2 text-[11px]">
                  <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-bold border border-emerald-200 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3 text-emerald-600" /> {parsedEntries.length} Berhasil
                  </span>
                  {rowReports.some(r => r.status === 'invalid') && (
                    <span className="text-rose-700 bg-rose-50 px-2 py-0.5 rounded font-bold border border-rose-200 flex items-center gap-1">
                      <XCircle className="h-3 w-3 text-rose-600" /> {rowReports.filter(r => r.status === 'invalid').length} Ditolak
                    </span>
                  )}
                </div>
              </div>

              <div className="max-h-52 overflow-y-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600">
                      <th className="p-2 w-10 text-center">Baris</th>
                      <th className="p-2">{isDouble ? 'Pemain 1' : 'Nama Pemain'}</th>
                      {isDouble && <th className="p-2">Pemain 2</th>}
                      <th className="p-2">Klub/Afiliasi</th>
                      <th className="p-2 w-28 text-center">Status</th>
                      <th className="p-2">Keterangan / Alasan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150">
                    {rowReports.map((rep) => (
                      <tr key={rep.rowNum} className={rep.status === 'valid' ? 'hover:bg-slate-50' : 'bg-rose-50/40 hover:bg-rose-50/70'}>
                        <td className="p-2 text-center text-slate-400 font-mono">{rep.rowNum}</td>
                        <td className="p-2 font-bold text-slate-800">{rep.name1}</td>
                        {isDouble && <td className="p-2 font-bold text-slate-800">{rep.name2 || '-'}</td>}
                        <td className="p-2 text-slate-500">{rep.affiliation || '-'}</td>
                        <td className="p-2 text-center">
                          {rep.status === 'valid' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold text-[10px] rounded-full">
                              <CheckCircle className="h-3 w-3 text-emerald-600" /> Valid
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-rose-100 text-rose-800 font-bold text-[10px] rounded-full">
                              <XCircle className="h-3 w-3 text-rose-600" /> Ditolak
                            </span>
                          )}
                        </td>
                        <td className="p-2 text-[11px] text-slate-600 font-medium">
                          {rep.status === 'valid' ? 'Siap diimpor' : rep.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Import Mode Selection */}
              {parsedEntries.length > 0 && (
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
                        <span className="text-[10px] text-slate-400">Gabungkan baris valid dengan peserta yang sudah ada saat ini</span>
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
                        <span className="text-[10px] text-slate-400">Hapus daftar peserta lama & timpa dengan baris valid baru ini</span>
                      </div>
                    </label>
                  </div>
                </div>
              )}
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
