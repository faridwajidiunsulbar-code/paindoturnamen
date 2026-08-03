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

function hasLetterOrNumber(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

/**
 * Helper to thoroughly clean name strings.
 * Preserves apostrophes (e.g. "A'ba Uni'", "O'Connor"), hyphens ("Abdul-Rahman"), etc.
 * Strings containing letters or numbers are preserved intact.
 * Strings consisting purely of punctuation/symbols/slashes are returned as empty.
 */
export function cleanNameStr(val: unknown): string {
  if (val === null || val === undefined) return '';
  const normalized = String(val)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim();

  return hasLetterOrNumber(normalized) ? normalized : '';
}

export interface ExtractedNames {
  name1: string;
  name2: string;
  affiliation: string;
}

/**
 * Extracts player names and affiliation from ANY runtime entry shape.
 * Handles:
 * - Canonical Entry: { id, name1, name2, affiliation }
 * - DB shape: { player1_name, player2_name, club }
 * - Alternative shapes: { player1Name, player2Name, organization }, { player1: { name }, player2: { name } }, { players: [...] }, { teamName }, { name }
 */
export function extractEntryNames(raw: unknown): ExtractedNames {
  if (!raw || typeof raw !== 'object') {
    return { name1: '', name2: '', affiliation: '' };
  }

  const entry = raw as Record<string, any>;

  let rawName1 = String(
    entry.name1 ??
    entry.player1_name ??
    entry.player1Name ??
    entry.player1_full_name ??
    entry.player1?.name ??
    (Array.isArray(entry.players) && entry.players[0] ? (typeof entry.players[0] === 'string' ? entry.players[0] : entry.players[0]?.name) : '') ??
    entry.entryName ??
    entry.entry_name ??
    entry.teamName ??
    entry.team_name ??
    entry.name ??
    entry.displayName ??
    ''
  ).trim();

  let name2FromSplit = '';
  if (rawName1 && !entry.name2 && !entry.player2_name && !entry.player2Name && rawName1.includes(' / ')) {
    const parts = rawName1.split(' / ');
    rawName1 = parts[0].trim();
    name2FromSplit = parts.slice(1).join(' / ').trim();
  }

  let rawName2 = String(
    entry.name2 ??
    entry.player2_name ??
    entry.player2Name ??
    entry.player2_full_name ??
    entry.player2?.name ??
    (Array.isArray(entry.players) && entry.players[1] ? (typeof entry.players[1] === 'string' ? entry.players[1] : entry.players[1]?.name) : '') ??
    name2FromSplit ??
    ''
  ).trim();

  const rawAffiliation = String(
    entry.affiliation ??
    entry.club ??
    entry.organization ??
    entry.teamClub ??
    entry.club_name ??
    ''
  ).trim();

  const name1 = cleanNameStr(rawName1);
  const name2 = cleanNameStr(rawName2);
  const affiliation = cleanNameStr(rawAffiliation);

  return { name1, name2, affiliation };
}

/**
 * Formats extracted entry names into a safe string.
 * Never outputs "/", "/ ( )", "()", or empty slashes.
 */
export function formatResolvedEntry(raw: unknown, entryId?: string | null): string {
  if (entryId === 'BYE') return 'BYE';

  const { name1, name2 } = extractEntryNames(raw);

  if (name1 && name2) {
    return `${name1} / ${name2}`;
  }
  if (name1) {
    return name1;
  }
  if (name2) {
    return name2;
  }

  return entryId && entryId !== 'BYE'
    ? `Peserta tidak ditemukan [${entryId}]`
    : 'Nama peserta tidak tersedia';
}

/**
 * Gets clean affiliation text.
 */
export function getAffiliationText(raw: unknown): string {
  const { affiliation } = extractEntryNames(raw);
  return affiliation || '-';
}

/**
 * Canonical entry resolver that resolves either an entry ID string or entry object
 * using division entryMap and global fallback map.
 */
export function resolveEntryDisplay(
  entryOrId: unknown,
  entryMap: Map<string, Entry>,
  globalEntryMap?: Map<string, Entry>
): { nameStr: string; affStr: string; entry: Entry | null } {
  if (!entryOrId) {
    return { nameStr: 'Nama peserta tidak tersedia', affStr: '-', entry: null };
  }

  // 1. If entryOrId is an ID string or number
  if (typeof entryOrId === 'string' || typeof entryOrId === 'number') {
    const id = String(entryOrId).trim();
    if (id === 'BYE') {
      return { nameStr: 'BYE', affStr: '-', entry: { id: 'BYE', name1: 'BYE' } };
    }

    let found = entryMap.get(id) ?? globalEntryMap?.get(id) ?? null;

    // Case-insensitive / normalized lookup fallback
    if (!found) {
      const idLower = id.toLowerCase();
      for (const [k, v] of entryMap.entries()) {
        if (k.toLowerCase() === idLower) {
          found = v;
          break;
        }
      }
      if (!found && globalEntryMap) {
        for (const [k, v] of globalEntryMap.entries()) {
          if (k.toLowerCase() === idLower) {
            found = v;
            break;
          }
        }
      }
    }

    if (!found) {
      console.debug('PDF_LOOKUP_MISSING', { requestedId: id, sampleKeys: [...entryMap.keys()].slice(0, 10) });
      return { nameStr: `Peserta tidak ditemukan [${id}]`, affStr: '-', entry: null };
    }

    return {
      nameStr: formatResolvedEntry(found, id),
      affStr: getAffiliationText(found),
      entry: found
    };
  }

  // 2. If entryOrId is an object
  if (typeof entryOrId === 'object') {
    const entryObj = entryOrId as Record<string, any>;
    const objId = entryObj.id ?? entryObj.entryId ?? entryObj.entry_id ?? null;

    if (objId) {
      const idStr = String(objId).trim();
      const foundInMap = entryMap.get(idStr) ?? globalEntryMap?.get(idStr) ?? null;
      if (foundInMap) {
        return {
          nameStr: formatResolvedEntry(foundInMap, idStr),
          affStr: getAffiliationText(foundInMap),
          entry: foundInMap
        };
      }
    }

    const nameStr = formatResolvedEntry(entryObj, objId ? String(objId) : null);
    const affStr = getAffiliationText(entryObj);
    const hasNames = nameStr && !nameStr.startsWith('Peserta tidak ditemukan') && nameStr !== 'Nama peserta tidak tersedia';

    return {
      nameStr,
      affStr,
      entry: hasNames ? (entryObj as Entry) : null
    };
  }

  return { nameStr: 'Nama peserta tidak tersedia', affStr: '-', entry: null };
}

/**
 * Priority resolver for Division Title:
 * 1. division.name or division.displayName
 * 2. details (eventName / ageGroupName / matchTypeName)
 * 3. Fallback: "Divisi [id]"
 */
export function getDivisionTitle(division: Division): string {
  if (!division) return 'Divisi Tidak Diketahui';

  const rawName = (division as any).name || (division as any).displayName || (division as any).title || (division as any).divisionName || (division as any).division_name;
  const customName = cleanNameStr(rawName);

  let eventName = cleanNameStr(division.eventName || (division as any).event_name || (division as any).event?.name);
  let ageGroupName = cleanNameStr(division.ageGroupName || (division as any).age_group_name || (division as any).ageGroup?.name);

  if (!eventName && (division.eventId || division.id)) {
    const evId = (division.eventId || division.id.split('-')[0] || '').replace(/_/g, ' ');
    if (evId) eventName = evId.replace(/\b\w/g, l => l.toUpperCase());
  }

  if (!ageGroupName && (division.ageGroupId || division.id)) {
    const agId = (division.ageGroupId || division.id.split('-')[1] || '').replace(/_/g, ' ');
    if (agId) ageGroupName = agId.replace(/\b\w/g, l => l.toUpperCase());
  }

  const details = [eventName, ageGroupName, cleanNameStr((division as any).matchTypeName)]
    .filter(val => val.length > 0 && val.toLowerCase() !== 'unknown event' && val.toLowerCase() !== 'unknown age');

  if (customName) {
    if (details.length > 0 && !customName.includes(details[0])) {
      return `${customName} — ${details.join(' / ')}`;
    }
    return customName;
  }

  if (details.length > 0) {
    return details.join(' / ');
  }

  return `Divisi ${division.id || 'Tanpa Nama'}`;
}

/**
 * Resolver for Group Name:
 * Resolves to "Grup A", "Grup B", etc.
 * Never outputs just "Klasemen".
 */
export function getGroupName(group: Group | { id?: string; name?: string }, index: number = 0): string {
  if (!group) return `Grup ${String.fromCharCode(65 + index)}`;

  const rawName = String(group.name ?? '').trim();
  const cleanName = cleanNameStr(rawName);

  if (cleanName && cleanName.toLowerCase() !== 'klasemen' && cleanName.toLowerCase() !== 'grup' && cleanName.toLowerCase() !== 'pool') {
    if (/^(grup|pool)\s+/i.test(cleanName)) {
      return cleanName;
    }
    return `Grup ${cleanName}`;
  }

  const rawId = String((group as any).id ?? '').trim();
  const cleanId = rawId.replace(/^(group_|grup_|pool_)/i, '').toUpperCase();
  if (cleanId && cleanId.length <= 3 && !cleanId.includes('-')) {
    return `Grup ${cleanId}`;
  }

  return `Grup ${String.fromCharCode(65 + index)}`;
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
  globalEntryMap: Map<string, Entry>,
  integrityWarnings: string[],
  trackLookup: (found: boolean) => void
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

      const { nameStr, affStr, entry } = resolveEntryDisplay(pEntry.entryId || (pEntry as any).entry || pEntry, entryMap, globalEntryMap);
      trackLookup(!!entry);
      if (!entry && pEntry.entryId) {
        integrityWarnings.push(`Podium division ${division.id}: entryId tidak ditemukan: ${pEntry.entryId}`);
      }
      rows.push([label, nameStr, affStr]);
    });
    return rows;
  }

  const champs = division.champions;
  if (champs && (champs.firstPlaceEntryId || champs.secondPlaceEntryId || champs.thirdPlaceEntryId)) {
    if (champs.firstPlaceEntryId) {
      const { nameStr, affStr, entry } = resolveEntryDisplay(champs.firstPlaceEntryId, entryMap, globalEntryMap);
      trackLookup(!!entry);
      if (!entry) integrityWarnings.push(`Champions Juara 1 division ${division.id}: entryId tidak ditemukan: ${champs.firstPlaceEntryId}`);
      rows.push(['Champion (Juara 1)', nameStr, affStr]);
    }
    if (champs.secondPlaceEntryId) {
      const { nameStr, affStr, entry } = resolveEntryDisplay(champs.secondPlaceEntryId, entryMap, globalEntryMap);
      trackLookup(!!entry);
      if (!entry) integrityWarnings.push(`Champions Juara 2 division ${division.id}: entryId tidak ditemukan: ${champs.secondPlaceEntryId}`);
      rows.push(['Runner Up (Juara 2)', nameStr, affStr]);
    }
    if (champs.thirdPlaceEntryId) {
      const { nameStr, affStr, entry } = resolveEntryDisplay(champs.thirdPlaceEntryId, entryMap, globalEntryMap);
      trackLookup(!!entry);
      if (!entry) integrityWarnings.push(`Champions Juara 3 division ${division.id}: entryId tidak ditemukan: ${champs.thirdPlaceEntryId}`);
      rows.push(['Juara 3', nameStr, affStr]);
    }
    return rows;
  }

  rows.push(['Status Pengesahan Podium', 'Belum disahkan', '-']);
  return rows;
}

export function exportTournamentToPDF(tournament: Tournament): void {
  // --- SECTION C: RUNTIME MARKER ---
  console.warn('PDF_CANONICAL_RESOLVER_V3_ACTIVE');

  // --- SECTION A: AUDIT RUNTIME LOGGING ---
  console.debug('PDF_RUNTIME_TOURNAMENT', tournament);

  console.debug(
    'PDF_RUNTIME_DIVISIONS',
    tournament.activeDivisions?.map(d => ({
      id: d.id,
      name: (d as any).name,
      eventName: d.eventName,
      ageGroupName: d.ageGroupName,
      matchTypeName: (d as any).matchTypeName,
      entries: d.entries,
      groups: d.groups,
      officialPodium: d.officialPodium
    }))
  );

  console.debug(
    'PDF_RUNTIME_FIRST_ENTRY',
    tournament.activeDivisions?.[0]?.entries?.[0]
  );

  console.debug(
    'PDF_RUNTIME_FIRST_STANDING',
    tournament.activeDivisions?.[0]?.groups?.[0]
      ? calculateGroupStandings(
          tournament.activeDivisions[0].groups[0],
          tournament.activeDivisions[0].roundRobinMatches || [],
          tournament.activeDivisions[0].entries || [],
          2
        )?.[0]
      : null
  );

  console.debug(
    'PDF_RUNTIME_FIRST_MATCH',
    tournament.activeDivisions?.[0]?.roundRobinMatches?.[0] ||
      tournament.activeDivisions?.[0]?.knockoutStage?.matches?.[0]
  );

  console.debug(
    'PDF_RUNTIME_OFFICIAL_PODIUM',
    tournament.activeDivisions?.[0]?.officialPodium
  );

  const integrityWarnings: string[] = [];
  let totalRequestedCount = 0;
  let missingCount = 0;

  const trackLookup = (found: boolean) => {
    totalRequestedCount++;
    if (!found) missingCount++;
  };

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const { name, date, location, activeDivisions = [] } = tournament;

  // Build global fallback entry map
  const globalEntryMap = new Map<string, Entry>();

  // Collect entries from activeDivisions
  activeDivisions.forEach(div => {
    (div.entries || []).forEach(e => {
      if (e && typeof e === 'object') {
        const id = (e as any).id ?? (e as any).entryId ?? (e as any).entry_id;
        if (id) {
          globalEntryMap.set(String(id).trim(), e);
        }
      }
    });
  });

  // Collect entries from global tournament fields if present
  const globalEntriesArr = (tournament as any).entries || (tournament as any).participants || [];
  if (Array.isArray(globalEntriesArr)) {
    globalEntriesArr.forEach((e: any) => {
      if (e && typeof e === 'object') {
        const id = e.id ?? e.entryId ?? e.entry_id;
        if (id) {
          globalEntryMap.set(String(id).trim(), e);
        }
      }
    });
  }

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

  // Diagnostic badge line
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('PDF Engine: Canonical Resolver V3', 140, 20);

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
    for (const entry of div.entries ?? []) {
      if (entry && entry.id) {
        entryMap.set(String(entry.id).trim(), entry);
      }
    }

    console.log('PDF_ENTRY_MAP_AUDIT', {
      divisionId: div.id,
      size: entryMap.size,
      entries: Array.from(entryMap.entries()).map(([id, entry]) => ({
        id,
        name1: entry.name1,
        name2: entry.name2
      }))
    });

    if (divIndex > 0) {
      doc.addPage();
      currentY = 20;
    }

    const divTitle = getDivisionTitle(div);

    // --- REQUIREMENT D LOGGING ---
    console.log('FINAL_DIVISION_TITLE_BEFORE_PDF', divTitle);

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

    const podiumBody = getPodiumRows(div, entryMap, globalEntryMap, integrityWarnings, trackLookup);
    const championsHead = ['Podium', 'Nama Tim / Pemain', 'Afiliasi / Klub'];

    // --- REQUIREMENT D LOGGING ---
    console.log('FINAL_PODIUM_ROWS_BEFORE_PDF', podiumBody);

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

      div.groups.forEach((group, groupIdx) => {
        if (currentY > 230) {
          doc.addPage();
          currentY = 20;
        }

        const groupTitle = getGroupName(group, groupIdx);
        const standings = calculateGroupStandings(group, div.roundRobinMatches || [], div.entries || [], div.settings?.playersQualifyingPerGroup || 2);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        doc.text(`Klasemen ${groupTitle}`, 15, currentY);
        currentY += 3;

        const standingsHead = ['Pos', 'Nama Tim / Pemain', 'Main', 'M', 'K', 'Poin +/-', 'Selisih', 'Status'];
        const standingsBody = standings.map(row => {
          const rowKey = row.entryId ?? (row as any).id ?? (row as any).entry?.id;
          const { nameStr, entry } = resolveEntryDisplay(row.entry || rowKey || row.entryName, entryMap, globalEntryMap);
          trackLookup(!!entry);
          if (!entry && rowKey) {
            integrityWarnings.push(`Klasemen ${groupTitle}: entryId tidak ditemukan: ${rowKey}`);
          }
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

        // --- REQUIREMENT D LOGGING ---
        console.log('FINAL_STANDINGS_ROWS_BEFORE_PDF', standingsBody);

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
      const id1 = m.entryId1 ?? (m as any).entryAId ?? (m as any).entry_a_id;
      const id2 = m.entryId2 ?? (m as any).entryBId ?? (m as any).entry_b_id;

      const res1 = resolveEntryDisplay(id1, entryMap, globalEntryMap);
      const res2 = resolveEntryDisplay(id2, entryMap, globalEntryMap);

      if (id1 && id1 !== 'BYE') trackLookup(!!res1.entry);
      if (id2 && id2 !== 'BYE') trackLookup(!!res2.entry);

      if (id1 && !res1.entry && id1 !== 'BYE') {
        integrityWarnings.push(`Match RR ${m.id}: entryId1 tidak ditemukan: ${id1}`);
      }
      if (id2 && !res2.entry && id2 !== 'BYE') {
        integrityWarnings.push(`Match RR ${m.id}: entryId2 tidak ditemukan: ${id2}`);
      }

      let winnerStr = '-';
      if (m.status === 'selesai' || m.status === 'walkover') {
        const wId = m.winnerId ?? (m as any).winner_entry_id;
        if (wId) {
          const resW = resolveEntryDisplay(wId, entryMap, globalEntryMap);
          trackLookup(!!resW.entry);
          if (!resW.entry) {
            integrityWarnings.push(`Match RR ${m.id}: winnerId tidak ditemukan: ${wId}`);
          }
          winnerStr = resW.nameStr;
        } else {
          winnerStr = 'Pemenang belum tercatat';
        }
      }

      allMatchesList.push({
        type: 'Round Robin',
        info: m.groupName ? sanitizePdfText(m.groupName) : 'Grup',
        team1: res1.nameStr,
        team2: res2.nameStr,
        score: formatScore(m),
        winner: winnerStr,
        status: m.status === 'selesai' ? 'Selesai' : (m.status === 'walkover' ? 'Walkover (W/O)' : 'Belum Dimainkan')
      });
    });

    koMatches.forEach(m => {
      const id1 = m.entryId1 ?? (m as any).entryAId ?? (m as any).entry_a_id;
      const id2 = m.entryId2 ?? (m as any).entryBId ?? (m as any).entry_b_id;

      const res1 = resolveEntryDisplay(id1, entryMap, globalEntryMap);
      const res2 = resolveEntryDisplay(id2, entryMap, globalEntryMap);

      if (id1 && id1 !== 'BYE') trackLookup(!!res1.entry);
      if (id2 && id2 !== 'BYE') trackLookup(!!res2.entry);

      if (id1 && !res1.entry && id1 !== 'BYE') {
        integrityWarnings.push(`Match KO ${m.id}: entryId1 tidak ditemukan: ${id1}`);
      }
      if (id2 && !res2.entry && id2 !== 'BYE') {
        integrityWarnings.push(`Match KO ${m.id}: entryId2 tidak ditemukan: ${id2}`);
      }

      let winnerStr = '-';
      if (m.status === 'selesai' || m.status === 'walkover') {
        const wId = m.winnerId ?? (m as any).winner_entry_id;
        if (wId) {
          const resW = resolveEntryDisplay(wId, entryMap, globalEntryMap);
          trackLookup(!!resW.entry);
          if (!resW.entry) {
            integrityWarnings.push(`Match KO ${m.id}: winnerId tidak ditemukan: ${wId}`);
          }
          winnerStr = resW.nameStr;
        } else {
          winnerStr = 'Pemenang belum tercatat';
        }
      }

      allMatchesList.push({
        type: 'Knockout',
        info: m.roundName ? sanitizePdfText(m.roundName) : 'Fase Gugur',
        team1: res1.nameStr,
        team2: res2.nameStr,
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

      // --- REQUIREMENT D LOGGING ---
      console.log('FINAL_MATCH_ROWS_BEFORE_PDF', matchesBody);

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

  // --- SECTION K: FAIL-LOUD IN DEVELOPMENT ---
  if (totalRequestedCount > 0) {
    const missingRatio = missingCount / totalRequestedCount;
    if (missingRatio > 0.2) {
      const isDev = process.env.NODE_ENV !== 'production' || (import.meta as any).env?.DEV;
      if (isDev) {
        throw new Error(
          `PDF entry resolver gagal: ${missingCount}/${totalRequestedCount} peserta tidak ditemukan`
        );
      } else {
        console.warn(`PDF entry resolver warning: ${missingCount}/${totalRequestedCount} peserta tidak ditemukan.`);
      }
    }
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
