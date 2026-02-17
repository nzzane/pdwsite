const crypto = require('crypto');
const config = require('./config');

/**
 * NZ Fire/Ambulance pager call type detection patterns.
 * Maps keywords/patterns found in pager messages to call types.
 */
const CALL_TYPE_PATTERNS = [
  { pattern: /\bSTRUCTURE\s*FIRE\b/i, type: 'STRUCTURE FIRE', colour: '#dc2626' },
  { pattern: /\bVEGETATION\s*FIRE\b/i, type: 'VEGETATION FIRE', colour: '#ea580c' },
  { pattern: /\bRUBBISH\s*FIRE\b/i, type: 'RUBBISH FIRE', colour: '#f59e0b' },
  { pattern: /\bVEHICLE\s*FIRE\b/i, type: 'VEHICLE FIRE', colour: '#dc2626' },
  { pattern: /\bCHIMNEY\s*FIRE\b/i, type: 'CHIMNEY FIRE', colour: '#ea580c' },
  { pattern: /\bMVC\b|\bMVA\b|\bCRASH\b/i, type: 'MVC', colour: '#7c3aed' },
  { pattern: /\bMIN\b/i, type: 'MIN', colour: '#2563eb' },
  { pattern: /\bRESCUE\b/i, type: 'RESCUE', colour: '#0891b2' },
  { pattern: /\bHAZMAT\b|\bHAZ\s*MAT\b/i, type: 'HAZMAT', colour: '#ca8a04' },
  { pattern: /\bMEDICAL\b|\bAMBO\b|\bAMBULANCE\b/i, type: 'AMBO', colour: '#16a34a' },
  { pattern: /\bCARDIAC\b/i, type: 'CARDIAC', colour: '#dc2626' },
  { pattern: /\bBREATHING\b/i, type: 'BREATHING', colour: '#16a34a' },
  { pattern: /\bTRAUMA\b/i, type: 'TRAUMA', colour: '#9333ea' },
  { pattern: /\bALARM\s*(?:ACTIVATION|ACT)\b/i, type: 'ALARM', colour: '#64748b' },
  { pattern: /\bSPECIAL\s*SERVICE\b/i, type: 'SPECIAL SERVICE', colour: '#0284c7' },
  { pattern: /\bASSIST\b/i, type: 'ASSIST', colour: '#6366f1' },
  { pattern: /\bTEST\s*(?:PAGE|MSG|CALL)?\b/i, type: 'TEST', colour: '#9ca3af' },
  { pattern: /\bPROW?LER\b/i, type: 'PROWLER', colour: '#475569' },
  { pattern: /\bFLOOD(?:ING)?\b/i, type: 'FLOODING', colour: '#0ea5e9' },
  { pattern: /\bSLIP\b/i, type: 'SLIP', colour: '#78716c' },
  { pattern: /\bLIFT\s*RESCUE\b/i, type: 'LIFT RESCUE', colour: '#0891b2' },
  { pattern: /\bWATER\s*RESCUE\b/i, type: 'WATER RESCUE', colour: '#0284c7' },
  { pattern: /\bRURAL\s*FIRE\b/i, type: 'RURAL FIRE', colour: '#ea580c' },
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
 */
function cleanContent(content) {
  if (!content) return '';
  return content
    .replace(/<[A-Za-z]{2,4}>/g, '')  // Strip <ETX>, <EOT>, <STX>, <NUL>, etc.
    .replace(/Ä/g, '[')               // Multimon-ng maps [ to Ä
    .replace(/Ü/g, ']')               // Multimon-ng maps ] to Ü
    .trim();
}

/**
 * Detect call type from message content.
 */
function detectCallType(content) {
  if (!content) return null;
  for (const { pattern, type } of CALL_TYPE_PATTERNS) {
    if (pattern.test(content)) return type;
  }
  return null;
}

/**
 * Get colour for a call type.
 */
function getCallTypeColour(callType) {
  if (!callType) return '#6b7280';
  const entry = CALL_TYPE_PATTERNS.find((p) => p.type === callType);
  return entry ? entry.colour : '#6b7280';
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
 *   FLEX: ...
 *   FLEX|xxxx/xx/xx xx:xx:xx|1600|ALN|x.x.x|xxxxxxx|Some message
 */
function parseMultimonLine(line) {
  if (!line || typeof line !== 'string') return null;
  line = line.trim();

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

  // FLEX format: bracket style (most common multimon-ng FLEX output)
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
      capcode: flexBracket[2].replace(/^0+(\d)/, '$1'), // Strip leading zeros
      function_code: 0,
      content,
      raw: line,
    };
  }

  // FLEX format (pipe-delimited)
  // FLEX|timestamp|1600|ALN|07.041|1234567|Message text
  const flexMatch = line.match(
    /^FLEX[:|]\s*(.+?)\|(\d+)\|(\w+)\|([^|]+)\|(\d+)\|(.*)/i
  );
  if (flexMatch) {
    const content = cleanContent(flexMatch[6]);
    if (!content) return null;
    return {
      protocol: 'FLEX',
      bitrate: parseInt(flexMatch[2], 10),
      capcode: flexMatch[5],
      function_code: 0,
      content,
      raw: line,
    };
  }

  // FLEX simpler fallback
  const flexSimple = line.match(/^FLEX:\s*.*?\|.*?\|(\d+)\|(.*)/i);
  if (flexSimple) {
    const content = cleanContent(flexSimple[2]);
    if (!content) return null;
    return {
      protocol: 'FLEX',
      bitrate: null,
      capcode: flexSimple[1],
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
  dedupeHash,
  isDuplicate,
  parseMultipart,
  handleMultipart,
  parseMultimonLine,
  enrichMessage,
};
