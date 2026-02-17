const crypto = require('crypto');
const config = require('./config');

/**
 * NZ Fire/Ambulance pager call type detection patterns.
 * Maps keywords/patterns found in pager messages to call types.
 */
// ── FENZ fire type codes (appear at start of FLEX dispatch messages) ──
const FENZ_TYPE_CODES = new Set([
  'ADV', 'EXERCISE', 'FIREALM', 'FIRETEST', 'HAZ', 'HAZGAS',
  'MED', 'MEDFR', 'MIN', 'NAT1', 'NAT2', 'NAT3', 'STRU',
  'MVC', 'STNCALL', 'MVCHEVY', 'MVCRESC', 'RESC', 'SHIP',
  'SPRNKLR', 'VEG', 'TRA', 'USAR', 'WATRESC',
]);

// ── Known NZ ambulance AMPDS call type descriptions ──
// Ordered longest-first so "SERIOUS HAEMORRHAGE" matches before "HAEMORRHAGE"
const AMBO_CALL_TYPES = [
  'ABNORMAL BREATHING', 'ACUTE ADMISSION', 'DIFFICULTY BREATHING',
  'INEFFECTIVE BREATHING', 'RESPIRATORY ARREST', 'SERIOUS HAEMORRHAGE',
  'CARDIAC PROBLEM', 'COMMUNITY ALARM', 'DIZZINESS/VERTIGO',
  'HEART PROBLEM', 'HEAT EXPOSURE', 'IMPENDING FIT',
  'INTENDING SUICIDE', 'NEAR DROWNING', 'SUICIDAL IDEATION',
  'UNKNOWN PROBLEM', 'WEAKNESS/NUMBNESS', 'ABDO PAIN',
  'ALTERED LOC', 'BACK PAIN', 'BITE/ATTACK', 'CHEST PAIN',
  'CO/INH/HAZ', 'ELECTROCUTION', 'EYE INJURY', 'FEVER/CHILLS',
  'HAEMORRHAGE', 'PSYCH/SUICIDE', 'SICK PERSON', 'STAB/GSW',
  'ACCIDENT', 'ALLERGY', 'ARREST', 'ASSAULT', 'BURNS',
  'CHOKING', 'DIABETIC', 'DROWNING', 'FAINT', 'FALL',
  'FITTING', 'HEADACHE', 'MVA', 'NAUSEA', 'OBSTETRIC',
  'OVERDOSE', 'PAIN', 'PARALYSIS', 'POISONING', 'SEIZURE',
  'STROKE', 'TRAUMA', 'UNCONSCIOUS', 'VOMITING',
];

const CALL_TYPE_PATTERNS = [
  // ── FENZ fire codes (short identifiers in FLEX messages) ──
  { pattern: /\bFIREALM\b/i, type: 'FIREALM' },
  { pattern: /\bSTRU\b/i, type: 'STRU' },
  { pattern: /\bVEG\b/i, type: 'VEG' },
  { pattern: /\bMVCRESC\b/i, type: 'MVCRESC' },
  { pattern: /\bMVCHEVY\b/i, type: 'MVCHEVY' },
  { pattern: /\bMVC\b/i, type: 'MVC' },
  { pattern: /\bHAZGAS\b/i, type: 'HAZGAS' },
  { pattern: /\bHAZ\b/i, type: 'HAZ' },
  { pattern: /\bMEDFR\b/i, type: 'MEDFR' },
  { pattern: /\bMED\b/i, type: 'MED' },
  { pattern: /\bMIN\b/i, type: 'MIN' },
  { pattern: /\bWATRESC\b/i, type: 'WATRESC' },
  { pattern: /\bRESC\b/i, type: 'RESC' },
  { pattern: /\bUSAR\b/i, type: 'USAR' },
  { pattern: /\bSPRNKLR\b/i, type: 'SPRNKLR' },
  { pattern: /\bNAT[123]\b/i, type: 'NAT1' }, // NAT1/2/3
  { pattern: /\bSHIP\b/i, type: 'SHIP' },
  { pattern: /\bSTNCALL\b/i, type: 'STNCALL' },
  { pattern: /\bADV\b/i, type: 'ADV' },
  { pattern: /\bTRA\b/i, type: 'TRA' },
  { pattern: /\bEXERCISE\b/i, type: 'EXERCISE' },
  { pattern: /\bFIRETEST\b/i, type: 'FIRETEST' },
  // ── Generic fallbacks (matched after specific codes) ──
  { pattern: /\bTEST\s*(?:PAGE|MSG|CALL)?\b/i, type: 'TEST' },
];

/**
 * NZ location detection patterns - extracts location from message content.
 */
const LOCATION_PATTERNS = [
  // "at <address>" or "@ <address>"
  /(?:^|\s)(?:at|@)\s+(.+?)(?:\s*[-,.]|\s+(?:for|re:|type:|priority:)|\s*$)/i,
  // Street address pattern
  /(\d+[a-z]?\s+\w+\s+(?:st(?:reet)?|rd|road|ave(?:nue)?|dr(?:ive)?|pl(?:ace)?|cr(?:es(?:cent)?)?|tce|terrace|way|lane|ln|blvd|hwy|highway|crt|court)(?:\s*,?\s*\w+)?)/i,
];

/**
 * Incident number pattern (FENZ sitrep).
 * Matches #F1234567 or F1234567 (F followed by 6+ digits).
 */
const INCIDENT_PATTERN = /#?(F\d{6,})\b/;

/**
 * Clean control character tags from multimon-ng output.
 * Strips <ETX>, <EOT>, <STX>, <NUL>, etc. and fixes character mappings.
 * Also strips FLEX multipart frame markers: "(Part X of Y)" mid-content,
 * incomplete "(Part" at end, and orphaned "X)" or "X of Y)" at start.
 */
function cleanContent(content) {
  if (!content) return '';
  content = content
    .replace(/<[A-Za-z]{2,4}>/g, '')  // Strip <ETX>, <EOT>, <STX>, <NUL>, etc.
    .replace(/Ä/g, '[')               // Multimon-ng maps [ to Ä
    .replace(/Ü/g, ']');              // Multimon-ng maps ] to Ü

  // Strip FLEX multipart frame markers inserted by multimon-ng
  // Complete markers within content: "(Part 1 of 2)" or "(Part 2)"
  content = content.replace(/\(Part\s+\d+\s*(?:of\s*\d+\s*)?\)/gi, '');
  // Incomplete marker at end: "(Part 1 of" or "(Part" (frame got cut off)
  content = content.replace(/\(Part\s*(?:\d+\s*(?:of\s*\d*\s*)?)?\s*$/gi, '');
  // Orphaned continuation at start: "2)" or "1 of 2)" from previous frame
  content = content.replace(/^\s*\d+\s*(?:of\s*\d+\s*)?\)\s*/i, '');

  return content.trim();
}

/**
 * Extract NZ ambulance call type from AMPDS dispatch format.
 * Format: "<UNIT> <COLOR> <LEVEL> <AMPDS_CODE> <CALL_TYPE> [- suffix] ; Flat/Unit: ..."
 * e.g. "ECHO12 RED 1 13C01 DIABETIC NOT ALERT ; Flat/Unit: /1021 PEAK RD"
 *      "WEST2 ORANGE 2 RESP5 TIME SENSITIVE - E ; Flat/Unit: /20 BARRYS RD"
 *      "BKBLFRU GREEN 1 35B01 ACUTE ADMISSION ; Flat/Unit: /7 HILTON ST"
 */
function detectAmboCallType(content) {
  if (!content) return null;
  // Match priority colour + level + AMPDS code, then extract the call type text
  const m = content.match(
    /(?:PURPLE|RED|ORANGE|GREEN)\s+\d+\s+\w+\s+(.+?)(?:\s*[-;]|\s+Flat\/Unit:|\s*$)/i
  );
  if (!m) return null;
  const candidate = m[1].trim().toUpperCase();
  // Check against known ambo call types (longest first to match most specific)
  for (const type of AMBO_CALL_TYPES) {
    if (candidate.startsWith(type)) return type;
  }
  // If the candidate text is reasonable length, use it as-is
  if (candidate.length >= 3 && candidate.length <= 30) return candidate;
  return null;
}

/**
 * Detect call type from message content.
 * Tries ambo format extraction first, then falls back to keyword patterns.
 */
function detectCallType(content) {
  if (!content) return null;
  // Try NZ ambulance AMPDS format extraction
  const amboType = detectAmboCallType(content);
  if (amboType) return amboType;
  // Fall back to keyword pattern matching (fire codes, generic types)
  for (const { pattern, type } of CALL_TYPE_PATTERNS) {
    if (pattern.test(content)) return type;
  }
  return null;
}

// ── Call type colour map (server-side, matches frontend CALL_TYPE_COLOURS) ──
const CALL_TYPE_COLOUR_MAP = {
  // Cardiac / critical
  'ARREST': '#dc2626', 'CARDIAC PROBLEM': '#dc2626', 'CHEST PAIN': '#dc2626',
  'HEART PROBLEM': '#dc2626', 'RESPIRATORY ARREST': '#dc2626',
  // Breathing
  'ABNORMAL BREATHING': '#16a34a', 'DIFFICULTY BREATHING': '#16a34a',
  'INEFFECTIVE BREATHING': '#16a34a', 'CHOKING': '#16a34a',
  // Neurological
  'STROKE': '#9333ea', 'SEIZURE': '#9333ea', 'FITTING': '#9333ea',
  'ALTERED LOC': '#9333ea', 'UNCONSCIOUS': '#9333ea',
  'PARALYSIS': '#9333ea', 'WEAKNESS/NUMBNESS': '#9333ea',
  // Trauma
  'TRAUMA': '#7c3aed', 'FALL': '#7c3aed', 'MVA': '#7c3aed',
  'ASSAULT': '#7c3aed', 'STAB/GSW': '#7c3aed',
  'BURNS': '#ea580c', 'EYE INJURY': '#ea580c', 'BITE/ATTACK': '#ea580c',
  // Medical general
  'SICK PERSON': '#2563eb', 'ABDO PAIN': '#2563eb', 'BACK PAIN': '#2563eb',
  'PAIN': '#2563eb', 'DIABETIC': '#2563eb', 'ALLERGY': '#2563eb',
  'FAINT': '#2563eb', 'HEADACHE': '#2563eb', 'FEVER/CHILLS': '#2563eb',
  'NAUSEA': '#2563eb', 'VOMITING': '#2563eb', 'DIZZINESS/VERTIGO': '#2563eb',
  // Bleeding
  'HAEMORRHAGE': '#b91c1c', 'SERIOUS HAEMORRHAGE': '#991b1b',
  // Obstetric
  'OBSTETRIC': '#db2777',
  // Hazard
  'CO/INH/HAZ': '#ca8a04', 'ELECTROCUTION': '#ca8a04', 'HEAT EXPOSURE': '#ca8a04',
  // Water
  'DROWNING': '#0284c7', 'NEAR DROWNING': '#0284c7',
  // Mental health
  'PSYCH/SUICIDE': '#475569', 'SUICIDAL IDEATION': '#475569', 'INTENDING SUICIDE': '#475569',
  // Other
  'COMMUNITY ALARM': '#64748b', 'UNKNOWN PROBLEM': '#6b7280',
  'ACCIDENT': '#6366f1', 'ACUTE ADMISSION': '#0ea5e9',
  'OVERDOSE': '#8b5cf6', 'POISONING': '#8b5cf6',
  // FENZ fire codes
  'FIREALM': '#f59e0b', 'STRU': '#dc2626', 'VEG': '#ea580c',
  'MVC': '#7c3aed', 'MVCRESC': '#7c3aed', 'MVCHEVY': '#7c3aed',
  'HAZ': '#ca8a04', 'HAZGAS': '#ca8a04', 'MED': '#16a34a',
  'MEDFR': '#16a34a', 'MIN': '#2563eb', 'RESC': '#0891b2',
  'WATRESC': '#0284c7', 'USAR': '#dc2626', 'SPRNKLR': '#64748b',
  'NAT1': '#0284c7', 'NAT2': '#0284c7', 'NAT3': '#0284c7',
  'SHIP': '#0284c7', 'ADV': '#f59e0b', 'EXERCISE': '#9ca3af',
  'FIRETEST': '#9ca3af', 'STNCALL': '#64748b', 'TRA': '#7c3aed',
  'TEST': '#9ca3af',
};

/**
 * Get colour for a call type.
 */
function getCallTypeColour(callType) {
  if (!callType) return '#6b7280';
  return CALL_TYPE_COLOUR_MAP[callType] || '#6b7280';
}

/**
 * Extract location from message content.
 */
function extractLocation(content) {
  if (!content) return null;
  for (const pattern of LOCATION_PATTERNS) {
    const match = content.match(pattern);
    if (match && match[1]) return match[1].trim();
  }
  return null;
}

/**
 * Extract FENZ incident number from message content.
 * e.g. #F4403574 → F4403574
 */
function extractIncidentNumber(content) {
  if (!content) return null;
  const m = content.match(INCIDENT_PATTERN);
  return m ? m[1] : null;
}

/**
 * Extract truck/unit identifiers from message content.
 * Handles:
 *   - Parenthesized list at start: (TAUP217, RFOTLL, RFOMFM1)
 *   - Individual codes: letters+digits like TAUP217, RFOMFM1
 */
function extractTrucks(content) {
  if (!content) return null;

  // Pattern 1: Parenthesized list at start of message
  const parenMatch = content.match(/^\(([^)]+)\)/);
  if (parenMatch) {
    return parenMatch[1].split(/,\s*/).map(s => s.trim()).filter(Boolean).join(', ');
  }

  // Pattern 2: Individual truck codes (3+ letters followed by 1-4 digits)
  const codePattern = /\b([A-Z]{3,}\d{1,4})\b/g;
  const exclude = /^(MIN|SH|RED|RESP|EOT|ETX|STX|POCSAG|FLEX)\d/i;
  const matches = [];
  let m;
  while ((m = codePattern.exec(content)) !== null) {
    const code = m[1];
    // Skip incident numbers (F followed by 6+ digits)
    if (/^F\d{6,}$/.test(code)) continue;
    // Skip known non-truck prefixes
    if (exclude.test(code)) continue;
    matches.push(code);
  }
  return matches.length > 0 ? matches.join(', ') : null;
}

/**
 * Extract NZ ambulance/fire priority colour from message content.
 * Ambo pages typically start with a truck code then the priority colour:
 *   A1WAIK RED 1 RESPAIHT ...
 * Priority colours: PURPLE (life threatening), RED (serious), ORANGE (urgent), GREEN (non-urgent)
 */
function extractPriority(content) {
  if (!content) return null;
  const m = content.match(/\b(PURPLE|RED|ORANGE|GREEN)\s+\d/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Normalize a capcode by stripping leading zeros.
 * Ensures FLEX (e.g. 0001234567) and POCSAG (e.g. 1234567) match consistently.
 */
function normalizeCapcode(capcode) {
  if (!capcode) return '';
  const stripped = capcode.replace(/^0+/, '');
  return stripped || '0';
}

/**
 * Extract alarm level from message content.
 * NZ Fire multi-alarm fires: "2ND ALARM", "SECOND ALARM", "TX 2ND", etc.
 * Returns the alarm level number (2-5+) or null.
 */
function extractAlarmLevel(content) {
  if (!content) return null;
  // Check highest level first so we return the max
  if (/\b(?:5TH|FIFTH)\s*ALARM\b|\bTX\s+(?:5TH|FIFTH)\b/i.test(content)) return 5;
  if (/\b(?:4TH|FOURTH)\s*ALARM\b|\bTX\s+(?:4TH|FOURTH)\b/i.test(content)) return 4;
  if (/\b(?:3RD|THIRD)\s*ALARM\b|\bTX\s+(?:3RD|THIRD)\b/i.test(content)) return 3;
  if (/\b(?:2ND|SECOND)\s*ALARM\b|\bTX\s+(?:2ND|SECOND)\b/i.test(content)) return 2;
  return null;
}

/**
 * Generate a dedup hash for a message.
 */
function dedupeHash(capcode, content) {
  return crypto
    .createHash('sha256')
    .update(`${capcode}:${(content || '').trim().toLowerCase()}`)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Check if a message is a duplicate within the dedup window.
 */
function isDuplicate(db, hash) {
  const windowStart = new Date(Date.now() - config.DEDUP_WINDOW_MS).toISOString();
  const existing = db
    .prepare('SELECT id FROM messages WHERE hash = ? AND received_at > ?')
    .get(hash, windowStart);
  return !!existing;
}

/**
 * Multipart message buffer.
 * Key: capcode, Value: { parts: [], timer: timeout, firstReceived: Date }
 */
const multipartBuffer = new Map();

/**
 * Detect if a message is part of a multipart sequence.
 * Common patterns: "1/3", "(1 of 3)", "PART 1", "[1/3]"
 */
function parseMultipart(content) {
  if (!content) return null;
  const patterns = [
    /\(?\s*(\d+)\s*(?:\/|of)\s*(\d+)\s*\)?/i,
    /\bPART\s*(\d+)\s*(?:\/|of)\s*(\d+)/i,
    /\[(\d+)\/(\d+)\]/i,
  ];
  for (const p of patterns) {
    const m = content.match(p);
    if (m) {
      const part = parseInt(m[1], 10);
      const total = parseInt(m[2], 10);
      if (part > 0 && total > 1 && part <= total) {
        // Strip the multipart indicator from content
        const cleaned = content.replace(m[0], '').trim();
        return { part, total, cleaned };
      }
    }
  }
  return null;
}

/**
 * Process a multipart message. Returns the joined message when complete, or null if still waiting.
 */
function handleMultipart(capcode, content, onComplete) {
  const mp = parseMultipart(content);
  if (!mp) return null; // Not multipart

  const key = capcode;
  let entry = multipartBuffer.get(key);

  if (!entry || entry.total !== mp.total) {
    // New multipart sequence
    entry = {
      parts: new Array(mp.total).fill(null),
      total: mp.total,
      timer: null,
      firstReceived: new Date(),
    };
    multipartBuffer.set(key, entry);
  }

  entry.parts[mp.part - 1] = mp.cleaned;

  // Clear existing timer
  if (entry.timer) clearTimeout(entry.timer);

  // Check if complete
  const received = entry.parts.filter((p) => p !== null).length;
  if (received === entry.total) {
    multipartBuffer.delete(key);
    const joined = entry.parts.join(' ');
    return { joined, isComplete: true };
  }

  // Set timeout to flush partial message
  entry.timer = setTimeout(() => {
    const partial = entry.parts.filter((p) => p !== null).join(' ');
    multipartBuffer.delete(key);
    if (onComplete) onComplete(capcode, partial, true);
  }, config.MULTIPART_TIMEOUT_MS);

  return { joined: null, isComplete: false };
}

/**
 * Parse a raw line from multimon-ng output.
 * Formats:
 *   POCSAG512:  Address: 1234567  Function: 0  Alpha:   Some message
 *   POCSAG1200: Address: 1234567  Function: 2  Alpha:   Some message
 *   FLEX|timestamp|1600/2/K/A|frame|capcode|ALN|Message text  (7-field pipe)
 *   FLEX: timestamp 1600/2/K/A frame [capcode] ALN Message    (bracket style)
 *   FLEX|timestamp|1600|ALN|frame|capcode|Message text         (6-field pipe)
 */
function parseMultimonLine(line) {
  if (!line || typeof line !== 'string') return null;
  line = line.trim();

  // Strip syslog/timestamp prefix if present
  // e.g., "Dec 31 23:47:50 host ... [quality...] FLEX|..."
  const protoMatch = line.match(/(FLEX[|:]|POCSAG\d*:)/i);
  if (protoMatch && protoMatch.index > 0) {
    line = line.substring(protoMatch.index);
  }

  // POCSAG format
  const pocsagMatch = line.match(
    /^(POCSAG)(\d+):\s*Address:\s*(\d+)\s*Function:\s*(\d+)\s*(?:Alpha|Numeric|Tone):\s*(.*)/i
  );
  if (pocsagMatch) {
    return {
      protocol: 'POCSAG',
      bitrate: parseInt(pocsagMatch[2], 10),
      capcode: pocsagMatch[3],
      function_code: parseInt(pocsagMatch[4], 10),
      content: cleanContent(pocsagMatch[5]),
      raw: line,
    };
  }

  // POCSAG tone-only (no Alpha/Numeric/Tone content section)
  // POCSAG1200: Address:  586505  Function: 0
  const pocsagTone = line.match(
    /^(POCSAG)(\d+):\s*Address:\s*(\d+)\s*Function:\s*(\d+)\s*$/i
  );
  if (pocsagTone) {
    return {
      protocol: 'POCSAG',
      bitrate: parseInt(pocsagTone[2], 10),
      capcode: pocsagTone[3],
      function_code: parseInt(pocsagTone[4], 10),
      content: '[Tone]',
      raw: line,
    };
  }

  // FLEX format: 7-field pipe-delimited (standard multimon-ng FLEX output)
  // FLEX|2026-02-17 17:52:07|1600/2/K/A|13.013|001234567|ALN|Message text
  const flex7 = line.match(
    /^FLEX\|([^|]+)\|(\d+)\/[^|]*\|[^|]+\|(\d+)\|(\w+)\|(.*)/i
  );
  if (flex7) {
    const content = cleanContent(flex7[5]);
    if (!content) return null;
    return {
      protocol: 'FLEX',
      bitrate: parseInt(flex7[2], 10),
      capcode: flex7[3].replace(/^0+(\d)/, '$1'),
      function_code: 0,
      content,
      raw: line,
    };
  }

  // FLEX format: bracket style
  // FLEX: 2025-02-17 12:34:56 1600/2/K/A 07.041 [0001234567] ALN Message text
  const flexBracket = line.match(
    /^FLEX[:|]\s*(?:[\d-]+\s+[\d:]+\s+)?(\d+)\/\d+\/\w\/.\s+[\d.]+\s+\[(\d+)\]\s+(\w{3})\s+(.*)/i
  );
  if (flexBracket) {
    const content = cleanContent(flexBracket[4]);
    if (!content) return null;
    return {
      protocol: 'FLEX',
      bitrate: parseInt(flexBracket[1], 10),
      capcode: flexBracket[2].replace(/^0+(\d)/, '$1'),
      function_code: 0,
      content,
      raw: line,
    };
  }

  // FLEX format: 6-field pipe-delimited (alternative tools)
  // FLEX|timestamp|1600|ALN|07.041|1234567|Message text
  const flex6 = line.match(
    /^FLEX[:|]\s*([^|]+)\|(\d+)\|(\w+)\|([^|]+)\|(\d+)\|(.*)/i
  );
  if (flex6) {
    const content = cleanContent(flex6[6]);
    if (!content) return null;
    return {
      protocol: 'FLEX',
      bitrate: parseInt(flex6[2], 10),
      capcode: flex6[5].replace(/^0+(\d)/, '$1'),
      function_code: 0,
      content,
      raw: line,
    };
  }

  // FLEX simpler fallback
  const flexSimple = line.match(/^FLEX[:|]\s*.*?\|.*?\|(\d+)\|(.*)/i);
  if (flexSimple) {
    const content = cleanContent(flexSimple[2]);
    if (!content) return null;
    return {
      protocol: 'FLEX',
      bitrate: null,
      capcode: flexSimple[1].replace(/^0+(\d)/, '$1'),
      function_code: 0,
      content,
      raw: line,
    };
  }

  return null;
}

/**
 * Fully process a parsed message: detect call type, location, trucks, dedup.
 */
function enrichMessage(parsed) {
  if (!parsed) return null;
  // Clean control chars from content before enriching
  const content = cleanContent(parsed.content);
  return {
    ...parsed,
    content,
    call_type: detectCallType(content),
    location: extractLocation(content),
    trucks: extractTrucks(content),
    incident_number: extractIncidentNumber(content),
    priority: extractPriority(content),
    hash: dedupeHash(parsed.capcode, content),
  };
}

module.exports = {
  CALL_TYPE_PATTERNS,
  cleanContent,
  detectCallType,
  getCallTypeColour,
  extractLocation,
  extractTrucks,
  extractIncidentNumber,
  extractPriority,
  extractAlarmLevel,
  normalizeCapcode,
  dedupeHash,
  isDuplicate,
  parseMultipart,
  handleMultipart,
  parseMultimonLine,
  enrichMessage,
};
