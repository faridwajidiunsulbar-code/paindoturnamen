/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Tournament, Division, Match, Entry, Group } from '../types';
import { calculateGroupStandings } from './tournamentHelpers';

// Helper to format player/team names
export function getEntryName(entry: Entry | undefined): string {
  if (!entry) return '-';
  const name = entry.name1 + (entry.name2 ? ` / ${entry.name2}` : '');
  return entry.affiliation ? `${name} (${entry.affiliation})` : name;
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

export function exportTournamentToPDF(tournament: Tournament): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const { name, date, location, activeDivisions } = tournament;

  // Title page or Header configuration
  const titleColor = [15, 23, 42]; // Slate-900 / Navy
  const accentColor = [16, 185, 129]; // Emerald Green
  const textColor = [71, 85, 105]; // Slate-600

  // Total pages helper for footer
  let pageNumber = 1;

  const addHeaderFooter = (document: jsPDF, isFirstPage: boolean = false) => {
    // Top border
    document.setFillColor(15, 23, 42); // Navy
    document.rect(0, 0, 210, 3, 'F');

    // Footer
    document.setFont('helvetica', 'normal');
    document.setFontSize(8);
    document.setTextColor(148, 163, 184); // Slate-400
    
    // Page number text
    const pageStr = `Halaman ${pageNumber}`;
    document.text(pageStr, 195, 287, { align: 'right' });

    // Copyright / Date text
    const dateStr = date ? new Date(date).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
    document.text(`${name} - ${dateStr}`, 15, 287);

    // Subtle line above footer
    document.setDrawColor(226, 232, 240); // Slate-200
    document.setLineWidth(0.2);
    document.line(15, 282, 195, 282);
  };

  // --- FIRST PAGE / MAIN HEADER ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(titleColor[0], titleColor[1], titleColor[2]);
  doc.text('LAPORAN HASIL TURNAMEN', 15, 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
  doc.text(name || 'Nama Turnamen', 15, 28);

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
  doc.text(formattedDate, 65, 41);
  doc.text(location || 'Belum diatur', 65, 49);

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
    // If not the first division, check if we need to start a new page or add a clean space
    if (divIndex > 0) {
      doc.addPage();
      pageNumber++;
      currentY = 20;
    }

    addHeaderFooter(doc);

    // Division Title Bar
    doc.setFillColor(241, 245, 249); // Light Gray background
    doc.rect(15, currentY, 180, 10, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42); // Navy
    doc.text(`DIVISI: ${div.eventName.toUpperCase()} (${div.ageGroupName})`, 18, currentY + 7);

    currentY += 16;

    // --- SUB-SECTION 1: REKAPITULASI JUARA (CHAMPIONS) ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text('🏆 REKAPITULASI JUARA (HASIL AKHIR)', 15, currentY);
    currentY += 4;

    const championsData = [
      ['Podium', 'Nama Tim / Pemain', 'Afiliasi / Klub'],
      [
        '🥇 Champion (Juara 1)',
        div.champions?.firstPlaceEntryId 
          ? getEntryName(div.entries.find(e => e.id === div.champions!.firstPlaceEntryId)) 
          : 'Belum ditentukan',
        div.champions?.firstPlaceEntryId 
          ? (div.entries.find(e => e.id === div.champions!.firstPlaceEntryId)?.affiliation || '-') 
          : '-'
      ],
      [
        '🥈 Runner Up (Juara 2)',
        div.champions?.secondPlaceEntryId 
          ? getEntryName(div.entries.find(e => e.id === div.champions!.secondPlaceEntryId)) 
          : 'Belum ditentukan',
        div.champions?.secondPlaceEntryId 
          ? (div.entries.find(e => e.id === div.champions!.secondPlaceEntryId)?.affiliation || '-') 
          : '-'
      ],
      [
        '🥉 Juara 3 (Bersama / Perebutan)',
        div.champions?.thirdPlaceEntryId 
          ? getEntryName(div.entries.find(e => e.id === div.champions!.thirdPlaceEntryId)) 
          : 'Belum ditentukan',
        div.champions?.thirdPlaceEntryId 
          ? (div.entries.find(e => e.id === div.champions!.thirdPlaceEntryId)?.affiliation || '-') 
          : '-'
      ],
    ];

    autoTable(doc, {
      startY: currentY,
      head: [championsData[0]],
      body: championsData.slice(1),
      theme: 'striped',
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 8.5, textColor: [15, 23, 42] },
      columnStyles: {
        0: { cellWidth: 50, fontStyle: 'bold' },
        1: { cellWidth: 80 },
        2: { cellWidth: 50 },
      },
      margin: { left: 15, right: 15 },
    });

    currentY = (doc as any).lastAutoTable.finalY + 10;

    // --- SUB-SECTION 2: KLASEMEN GRUP (GROUP STANDINGS) ---
    if (div.groups && div.groups.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text('📊 KLASEMEN FASE GRUP (ROUND ROBIN)', 15, currentY);
      currentY += 4;

      div.groups.forEach((group, gIndex) => {
        // Compute standings on-the-fly for latest stats
        const standings = calculateGroupStandings(group, div.roundRobinMatches, div.entries);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        doc.text(`Klasemen ${group.name}`, 15, currentY);
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
          margin: { left: 15, right: 15 },
        });

        currentY = (doc as any).lastAutoTable.finalY + 6;
      });

      currentY += 4;
    }

    // --- SUB-SECTION 3: HASIL SEMUA PERTANDINGAN ---
    // Check page space. If too low, add a new page.
    if (currentY > 230) {
      doc.addPage();
      pageNumber++;
      currentY = 20;
      addHeaderFooter(doc);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text('🏸 DETAIL HASIL PERTANDINGAN', 15, currentY);
    currentY += 4;

    // Compile Round Robin matches
    const rrMatches = div.roundRobinMatches;
    // Compile Knockout matches
    const koMatches = div.knockoutStage?.matches || [];
    
    const allMatchesList: { type: string; info: string; team1: string; team2: string; score: string; winner: string; status: string }[] = [];

    rrMatches.forEach(m => {
      const t1 = div.entries.find(e => e.id === m.entryId1);
      const t2 = div.entries.find(e => e.id === m.entryId2);
      allMatchesList.push({
        type: 'Round Robin',
        info: m.groupName || 'Grup',
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
        info: m.roundName || 'Fase Gugur',
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
        margin: { left: 15, right: 15 },
        didDrawPage: (data) => {
          // Keep footers accurate on auto-wrapped pages
          pageNumber++;
          addHeaderFooter(doc);
        }
      });

      currentY = (doc as any).lastAutoTable.finalY + 10;
    }
  });

  // Save the PDF
  const filename = `Laporan_Turnamen_${name.replace(/[^a-zA-Z0-9]/g, '_') || 'Pickleball'}.pdf`;
  doc.save(filename);
}
