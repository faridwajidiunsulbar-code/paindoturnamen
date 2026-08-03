/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Tournament, Division, Match, Entry, Group } from '../types';
import { calculateGroupStandings } from './tournamentHelpers';

/**
 * Sanitizes string values for PDF rendering.
 * Strips surrogate pairs, emoji unicode ranges, control characters, and private use unicode.
 * Preserves standard Indonesian characters, numbers, letters, punctuation, apostrophes (e.g. "O'Connor"),
 * hyphens (e.g. "Abdul-Rahman"), and slashes (e.g. "Coach Nadir / Coach Arif").
 */
export function sanitizePdfText(text: string | null | undefined): string {
  if (text === null || text === undefined) return '';
  const str = String(text);
  return str
    .replace(/[\u1F600-\u1F64F\u1F300-\u1F5FF\u1F680-\u1F6FF\u1F700-\u1F77F\u1F800-\u1F8FF\u1F900-\u1F9FF\u1FA00-\u1FA6F\u1FA70-\u1FAFF\u2600-\u26FF\u2700-\u27BF]/g, '')
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    .replace(/[\x00-\x09\x0B-\x1F\x7F-\x9F]/g, '')
    .trim();
}

/**
 * Resolves entry by ID using division entry map with optional global fallback.
 */
export function resolveEntryById(
  entryId: string | null | undefined,
  entryMap: Map<string, Entry>,
  allEntriesMap?: Map<string, Entry>
): Entry | null {
  if (!entryId) return null;
  const key = String(entryId).trim();
  if (key === 'BYE') return { id: 'BYE', name1: 'BYE' };
  return entryMap.get(key) ?? allEntriesMap?.get(key) ?? null;
}

/**
 * Canonical entry name formatter.
 * Returns "name1 / name2" if double, or "name1" if single.
 * Never outputs "/", "/ ( )", "()", or empty string.
 */
export function formatEntryName(entry?: Entry | null): string {
  if (!entry) {
    return 'Peserta tidak ditemukan';
  }
  if (entry.id === 'BYE') {
    return 'BYE';
  }

  const name1 = String(entry.name1 ?? '').trim();
  const name2 = String(entry.name2 ?? '').trim();

  if (!name1) {
    return 'Nama peserta tidak tersedia';
  }

  const formatted = name2 ? `${name1} / ${name2}` : name1;
  return sanitizePdfText(formatted) || 'Nama peserta tidak tersedia';
}

/**
 * Helper to get clean affiliation string.
 */
export function getAffiliationText(entry?: Entry | null): string {
  if (!entry || entry.id === 'BYE') return '-';
  const aff = String(entry.affiliation ?? '').trim();
  return aff ? sanitizePdfText(aff) : '-';
}

/**
 * Priority resolver for Division Title:
 * 1. division.name (if available)
 * 2. eventName + ageGroupName
 * 3. Fallback: "Divisi tanpa nama [id]"
 */
export function getDivisionTitle(div: Division): string {
  const customName = (div as any).name?.trim();
  if (customName) return sanitizePdfText(customName);

  const eventName = div.eventName?.trim() || '';
  const ageGroup = div.ageGroupName?.trim() || '';

  if (eventName && ageGroup) {
    return sanitizePdfText(`${eventName} (${ageGroup})`);
  }
  if (eventName) {
    return sanitizePdfText(eventName);
  }
  if (ageGroup) {
    return sanitizePdfText(`Kelompok Umur ${ageGroup}`);
  }
  return `Divisi tanpa nama [${div.id}]`;
}

/**
 * Resolver for Group Name:
 * Fallback to "Grup [id]" if group name is empty or invalid.
 */
export function getGroupName(group: Group): string {
  const rawName = group.name?.trim() || '';
  if (rawName && rawName.toLowerCase() !== 'grup' && rawName.toLowerCase() !== 'pool') {
    return sanitizePdfText(rawName);
  }
  return sanitizePdfText(`Grup ${group.id || 'A'}`);
}

/**
 * Helper to format match score safely.
 */
export function formatScore(m: Match): string {
  if (m.status === 'belum_dimainkan') return 'Belum Dimainkan';
  if (m.status === 'walkover') return 'W/O';
  return `${m.score1 ?? 0} - ${m.score2 ?? 0}`;
}

/**
 * Builds canonical podium rows using active champions / official podium rows.
 */
function getPodiumRows(
  division: Division,
  entryMap: Map<string, Entry>,
  allEntriesMap: Map<string, Entry>,
  integrityWarnings: string[]
): [string, string, string][] {
  const rows: [string, string, string][] = [];
  const officialEntries = division.officialPodium?.entries || [];

  if (division.podiumOfficial && officialEntries.length > 0) {
    const sorted = [...officialEntries].sort((a, b) => a.placement - b.placement);
    sorted.forEach((pEntry) => {
      let label: string = pEntry.label || '';
      if (!label) {
        if (pEntry.placement === 1) label = 'Champion (Juara 1)';
        else if (pEntry.placement === 2) label = 'Runner Up (Juara 2)';
        else if (pEntry.placement === 3) label = pEntry.isShared ? 'Juara 3 Bersama' : 'Juara 3';
        else if (pEntry.placement === 4) label = 'Peringkat 4';
        else label = `Peringkat ${pEntry.placement}`;
      }

      const entry = resolveEntryById(pEntry.entryId, entryMap, allEntriesMap);
      if (!entry && pEntry.entryId) {
        integrityWarnings.push(`Podium division ${division.id}: entryId tidak ditemukan: ${pEntry.entryId}`);
      }
      const nameStr = entry ? formatEntryName(entry) : `Peserta tidak ditemukan [${pEntry.entryId}]`;
      const affStr = getAffiliationText(entry);
      rows.push([label, nameStr, affStr]);
    });
    return rows;
  }

  // Fallback to champions object
  const champs = division.champions;
  if (champs && (champs.firstPlaceEntryId || champs.secondPlaceEntryId || champs.thirdPlaceEntryId)) {
    if (champs.firstPlaceEntryId) {
      const e1 = resolveEntryById(champs.firstPlaceEntryId, entryMap, allEntriesMap);
      if (!e1) integrityWarnings.push(`Champions Juara 1 division ${division.id}: entryId tidak ditemukan: ${champs.firstPlaceEntryId}`);
      rows.push(['Champion (Juara 1)', e1 ? formatEntryName(e1) : `Peserta tidak ditemukan [${champs.firstPlaceEntryId}]`, getAffiliationText(e1)]);
    }
    if (champs.secondPlaceEntryId) {
      const e2 = resolveEntryById(champs.secondPlaceEntryId, entryMap, allEntriesMap);
      if (!e2) integrityWarnings.push(`Champions Juara 2 division ${division.id}: entryId tidak ditemukan: ${champs.secondPlaceEntryId}`);
      rows.push(['Runner Up (Juara 2)', e2 ? formatEntryName(e2) : `Peserta tidak ditemukan [${champs.secondPlaceEntryId}]`, getAffiliationText(e2)]);
    }
    if (champs.thirdPlaceEntryId) {
      const e3 = resolveEntryById(champs.thirdPlaceEntryId, entryMap, allEntriesMap);
      if (!e3) integrityWarnings.push(`Champions Juara 3 division ${division.id}: entryId tidak ditemukan: ${champs.thirdPlaceEntryId}`);
      rows.push(['Juara 3', e3 ? formatEntryName(e3) : `Peserta tidak ditemukan [${champs.thirdPlaceEntryId}]`, getAffiliationText(e3)]);
    }
    return rows;
  }

  rows.push(['Status Pengesahan Podium', 'Belum disahkan', '-']);
  return rows;
}

export function exportTournamentToPDF(tournament: Tournament): void {
  const integrityWarnings: string[] = [];

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const { name, date, location, activeDivisions = [] } = tournament;

  // Build global fallback entry map
  const allEntriesMap = new Map<string, Entry>();
  activeDivisions.forEach(div => {
    (div.entries || []).forEach(e => {
      if (e && e.id) {
        allEntriesMap.set(String(e.id).trim(), e);
      }
    });
  });

  const sanitizedTitle = name?.trim() ? sanitizePdfText(name) : 'Nama Turnamen';
  const sanitizedLocation = location?.trim() ? sanitizePdfText(location) : '-';

  let formattedDate = '-';
  if (date) {
    try {
      const d = new Date(date);
      if (!isNaN(d.getTime())) {
        formattedDate = d.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      } else {
        formattedDate = sanitizePdfText(date) || '-';
      }
    } catch {
      formattedDate = sanitizePdfText(date) || '-';
    }
  }

  // Header styling
  const titleColor = [15, 23, 42]; // Slate-900 / Navy
  const accentColor = [16, 185, 129]; // Emerald Green

  // --- FIRST PAGE / MAIN HEADER ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(titleColor[0], titleColor[1], titleColor[2]);
  doc.text('LAPORAN HASIL TURNAMEN', 15, 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
  doc.text(sanitizedTitle, 15, 28);

  // Metadata Block
  doc.setDrawColor(241, 245, 249); // Slate-100
  doc.setFillColor(248, 250, 252); // Slate-50
  doc.rect(15, 33, 180, 25, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text('TANGGAL TURNAMEN:', 20, 41);
  doc.text('LOKASI:', 20, 49);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  doc.text(sanitizePdfText(formattedDate), 65, 41);
  doc.text(sanitizedLocation, 65, 49);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text('TOTAL DIVISI:', 140, 41);
  doc.text('TOTAL TIM:', 140, 49);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(`${activeDivisions.length} Divisi`, 165, 41);
  const totalEntries = activeDivisions.reduce((acc, d) => acc + (d.entries?.length || 0), 0);
  doc.text(`${totalEntries} Tim`, 165, 49);

  let currentY = 68;

  // --- PROCESS EACH DIVISION ---
  activeDivisions.forEach((div, divIndex) => {
    // Construct division entryMap
    const entryMap = new Map<string, Entry>();
    (div.entries || []).forEach(e => {
      if (e && e.id) {
        entryMap.set(String(e.id).trim(), e);
      }
    });

    if (divIndex > 0) {
      doc.addPage();
      currentY = 20;
    }

    const divTitle = getDivisionTitle(div);

    // Division Title Bar
    doc.setFillColor(241, 245, 249); // Light Gray background
    doc.rect(15, currentY, 180, 10, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42); // Navy
    doc.text(`DIVISI: ${divTitle.toUpperCase()}`, 18, currentY + 7);

    currentY += 16;

    // --- SUB-SECTION 1: REKAPITULASI JUARA (CHAMPIONS / PODIUM) ---
    if (currentY > 230) {
      doc.addPage();
      currentY = 20;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text('REKAPITULASI JUARA (HASIL AKHIR)', 15, currentY);
    currentY += 4;

    const podiumBody = getPodiumRows(div, entryMap, allEntriesMap, integrityWarnings);
    const championsHead = ['Podium', 'Nama Tim / Pemain', 'Afiliasi / Klub'];

    autoTable(doc, {
      startY: currentY,
      head: [championsHead],
      body: podiumBody,
      theme: 'striped',
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 8.5, textColor: [15, 23, 42] },
      columnStyles: {
        0: { cellWidth: 50, fontStyle: 'bold' },
        1: { cellWidth: 80 },
        2: { cellWidth: 50 },
      },
      margin: { top: 15, bottom: 20, left: 15, right: 15 },
      pageBreak: 'auto',
      rowPageBreak: 'avoid'
    });

    currentY = (doc as any).lastAutoTable.finalY + 10;

    // --- SUB-SECTION 2: KLASEMEN GRUP (GROUP STANDINGS) ---
    if (div.groups && div.groups.length > 0) {
      if (currentY > 230) {
        doc.addPage();
        currentY = 20;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text('KLASEMEN FASE GRUP (ROUND ROBIN)', 15, currentY);
      currentY += 4;

      div.groups.forEach((group) => {
        if (currentY > 230) {
          doc.addPage();
          currentY = 20;
        }

        const groupTitle = getGroupName(group);
        const standings = calculateGroupStandings(group, div.roundRobinMatches || [], div.entries || [], div.settings?.playersQualifyingPerGroup || 2);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        doc.text(`Klasemen ${groupTitle}`, 15, currentY);
        currentY += 3;

        const standingsHead = ['Pos', 'Nama Tim / Pemain', 'Main', 'M', 'K', 'Poin +/-', 'Selisih', 'Status'];
        const standingsBody = standings.map(row => {
          const entry = resolveEntryById(row.entryId, entryMap, allEntriesMap);
          if (!entry) {
            integrityWarnings.push(`Klasemen ${groupTitle}: entryId tidak ditemukan: ${row.entryId}`);
          }
          const nameStr = entry ? formatEntryName(entry) : `Peserta tidak ditemukan [${row.entryId}]`;
          return [
            row.rank.toString(),
            nameStr,
            row.played.toString(),
            row.won.toString(),
            row.lost.toString(),
            `${row.pointsFor}-${row.pointsAgainst}`,
            row.pointDifference > 0 ? `+${row.pointDifference}` : row.pointDifference.toString(),
            row.rank <= (div.settings?.playersQualifyingPerGroup || 2) ? 'Qualify' : '-'
          ];
        });

        autoTable(doc, {
          startY: currentY,
          head: [standingsHead],
          body: standingsBody,
          theme: 'grid',
          headStyles: { fillColor: [71, 85, 105], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
          bodyStyles: { fontSize: 7.5, textColor: [15, 23, 42] },
          columnStyles: {
            0: { cellWidth: 10, halign: 'center', fontStyle: 'bold' },
            1: { cellWidth: 75 },
            2: { cellWidth: 12, halign: 'center' },
            3: { cellWidth: 12, halign: 'center' },
            4: { cellWidth: 12, halign: 'center' },
            5: { cellWidth: 20, halign: 'center' },
            6: { cellWidth: 15, halign: 'center' },
            7: { cellWidth: 24, halign: 'center' },
          },
          margin: { top: 15, bottom: 20, left: 15, right: 15 },
          pageBreak: 'auto',
          rowPageBreak: 'avoid'
        });

        currentY = (doc as any).lastAutoTable.finalY + 6;
      });

      currentY += 4;
    }

    // --- SUB-SECTION 3: HASIL SEMUA PERTANDINGAN ---
    if (currentY > 220) {
      doc.addPage();
      currentY = 20;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text('DETAIL HASIL PERTANDINGAN', 15, currentY);
    currentY += 4;

    const rrMatches = div.roundRobinMatches || [];
    const koMatches = div.knockoutStage?.matches || [];

    const allMatchesList: { type: string; info: string; team1: string; team2: string; score: string; winner: string; status: string }[] = [];

    rrMatches.forEach(m => {
      const t1 = resolveEntryById(m.entryId1, entryMap, allEntriesMap);
      const t2 = resolveEntryById(m.entryId2, entryMap, allEntriesMap);

      if (m.entryId1 && !t1 && m.entryId1 !== 'BYE') {
        integrityWarnings.push(`Match RR ${m.id}: entryId1 tidak ditemukan: ${m.entryId1}`);
      }
      if (m.entryId2 && !t2 && m.entryId2 !== 'BYE') {
        integrityWarnings.push(`Match RR ${m.id}: entryId2 tidak ditemukan: ${m.entryId2}`);
      }

      let winnerStr = '-';
      if (m.status === 'selesai' || m.status === 'walkover') {
        if (m.winnerId) {
          const winner = resolveEntryById(m.winnerId, entryMap, allEntriesMap);
          if (!winner) {
            integrityWarnings.push(`Match RR ${m.id}: winnerId tidak ditemukan: ${m.winnerId}`);
            winnerStr = `Peserta tidak ditemukan [${m.winnerId}]`;
          } else {
            winnerStr = formatEntryName(winner);
          }
        } else {
          winnerStr = 'Pemenang belum tercatat';
        }
      }

      const team1Str = t1 ? formatEntryName(t1) : (m.entryId1 === 'BYE' ? 'BYE' : (m.entryId1 ? `Peserta tidak ditemukan [${m.entryId1}]` : '-'));
      const team2Str = t2 ? formatEntryName(t2) : (m.entryId2 === 'BYE' ? 'BYE' : (m.entryId2 ? `Peserta tidak ditemukan [${m.entryId2}]` : '-'));

      allMatchesList.push({
        type: 'Round Robin',
        info: m.groupName ? sanitizePdfText(m.groupName) : 'Grup',
        team1: team1Str,
        team2: team2Str,
        score: formatScore(m),
        winner: winnerStr,
        status: m.status === 'selesai' ? 'Selesai' : (m.status === 'walkover' ? 'Walkover (W/O)' : 'Belum Dimainkan')
      });
    });

    koMatches.forEach(m => {
      const t1 = resolveEntryById(m.entryId1, entryMap, allEntriesMap);
      const t2 = resolveEntryById(m.entryId2, entryMap, allEntriesMap);

      if (m.entryId1 && !t1 && m.entryId1 !== 'BYE') {
        integrityWarnings.push(`Match KO ${m.id}: entryId1 tidak ditemukan: ${m.entryId1}`);
      }
      if (m.entryId2 && !t2 && m.entryId2 !== 'BYE') {
        integrityWarnings.push(`Match KO ${m.id}: entryId2 tidak ditemukan: ${m.entryId2}`);
      }

      let winnerStr = '-';
      if (m.status === 'selesai' || m.status === 'walkover') {
        if (m.winnerId) {
          const winner = resolveEntryById(m.winnerId, entryMap, allEntriesMap);
          if (!winner) {
            integrityWarnings.push(`Match KO ${m.id}: winnerId tidak ditemukan: ${m.winnerId}`);
            winnerStr = `Peserta tidak ditemukan [${m.winnerId}]`;
          } else {
            winnerStr = formatEntryName(winner);
          }
        } else {
          winnerStr = 'Pemenang belum tercatat';
        }
      }

      const team1Str = t1 ? formatEntryName(t1) : (m.entryId1 === 'BYE' ? 'BYE' : (m.entryId1 ? `Peserta tidak ditemukan [${m.entryId1}]` : '-'));
      const team2Str = t2 ? formatEntryName(t2) : (m.entryId2 === 'BYE' ? 'BYE' : (m.entryId2 ? `Peserta tidak ditemukan [${m.entryId2}]` : '-'));

      allMatchesList.push({
        type: 'Knockout',
        info: m.roundName ? sanitizePdfText(m.roundName) : 'Fase Gugur',
        team1: team1Str,
        team2: team2Str,
        score: formatScore(m),
        winner: winnerStr,
        status: m.status === 'selesai' ? 'Selesai' : (m.status === 'walkover' ? 'Walkover (W/O)' : 'Belum Dimainkan')
      });
    });

    if (allMatchesList.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(148, 163, 184);
      doc.text('Belum ada jadwal pertandingan yang di-generate.', 18, currentY);
      currentY += 6;
    } else {
      const matchesHead = ['Tipe', 'Fase / Grup', 'Tim A / Pemain A', 'Tim B / Pemain B', 'Skor', 'Pemenang', 'Status'];
      const matchesBody = allMatchesList.map(m => [
        m.type,
        m.info,
        m.team1,
        m.team2,
        m.score,
        m.winner,
        m.status
      ]);

      autoTable(doc, {
        startY: currentY,
        head: [matchesHead],
        body: matchesBody,
        theme: 'striped',
        headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 7, textColor: [51, 65, 85] },
        columnStyles: {
          0: { cellWidth: 18 },
          1: { cellWidth: 22 },
          2: { cellWidth: 42 },
          3: { cellWidth: 42 },
          4: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
          5: { cellWidth: 22 },
          6: { cellWidth: 16, halign: 'center' },
        },
        margin: { top: 15, bottom: 20, left: 15, right: 15 },
        pageBreak: 'auto',
        rowPageBreak: 'avoid'
      });

      currentY = (doc as any).lastAutoTable.finalY + 10;
    }
  });

  // Log integrity warnings if any
  if (integrityWarnings.length > 0) {
    console.warn('PDF DATA INTEGRITY WARNINGS:', integrityWarnings);
  }

  // --- FINAL PASS: DRAW HEADER ACCENT AND FOOTER WITH SINGLE SOURCE OF TRUTH PAGE NUMBERS ---
  const totalPages = doc.getNumberOfPages();

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // Top Navy Accent Bar
    doc.setFillColor(15, 23, 42); // Navy
    doc.rect(0, 0, 210, 3, 'F');

    // Footer font styling
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184); // Slate-400

    // Footer divider line
    doc.setDrawColor(226, 232, 240); // Slate-200
    doc.setLineWidth(0.2);
    doc.line(15, 282, 195, 282);

    // Footer text
    doc.text(`${sanitizedTitle}${formattedDate !== '-' ? ` - ${sanitizePdfText(formattedDate)}` : ''}`, 15, 287);
    const pageStr = `Halaman ${i} dari ${totalPages}`;
    doc.text(pageStr, 195, 287, { align: 'right' });
  }

  // Save the PDF
  const filename = `Laporan_Turnamen_${sanitizedTitle.replace(/[^a-zA-Z0-9]/g, '_') || 'Pickleball'}.pdf`;
  doc.save(filename);
}

