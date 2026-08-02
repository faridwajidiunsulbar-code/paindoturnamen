/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Tournament, Division, Match, Entry, ThirdPlaceMode } from '../types';
import { calculateGroupStandings } from './tournamentHelpers';

/**
 * Sanitizes string values for PDF rendering.
 * Strips surrogate pairs, emoji unicode ranges, control characters, and private use unicode.
 * Preserves standard Indonesian characters, numbers, letters, punctuation, and apostrophes (e.g. "Aco'").
 */
export function sanitizePdfText(text: string | null | undefined): string {
  if (text === null || text === undefined) return '';
  const str = String(text);
  return str
    .replace(/[\u1F600-\u1F64F\u1F300-\u1F5FF\u1F680-\u1F6FF\u1F700-\u1F77F\u1F780-\u1F7FF\u1F800-\u1F8FF\u1F900-\u1F9FF\u1FA00-\u1FA6F\u1FA70-\u1FAFF\u2600-\u26FF\u2700-\u27BF]/g, '')
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    .replace(/[\x00-\x09\x0B-\x1F\x7F-\x9F]/g, '')
    .trim();
}

// Helper to format player/team names safely
export function getEntryName(entry: Entry | undefined): string {
  if (!entry) return '-';
  if (entry.id === 'BYE') return 'BYE';
  const name = entry.name1 + (entry.name2 ? ` / ${entry.name2}` : '');
  const full = entry.affiliation ? `${name} (${entry.affiliation})` : name;
  return sanitizePdfText(full);
}

// Helper to get affiliation string
function getAffiliation(entryId: string | null | undefined, entries: Entry[]): string {
  if (!entryId) return '-';
  const entry = entries.find(e => e.id === entryId);
  return entry?.affiliation ? sanitizePdfText(entry.affiliation) : '-';
}

// Helper to format match score
export function formatScore(m: Match): string {
  if (m.status === 'belum_dimainkan') return 'Belum Dimainkan';
  if (m.status === 'walkover') return 'W/O (Walkover)';
  return `${m.score1 ?? 0} - ${m.score2 ?? 0}`;
}

// Helper to get winner label
export function getWinnerLabel(m: Match, entries: Entry[]): string {
  if (m.status !== 'selesai' && m.status !== 'walkover') return '-';
  if (!m.winnerId) return '-';
  const winner = entries.find(e => e.id === m.winnerId);
  return getEntryName(winner);
}

/**
 * Builds the podium rows based on actual thirdPlaceMode configuration.
 */
function getPodiumRows(division: Division, entries: Entry[]): [string, string, string][] {
  const settings = division.settings;
  const thirdPlaceMode: ThirdPlaceMode = settings?.thirdPlaceMode || (settings?.thirdPlaceEnabled === false ? 'none' : 'playoff');
  const champions = division.champions;
  const koMatches = division.knockoutStage?.matches || [];

  const c1Name = champions?.firstPlaceEntryId
    ? getEntryName(entries.find(e => e.id === champions.firstPlaceEntryId))
    : 'Belum ditentukan';
  const c1Aff = getAffiliation(champions?.firstPlaceEntryId, entries);

  const c2Name = champions?.secondPlaceEntryId
    ? getEntryName(entries.find(e => e.id === champions.secondPlaceEntryId))
    : 'Belum ditentukan';
  const c2Aff = getAffiliation(champions?.secondPlaceEntryId, entries);

  const rows: [string, string, string][] = [
    ['Champion (Juara 1)', c1Name, c1Aff],
    ['Runner Up (Juara 2)', c2Name, c2Aff],
  ];

  if (thirdPlaceMode === 'shared_bronze') {
    const sfMatches = koMatches.filter(m => m.roundName === 'Semifinal');
    const sf1 = sfMatches[0];
    const sf2 = sfMatches[1];

    const sf1LoserId = sf1 && (sf1.status === 'selesai' || sf1.status === 'walkover') ? sf1.loserId : null;
    const sf2LoserId = sf2 && (sf2.status === 'selesai' || sf2.status === 'walkover') ? sf2.loserId : null;

    const b1Name = sf1LoserId ? getEntryName(entries.find(e => e.id === sf1LoserId)) : 'Belum ditentukan';
    const b2Name = sf2LoserId ? getEntryName(entries.find(e => e.id === sf2LoserId)) : 'Belum ditentukan';

    rows.push(['Juara 3 Bersama', b1Name, getAffiliation(sf1LoserId, entries)]);
    rows.push(['Juara 3 Bersama', b2Name, getAffiliation(sf2LoserId, entries)]);

  } else if (thirdPlaceMode === 'playoff') {
    const bronzeMatch = koMatches.find(m => m.isBronzeMatch || m.roundName === 'Perebutan Juara 3');
    let j3Name = 'Belum ditentukan';
    let j3Aff = '-';
    let p4Name = 'Belum ditentukan';
    let p4Aff = '-';

    if (bronzeMatch && (bronzeMatch.status === 'selesai' || bronzeMatch.status === 'walkover') && bronzeMatch.winnerId) {
      const winnerEntry = entries.find(e => e.id === bronzeMatch.winnerId);
      const loserEntry = entries.find(e => e.id === bronzeMatch.loserId);
      j3Name = getEntryName(winnerEntry);
      j3Aff = winnerEntry?.affiliation ? sanitizePdfText(winnerEntry.affiliation) : '-';
      p4Name = getEntryName(loserEntry);
      p4Aff = loserEntry?.affiliation ? sanitizePdfText(loserEntry.affiliation) : '-';
    } else if (champions?.thirdPlaceEntryId) {
      const winnerEntry = entries.find(e => e.id === champions.thirdPlaceEntryId);
      j3Name = getEntryName(winnerEntry);
      j3Aff = winnerEntry?.affiliation ? sanitizePdfText(winnerEntry.affiliation) : '-';
    }

    rows.push(['Juara 3', j3Name, j3Aff]);
    rows.push(['Peringkat 4', p4Name, p4Aff]);
  }

  // If thirdPlaceMode === 'none', no 3rd or 4th place rows are added.

  return rows;
}

export function exportTournamentToPDF(tournament: Tournament): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const { name, date, location, activeDivisions } = tournament;

  const sanitizedTitle = sanitizePdfText(name || 'Nama Turnamen');
  const sanitizedLocation = sanitizePdfText(location || 'Belum diatur');

  // Title page or Header configuration
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
  const formattedDate = date 
    ? new Date(date).toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) 
    : 'Belum diatur';
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
  const totalEntries = activeDivisions.reduce((acc, d) => acc + d.entries.length, 0);
  doc.text(`${totalEntries} Tim`, 165, 49);

  let currentY = 68;

  // --- PROCESS EACH DIVISION ---
  activeDivisions.forEach((div, divIndex) => {
    // If not the first division, start a new page
    if (divIndex > 0) {
      doc.addPage();
      currentY = 20;
    }

    const eventNameClean = sanitizePdfText(div.eventName).toUpperCase();
    const ageGroupClean = sanitizePdfText(div.ageGroupName);

    // Division Title Bar
    doc.setFillColor(241, 245, 249); // Light Gray background
    doc.rect(15, currentY, 180, 10, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42); // Navy
    doc.text(`DIVISI: ${eventNameClean} (${ageGroupClean})`, 18, currentY + 7);

    currentY += 16;

    // --- SUB-SECTION 1: REKAPITULASI JUARA (CHAMPIONS) ---
    if (currentY > 230) {
      doc.addPage();
      currentY = 20;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text('REKAPITULASI JUARA (HASIL AKHIR)', 15, currentY);
    currentY += 4;

    const podiumBody = getPodiumRows(div, div.entries);
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

        const standings = calculateGroupStandings(group, div.roundRobinMatches, div.entries, div.settings.playersQualifyingPerGroup || 2);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        doc.text(`Klasemen ${sanitizePdfText(group.name)}`, 15, currentY);
        currentY += 3;

        const standingsHead = ['Pos', 'Nama Tim / Pemain', 'Main', 'M', 'K', 'Poin +/-', 'Selisih', 'Status'];
        const standingsBody = standings.map(row => {
          const entry = div.entries.find(e => e.id === row.entryId);
          const nameStr = getEntryName(entry);
          return [
            row.rank.toString(),
            nameStr,
            row.played.toString(),
            row.won.toString(),
            row.lost.toString(),
            `${row.pointsFor}-${row.pointsAgainst}`,
            row.pointDifference > 0 ? `+${row.pointDifference}` : row.pointDifference.toString(),
            row.rank <= (div.settings.playersQualifyingPerGroup || 2) ? 'Qualify' : '-'
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

    const rrMatches = div.roundRobinMatches;
    const koMatches = div.knockoutStage?.matches || [];
    
    const allMatchesList: { type: string; info: string; team1: string; team2: string; score: string; winner: string; status: string }[] = [];

    rrMatches.forEach(m => {
      const t1 = div.entries.find(e => e.id === m.entryId1);
      const t2 = div.entries.find(e => e.id === m.entryId2);
      allMatchesList.push({
        type: 'Round Robin',
        info: sanitizePdfText(m.groupName) || 'Grup',
        team1: getEntryName(t1),
        team2: getEntryName(t2),
        score: formatScore(m),
        winner: getWinnerLabel(m, div.entries),
        status: m.status === 'selesai' ? 'Selesai' : (m.status === 'walkover' ? 'Walkover (W/O)' : 'Belum Dimainkan')
      });
    });

    koMatches.forEach(m => {
      const t1 = m.entryId1 === 'BYE' ? { id: 'BYE', name1: 'BYE' } : div.entries.find(e => e.id === m.entryId1);
      const t2 = m.entryId2 === 'BYE' ? { id: 'BYE', name1: 'BYE' } : div.entries.find(e => e.id === m.entryId2);
      allMatchesList.push({
        type: 'Knockout',
        info: sanitizePdfText(m.roundName) || 'Fase Gugur',
        team1: getEntryName(t1 as any),
        team2: getEntryName(t2 as any),
        score: formatScore(m),
        winner: getWinnerLabel(m, div.entries),
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

  // --- FINAL PASS: DRAW HEADER ACCENT AND FOOTER WITH SINGLE SOURCE OF TRUTH PAGE NUMBERS ---
  const totalPages = doc.getNumberOfPages();
  const dateStr = date
    ? new Date(date).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

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
    doc.text(`${sanitizedTitle}${dateStr ? ` - ${sanitizePdfText(dateStr)}` : ''}`, 15, 287);
    const pageStr = `Halaman ${i} dari ${totalPages}`;
    doc.text(pageStr, 195, 287, { align: 'right' });
  }

  // Save the PDF
  const filename = `Laporan_Turnamen_${sanitizedTitle.replace(/[^a-zA-Z0-9]/g, '_') || 'Pickleball'}.pdf`;
  doc.save(filename);
}
