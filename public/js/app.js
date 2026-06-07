/* ─── PDW Monitor Frontend ─── */
(function () {
  'use strict';

  // ─── State ───
  const state = {
    token: localStorage.getItem('pdw_token'),
    user: null,
    ws: null,
    wsReconnectTimer: null,
    wsReconnectDelay: 1000,
    wsPingInterval: null,
    timeAgoInterval: null,
    autoRefreshInterval: null,
    messages: [],
    maxLiveMessages: 500,
    paused: false,
    autoScroll: true,
    currentView: 'live',
    currentAdminTab: 'groups',
    groups: [],
    favourites: [],
    aliases: {},
    callTypes: [],
    filters: [],
    keywordAlerts: [],
    searchPage: 0,
    searchLimit: 50,
    livePage: 0,
    liveLimit: 100,
    liveTotalCount: 0,
    alarmLevelSetting: null, // null = off, 2-5 = minimum alarm level
    alarmLevelGroups: [], // group IDs for alarm level scoping (empty = all/nationwide)
    preferences: { default_view: 'live', default_group_id: null, default_keyword: null, default_region: null },
    silencedCapcodes: [],
    notifTab: 'settings', // 'settings', 'history', or 'display'
    pendingMessageId: null, // messageId to scroll to after load (from notification click)
    regions: [], // NZ regions with search terms for location filtering
    streetSuffixes: [], // Street type suffixes for filtering out street names from region matches
  };

  // ─── Call type categories ───
  const FIRE_TYPES = [
    'ADV', 'EXERCISE', 'FIREALM', 'FIRETEST', 'HAZ', 'HAZGAS',
    'MED', 'MEDFR', 'MIN', 'NAT1', 'NAT2', 'NAT3', 'STRU',
    'MVC', 'STNCALL', 'MVCHEVY', 'MVCRESC', 'RESC', 'SHIP',
    'SPRNKLR', 'VEG', 'TRA', 'USAR', 'WATRESC'
  ];
  const AMBO_TYPES = [
    'ABDO PAIN', 'ABNORMAL BREATHING', 'ACCIDENT', 'ACUTE ADMISSION',
    'ALLERGY', 'ALTERED LOC', 'ARREST', 'ASSAULT', 'BACK PAIN',
    'BITE/ATTACK', 'BURNS', 'CARDIAC PROBLEM', 'CHEST PAIN', 'CHOKING',
    'CO/INH/HAZ', 'COMMUNITY ALARM', 'DIABETIC', 'DIFFICULTY BREATHING',
    'DIZZINESS/VERTIGO', 'DROWNING', 'ELECTROCUTION', 'EYE INJURY',
    'FAINT', 'FALL', 'FEVER/CHILLS', 'FITTING', 'HAEMORRHAGE',
    'HEADACHE', 'HEART PROBLEM', 'HEAT EXPOSURE', 'IMPENDING FIT',
    'INEFFECTIVE BREATHING', 'INTENDING SUICIDE', 'MVA', 'NAUSEA',
    'NEAR DROWNING', 'OBSTETRIC', 'OVERDOSE', 'PAIN', 'PARALYSIS',
    'POISONING', 'PSYCH/SUICIDE', 'RESPIRATORY ARREST', 'SEIZURE',
    'SERIOUS HAEMORRHAGE', 'SICK PERSON', 'STAB/GSW', 'STROKE',
    'SUICIDAL IDEATION', 'TRAUMA', 'UNCONSCIOUS', 'UNKNOWN PROBLEM',
    'VOMITING', 'WEAKNESS/NUMBNESS'
  ];

  // ─── Call type colours ───
  const CALL_TYPE_COLOURS = {
    // Cardiac / critical
    'ARREST': '#dc2626', 'CARDIAC PROBLEM': '#dc2626',
    'CHEST PAIN': '#dc2626', 'HEART PROBLEM': '#dc2626',
    'RESPIRATORY ARREST': '#dc2626',
    // Breathing / respiratory
    'ABNORMAL BREATHING': '#16a34a', 'DIFFICULTY BREATHING': '#16a34a',
    'INEFFECTIVE BREATHING': '#16a34a', 'CHOKING': '#16a34a',
    // Neurological
    'STROKE': '#9333ea', 'SEIZURE': '#9333ea', 'FITTING': '#9333ea',
    'ALTERED LOC': '#9333ea', 'UNCONSCIOUS': '#9333ea',
    'PARALYSIS': '#9333ea', 'WEAKNESS/NUMBNESS': '#9333ea',
    // Trauma / injury
    'TRAUMA': '#7c3aed', 'FALL': '#7c3aed', 'MVA': '#7c3aed',
    'ASSAULT': '#7c3aed', 'STAB/GSW': '#7c3aed',
    'BURNS': '#ea580c', 'EYE INJURY': '#ea580c', 'BITE/ATTACK': '#ea580c',
    // Medical general
    'SICK PERSON': '#2563eb', 'ABDO PAIN': '#2563eb', 'BACK PAIN': '#2563eb',
    'PAIN': '#2563eb', 'FEVER/CHILLS': '#2563eb', 'NAUSEA': '#2563eb',
    'VOMITING': '#2563eb', 'DIABETIC': '#2563eb', 'ALLERGY': '#2563eb',
    'HEADACHE': '#2563eb', 'DIZZINESS/VERTIGO': '#2563eb', 'FAINT': '#2563eb',
    // Bleeding
    'HAEMORRHAGE': '#b91c1c', 'SERIOUS HAEMORRHAGE': '#991b1b',
    // Obstetric
    'OBSTETRIC': '#db2777',
    // Hazard / environment
    'CO/INH/HAZ': '#ca8a04', 'ELECTROCUTION': '#ca8a04', 'HEAT EXPOSURE': '#ca8a04',
    // Water incidents
    'DROWNING': '#0284c7', 'NEAR DROWNING': '#0284c7',
    // Mental health
    'PSYCH/SUICIDE': '#475569', 'SUICIDAL IDEATION': '#475569',
    'INTENDING SUICIDE': '#475569',
    // Other / system
    'COMMUNITY ALARM': '#64748b', 'UNKNOWN PROBLEM': '#6b7280',
    'ACCIDENT': '#6366f1', 'ACUTE ADMISSION': '#0ea5e9',
    'OVERDOSE': '#8b5cf6', 'POISONING': '#8b5cf6',
    // Fire types (FENZ codes)
    'FIREALM': '#f59e0b', 'STRU': '#dc2626', 'VEG': '#ea580c',
    'MVC': '#7c3aed', 'MVCRESC': '#7c3aed', 'MVCHEVY': '#7c3aed',
    'HAZ': '#ca8a04', 'HAZGAS': '#ca8a04', 'MED': '#16a34a',
    'MEDFR': '#16a34a', 'MIN': '#2563eb', 'RESC': '#0891b2',
    'WATRESC': '#0284c7', 'USAR': '#dc2626', 'SPRNKLR': '#64748b',
    'NAT1': '#0284c7', 'NAT2': '#0284c7', 'NAT3': '#0284c7',
    'SHIP': '#0284c7', 'ADV': '#f59e0b', 'EXERCISE': '#9ca3af',
    'FIRETEST': '#9ca3af', 'STNCALL': '#64748b', 'TRA': '#7c3aed',
    'MISC': '#64748b',
  };

  // ─── DOM refs ───
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ─── API helper ───
  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
    const res = await fetch(path, { ...opts, headers: { ...headers, ...opts.headers } });
    if (res.status === 401) {
      logout();
      throw new Error('Session expired');
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // ─── IDB token sync for SW (pushsubscriptionchange needs JWT) ───
  function storeTokenForSW(token) {
    try {
      const req = indexedDB.open('pdw-auth', 1);
      req.onupgradeneeded = (e) => e.target.result.createObjectStore('tokens');
      req.onsuccess = (e) => {
        try {
          const tx = e.target.result.transaction('tokens', 'readwrite');
          if (token) { tx.objectStore('tokens').put(token, 'jwt'); }
          else { tx.objectStore('tokens').delete('jwt'); }
        } catch {}
      };
    } catch {}
  }

  // ─── Silent JWT refresh (called on app open; refreshes if <14d left) ───
  async function silentTokenRefresh() {
    try {
      if (!state.token) return;
      const parts = state.token.split('.');
      if (parts.length !== 3) return;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (!payload.exp) return;
      const msLeft = payload.exp * 1000 - Date.now();
      if (msLeft > 14 * 24 * 60 * 60 * 1000) return;
      const data = await api('/api/auth/refresh', { method: 'POST' });
      state.token = data.token;
      localStorage.setItem('pdw_token', data.token);
      storeTokenForSW(data.token);
    } catch { /* keep existing token */ }
  }

  // ─── Toast notifications ───
  function toast(msg, type = 'info') {
    let container = $('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => { el.remove(); }, 4000);
  }

  // ─── Time formatting ───
  function timeAgo(dateStr) {
    const d = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
    const now = Date.now();
    const diff = Math.floor((now - d.getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString();
  }

  function formatTime(dateStr) {
    const d = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function formatDateTime(dateStr) {
    const d = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
    return d.toLocaleString();
  }

  // ─── HTML escaping ───
  function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Extract incident/F-number from content ───
  function extractIncidentNumber(content) {
    if (!content) return null;
    const m = content.match(/#?(F\d{6,})\b/);
    return m ? m[1] : null;
  }

  // ─── Strip trucks from content for display ───
  function contentWithoutTrucks(content, trucks) {
    if (!content || !trucks) return content;
    // If content starts with parenthesized list, strip it
    const parenMatch = content.match(/^\([^)]+\)\s*/);
    if (parenMatch) return content.slice(parenMatch[0].length);
    return content;
  }

  // ─── Normalize capcode (strip leading zeros) ───
  function normalizeCapcode(cap) {
    if (!cap) return '';
    const stripped = cap.replace(/^0+/, '');
    return stripped || '0';
  }

  // ─── In-app notification sound (works on Safari and all browsers) ───
  let audioCtx = null;
  function playAlertSound() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.3;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
      osc.stop(audioCtx.currentTime + 0.5);
    } catch { /* Audio not available */ }
  }

  // ─── Check if message matches favourited groups or keyword alerts ───
  function checkInAppAlert(msg) {
    const normCap = normalizeCapcode(msg.capcode);
    let matched = false;
    let matchReason = '';

    // Check favourited groups (capcodes + keywords)
    for (const fav of state.favourites) {
      const group = state.groups.find(g => g.id === fav.group_id);
      if (!group) continue;
      // Check capcode members
      if (group.members) {
        const caps = group.members.map(m => normalizeCapcode(m.capcode));
        if (caps.includes(normCap)) {
          matched = true;
          matchReason = fav.group_name;
          break;
        }
      }
      // Check group keywords
      if (group.keywords && group.keywords.length > 0) {
        const content = (msg.content || '').toLowerCase();
        if (group.keywords.some(kw => content.includes(kw.keyword.toLowerCase()))) {
          matched = true;
          matchReason = fav.group_name;
          break;
        }
      }
    }

    // Check keyword alerts (with optional group scoping)
    if (!matched) {
      const content = (msg.content || '').toLowerCase();
      const normCap = normalizeCapcode(msg.capcode);
      for (const ka of state.keywordAlerts) {
        if (!content.includes(ka.keyword.toLowerCase())) continue;
        // If scoped to a group, check message belongs to that group
        if (ka.group_id) {
          const group = state.groups.find(g => g.id === ka.group_id);
          if (group) {
            let inGroup = false;
            if (group.members) inGroup = group.members.some(m => normalizeCapcode(m.capcode) === normCap);
            if (!inGroup && group.keywords) inGroup = group.keywords.some(kw => content.includes(kw.keyword.toLowerCase()));
            if (!inGroup) continue;
          }
        }
        matched = true;
        matchReason = 'Keyword: ' + ka.keyword;
        break;
      }
    }

    // Check alarm level alerts
    if (!matched && state.alarmLevelSetting) {
      const alarmLevel = msg.alarm_level || extractAlarmLevel(msg.content);
      if (alarmLevel && alarmLevel >= state.alarmLevelSetting) {
        // If user has scoped alarm alerts to specific groups, check membership
        let alarmGroupMatch = true;
        if (state.alarmLevelGroups && state.alarmLevelGroups.length > 0) {
          alarmGroupMatch = false;
          const normCap2 = normalizeCapcode(msg.capcode);
          const msgContent = (msg.content || '').toLowerCase();
          for (const gid of state.alarmLevelGroups) {
            const group = state.groups.find(g => g.id === gid);
            if (!group) continue;
            if (group.members && group.members.some(m => normalizeCapcode(m.capcode) === normCap2)) { alarmGroupMatch = true; break; }
            if (group.keywords && group.keywords.some(kw => msgContent.includes(kw.keyword.toLowerCase()))) { alarmGroupMatch = true; break; }
          }
        }
        if (alarmGroupMatch) {
          matched = true;
          const ordinal = alarmLevel === 2 ? '2nd' : alarmLevel === 3 ? '3rd' : `${alarmLevel}th`;
          matchReason = `${ordinal} Alarm`;
        }
      }
    }

    if (matched) {
      playAlertSound();
      toast(`Alert [${matchReason}]: ${(msg.content || '').substring(0, 100)}`, 'info');
    }
  }

  // ─── Extract priority colour from ambo/fire pages ───
  function extractPriorityFromContent(content) {
    if (!content) return null;
    const m = content.match(/\b(PURPLE|RED|ORANGE|GREEN)\s+\d/i);
    return m ? m[1].toUpperCase() : null;
  }

  // ─── Extract alarm level (multi-alarm fires) ───
  function extractAlarmLevel(content) {
    if (!content) return null;
    if (/\b(?:5TH|FIFTH)\s*ALARM\b|\bTX\s+(?:5TH|FIFTH)\b/i.test(content)) return 5;
    if (/\b(?:4TH|FOURTH)\s*ALARM\b|\bTX\s+(?:4TH|FOURTH)\b/i.test(content)) return 4;
    if (/\b(?:3RD|THIRD)\s*ALARM\b|\bTX\s+(?:3RD|THIRD)\b/i.test(content)) return 3;
    if (/\b(?:2ND|SECOND)\s*ALARM\b|\bTX\s+(?:2ND|SECOND)\b/i.test(content)) return 2;
    return null;
  }

  // ─── Render a message card ───
  function renderMessageCard(msg) {
    const colour = msg.call_type ? (CALL_TYPE_COLOURS[msg.call_type] || '#6b7280') : (msg.alias_colour || '#6b7280');
    const normCap = normalizeCapcode(msg.capcode);
    const aliasObj = state.aliases[normCap] || state.aliases[msg.capcode];
    const aliasName = msg.alias || (aliasObj ? aliasObj.alias : null);
    const aliasColour = aliasObj ? aliasObj.colour : (msg.alias_colour || colour);
    const aliasNotes = msg.alias_notes || (aliasObj ? aliasObj.notes : null);
    const isAdmin = state.user && state.user.role === 'admin';

    // Check if this capcode is hidden
    const isHidden = aliasObj && aliasObj.hidden;
    // Check if this is a status/CAD message
    const isStatus = isStatusMessage(msg.content, msg.call_type);

    const card = document.createElement('div');
    card.className = 'msg-card highlight';
    if (isHidden) card.classList.add('msg-hidden');
    if (isStatus) card.classList.add('msg-status');
    card.style.borderLeftColor = colour;
    card.dataset.id = msg.id;

    // Apply priority-based background tint (ambo/fire pages with colour codes)
    const priority = msg.priority || extractPriorityFromContent(msg.content);
    if (priority) {
      card.classList.add('priority-' + priority.toLowerCase());
    }

    // Header: capcode (clickable for admin), alias, call type badge, protocol, time
    const capcodeClass = isAdmin ? 'msg-capcode msg-capcode-admin' : 'msg-capcode';
    let headerHtml = `<span class="${capcodeClass}" data-capcode="${esc(msg.capcode)}">${esc(msg.capcode)}</span>`;
    if (aliasName) headerHtml += `<span class="msg-alias" style="color:${esc(aliasColour)}" title="${esc(aliasNotes || '')}">${esc(aliasName)}</span>`;
    if (msg.call_type) headerHtml += `<span class="msg-badge" style="background:${colour}">${esc(msg.call_type)}</span>`;
    headerHtml += `<span class="msg-protocol">${esc(msg.protocol)}${msg.bitrate ? '/' + msg.bitrate : ''}</span>`;
    headerHtml += `<span class="msg-time" title="${esc(formatDateTime(msg.received_at))}">${timeAgo(msg.received_at)}</span>`;

    // Trucks (bold, prominent)
    let trucksHtml = '';
    if (msg.trucks) {
      trucksHtml = `<div class="msg-trucks">${esc(msg.trucks)}</div>`;
    }

    // Content (with trucks stripped from display if they were at the start)
    const displayContent = contentWithoutTrucks(msg.content, msg.trucks);

    // Incident number (F-number, clickable)
    const incidentNum = msg.incident_number || extractIncidentNumber(msg.content);
    let incidentHtml = '';
    if (incidentNum) {
      incidentHtml = `<div class="msg-incident"><a href="https://sitrep.fireandemergency.nz/report/${esc(incidentNum)}" target="_blank" rel="noopener" class="incident-link">${esc(incidentNum)}</a></div>`;
    }

    // Location + date/time of call
    let metaHtml = '';
    if (msg.location) metaHtml += `<span class="msg-meta-item">&#x1f4cd; ${esc(msg.location)}</span>`;
    // Show formatted date and time next to location
    metaHtml += `<span class="msg-meta-item">&#x1f552; ${formatDateTime(msg.received_at)}</span>`;

    // Fire/Ambo type icon
    let typeIconHtml = '';
    if (msg.call_type) {
      if (FIRE_TYPES.includes(msg.call_type)) {
        typeIconHtml = `<div class="msg-type-icon msg-type-fire"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 002.5 2.5z"/></svg></div>`;
        card.classList.add('has-type-icon');
      } else if (AMBO_TYPES.includes(msg.call_type)) {
        typeIconHtml = `<div class="msg-type-icon msg-type-ambo"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6v12"/><path d="M6 12h12"/><circle cx="12" cy="12" r="10"/></svg></div>`;
        card.classList.add('has-type-icon');
      }
    }

    card.innerHTML = `
      <div class="msg-header">${headerHtml}</div>
      ${trucksHtml}
      <div class="msg-content">${esc(displayContent)}</div>
      ${metaHtml ? `<div class="msg-meta">${metaHtml}</div>` : ''}
      ${incidentHtml}
      ${typeIconHtml}
    `;

    // Click handlers
    card.addEventListener('click', (e) => {
      // Don't trigger detail if clicking a link or admin capcode
      if (e.target.closest('.incident-link') || e.target.closest('.msg-capcode-admin')) return;
      showDetail(msg);
    });

    // Admin: click capcode to edit alias
    if (isAdmin) {
      const capcodeEl = card.querySelector('.msg-capcode-admin');
      if (capcodeEl) {
        capcodeEl.addEventListener('click', (e) => {
          e.stopPropagation();
          showAliasModal(msg.capcode);
        });
      }
    }

    return card;
  }

  // ─── Message detail panel ───
  // ─── Measure actual topbar height and set CSS variable ───
  function updateTopbarHeight() {
    const topbar = document.querySelector('.topbar');
    if (topbar) {
      document.documentElement.style.setProperty('--topbar-actual-h', topbar.offsetHeight + 'px');
    }
  }

  // ─── Measure actual viewport height for iOS Safari ───
  function updateAppHeight() {
    document.documentElement.style.setProperty('--app-height', window.innerHeight + 'px');
  }

  // ─── Detect CAD status/timing messages (matches server-side MISC detection) ───
  function isStatusMessage(content, callType) {
    // If server already tagged as MISC, trust it
    if (callType === 'MISC') return true;
    if (!content) return false;
    // "Unit: MALB1 Assigned to Station: Picton"
    if (/\bUnit:\s*\S+\s+Assigned to Station:/i.test(content)) return true;
    // "Assigned to Station:" without Unit prefix
    if (/\bAssigned to Station:/i.test(content)) return true;
    // Full-word timing: "Unit:HAM6 Job #0231-1-2026/0Responded:08:23Located:08:33Departed:09:09Destination:09:31"
    if (/(?:Responded|Located|Departed|Destination):\d{2}:\d{2}/i.test(content)) return true;
    // Abbreviated timing: "GREY1 Ref:0561-3-2026/02/19 Rec:18:52Disp:18:52Loc:19:07"
    if (/Ref:\S+\s*(?:Rec|Disp|Resp|Loc|Dep|Dest|Can):/i.test(content)) return true;
    // Status messages like "Enroute", "On Scene", "Available"
    if (/^\s*(Enroute|On Scene|Available|At Station|Responding|Returning)\s*$/i.test(content)) return true;
    return false;
  }

  function showDetail(msg) {
    const panel = $('#detail-panel');
    const content = $('#detail-content');
    const alias = state.aliases[msg.capcode];
    const aliasName = alias ? alias.alias : msg.alias || null;
    const aliasNotes = alias ? alias.notes : msg.alias_notes || null;
    const incidentNum = msg.incident_number || extractIncidentNumber(msg.content);
    const isAdmin = state.user && state.user.role === 'admin';

    let capcodeHtml = `<span class="mono">${esc(msg.capcode)}</span>`;
    if (isAdmin) capcodeHtml += ` <button class="btn btn-sm" id="detail-edit-alias">Edit Alias</button>`;

    content.innerHTML = `
      <div class="detail-row"><div class="detail-label">Capcode</div><div class="detail-value">${capcodeHtml}</div></div>
      ${aliasName ? `<div class="detail-row"><div class="detail-label">Alias</div><div class="detail-value">${esc(aliasName)}${aliasNotes ? ` <span style="color:var(--text-muted);font-size:0.8rem">(${esc(aliasNotes)})</span>` : ''}</div></div>` : ''}
      ${msg.trucks ? `<div class="detail-row"><div class="detail-label">Trucks/Units</div><div class="detail-value" style="font-weight:700">${esc(msg.trucks)}</div></div>` : ''}
      <div class="detail-row"><div class="detail-label">Content</div><div class="detail-value">${esc(msg.content)}</div></div>
      ${msg.call_type ? `<div class="detail-row"><div class="detail-label">Call Type</div><div class="detail-value"><span class="msg-badge" style="background:${CALL_TYPE_COLOURS[msg.call_type] || '#6b7280'}">${esc(msg.call_type)}</span></div></div>` : ''}
      ${msg.location ? `<div class="detail-row"><div class="detail-label">Location</div><div class="detail-value">${esc(msg.location)}</div></div>` : ''}
      ${incidentNum ? `<div class="detail-row"><div class="detail-label">Incident</div><div class="detail-value"><a href="https://sitrep.fireandemergency.nz/report/${esc(incidentNum)}" target="_blank" rel="noopener" class="incident-link">${esc(incidentNum)}</a></div></div>` : ''}
      <div class="detail-row"><div class="detail-label">Protocol</div><div class="detail-value">${esc(msg.protocol)}${msg.bitrate ? ' / ' + msg.bitrate + ' baud' : ''}</div></div>
      <div class="detail-row"><div class="detail-label">Received</div><div class="detail-value">${esc(formatDateTime(msg.received_at))}</div></div>
      ${msg.raw ? `<div class="detail-row"><div class="detail-label">Raw</div><div class="detail-value mono" style="font-size:0.75rem;word-break:break-all">${esc(msg.raw)}</div></div>` : ''}
    `;

    // Admin: edit alias button
    if (isAdmin) {
      const editBtn = content.querySelector('#detail-edit-alias');
      if (editBtn) editBtn.onclick = () => { hideDetail(); showAliasModal(msg.capcode); };
    }

    panel.classList.remove('hidden');
    const backdrop = $('#detail-backdrop');
    requestAnimationFrame(() => {
      panel.classList.add('visible');
      backdrop.classList.add('visible');
    });
  }

  function hideDetail() {
    const panel = $('#detail-panel');
    const backdrop = $('#detail-backdrop');
    panel.classList.remove('visible');
    backdrop.classList.remove('visible');
    setTimeout(() => panel.classList.add('hidden'), 250);
  }

  // ─── WebSocket ───
  function connectWs() {
    if (state.ws && state.ws.readyState <= 1) return;

    // Clear any existing ping interval from a previous connection
    if (state.wsPingInterval) {
      clearInterval(state.wsPingInterval);
      state.wsPingInterval = null;
    }

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    state.ws = new WebSocket(`${proto}://${location.host}/ws`);
    const statusDot = $('#connection-status');
    statusDot.className = 'status-dot connecting';
    statusDot.title = 'Connecting...';

    state.ws.onopen = () => {
      // Reset reconnect delay on successful connection
      state.wsReconnectDelay = 1000;
      // Authenticate
      state.ws.send(JSON.stringify({ type: 'auth', token: state.token }));
    };

    state.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);

        if (msg.type === 'auth') {
          if (msg.status === 'ok') {
            statusDot.className = 'status-dot connected';
            statusDot.title = 'Connected';
          } else {
            statusDot.className = 'status-dot disconnected';
            statusDot.title = 'Auth failed';
          }
          return;
        }

        if (msg.type === 'connected' || msg.type === 'heartbeat' || msg.type === 'pong') return;

        if (msg.type === 'message' && msg.data) {
          handleNewMessage(msg.data);
        }

        // Handle alias update broadcast — refresh aliases and re-render live messages
        if (msg.type === 'alias_updated') {
          refreshAliasesAndRerender();
        }

        // Handle silence alert from client — show warning toast
        if (msg.type === 'silence-alert' && msg.data) {
          toast(`⚠️ ${msg.data.message}`, 'warning');
        }
      } catch { /* ignore malformed messages */ }
    };

    state.ws.onclose = () => {
      statusDot.className = 'status-dot disconnected';
      statusDot.title = 'Disconnected';
      // Clear ping interval
      if (state.wsPingInterval) {
        clearInterval(state.wsPingInterval);
        state.wsPingInterval = null;
      }
      // Reconnect with exponential backoff (1s, 2s, 4s, 8s... max 30s)
      if (state.token) {
        state.wsReconnectTimer = setTimeout(connectWs, state.wsReconnectDelay);
        state.wsReconnectDelay = Math.min(state.wsReconnectDelay * 2, 30000);
      }
    };

    state.ws.onerror = () => {
      state.ws.close();
    };

    // Keepalive — stored on state so it gets cleaned up properly
    state.wsPingInterval = setInterval(() => {
      if (state.ws && state.ws.readyState === 1) {
        state.ws.send(JSON.stringify({ type: 'ping' }));
      } else {
        clearInterval(state.wsPingInterval);
        state.wsPingInterval = null;
      }
    }, 25000);
  }

  function disconnectWs() {
    if (state.wsReconnectTimer) clearTimeout(state.wsReconnectTimer);
    state.wsReconnectTimer = null;
    if (state.wsPingInterval) {
      clearInterval(state.wsPingInterval);
      state.wsPingInterval = null;
    }
    state.wsReconnectDelay = 1000;
    if (state.ws) state.ws.close();
  }

  // ─── Refresh aliases from server and re-render live messages ───
  async function refreshAliasesAndRerender() {
    try {
      const updatedAliases = await api('/api/aliases');
      state.aliases = {};
      for (const a of updatedAliases) state.aliases[a.capcode] = a;
      // Re-render all visible live messages with updated alias data
      const list = $('#message-list');
      if (list && state.messages.length > 0) {
        list.innerHTML = '';
        for (const msg of state.messages) {
          list.appendChild(renderMessageCard(msg));
        }
      }
    } catch { /* ignore - will pick up aliases on next load */ }
  }

  // ─── Navigate to a specific message (from notification click) ───
  function navigateToMessage(messageId) {
    // Switch to live view
    if (state.currentView !== 'live') switchView('live');
    state.paused = false;
    $('#btn-pause').textContent = 'Pause';

    // Try to find in current messages
    const card = document.querySelector(`.msg-card[data-id="${messageId}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('highlight-flash');
      setTimeout(() => card.classList.remove('highlight-flash'), 3000);
      return;
    }

    // Not in current feed - store and load, then try to find
    state.pendingMessageId = messageId;
    loadRecentMessages();
  }

  // ─── Handle new live message ───
  function handleNewMessage(msg) {
    // Flash the status dot to indicate incoming data
    const statusDot = $('#connection-status');
    if (statusDot) {
      statusDot.classList.remove('data-flash');
      void statusDot.offsetWidth; // force reflow to restart animation
      statusDot.classList.add('data-flash');
    }

    // Skip hidden capcodes (from server broadcast flag or local alias)
    const normCap = normalizeCapcode(msg.capcode);
    const aliasObj = state.aliases[normCap] || state.aliases[msg.capcode];
    const isHidden = msg.hidden || (aliasObj && aliasObj.hidden);

    // Check in-app alerts even if paused (Safari fallback for push), but not for hidden
    if (!isHidden) checkInAppAlert(msg);

    if (state.paused) return;
    if (isHidden) return; // Don't show hidden messages in live feed

    // Check if message passes current filters
    if (!matchesFilters(msg)) return;

    // Only add WS messages to the live feed when viewing page 1
    if (state.livePage !== 0) return;

    // Add to front of array (newest first)
    state.messages.unshift(msg);
    if (state.messages.length > state.liveLimit) {
      state.messages.pop();
      const list = $('#message-list');
      if (list.lastChild) list.removeChild(list.lastChild);
    }
    // Bump the total count so pagination stays accurate
    state.liveTotalCount++;
    renderLivePagination();

    // Prepend to top of list (newest at top)
    const list = $('#message-list');
    const card = renderMessageCard(msg);
    list.insertBefore(card, list.firstChild);
  }

  // ─── Pull to refresh (touch only) ───
  function setupPullToRefresh() {
    const view = $('#view-live');
    const list = $('#message-list');
    const ptr = $('#pull-to-refresh');
    if (!view || !list || !ptr) return;

    let startY = 0;
    let pulling = false;
    let refreshing = false;
    const THRESHOLD = 70;

    view.addEventListener('touchstart', (e) => {
      if (refreshing) return;
      if (list.scrollTop <= 0) {
        startY = e.touches[0].clientY;
        pulling = true;
      }
    }, { passive: true });

    view.addEventListener('touchmove', (e) => {
      if (!pulling || refreshing) return;
      const diff = e.touches[0].clientY - startY;
      if (diff > 0 && list.scrollTop <= 0) {
        // Proportional pull with resistance
        const progress = Math.min(diff / THRESHOLD, 1);
        const height = Math.min(diff * 0.4, 50);
        ptr.style.height = height + 'px';
        ptr.style.transition = 'none';
        if (progress >= 1) {
          ptr.classList.add('pulling');
        } else {
          ptr.classList.remove('pulling');
        }
      } else {
        ptr.style.height = '0px';
        ptr.classList.remove('pulling');
      }
    }, { passive: true });

    view.addEventListener('touchend', async () => {
      if (!pulling || refreshing) return;
      pulling = false;
      if (ptr.classList.contains('pulling')) {
        refreshing = true;
        ptr.classList.remove('pulling');
        ptr.classList.add('refreshing');
        ptr.style.transition = 'height 0.2s ease';
        ptr.style.height = '40px';
        await applyFilters();
        ptr.classList.remove('refreshing');
        ptr.style.height = '0px';
        refreshing = false;
      } else {
        ptr.style.transition = 'height 0.2s ease';
        ptr.style.height = '0px';
      }
    });
  }

  // ─── Region matching helpers (word boundary + street suffix detection) ───
  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function termMatchesAsLocation(termLower, contentLower, suffixAlt) {
    const termPattern = escapeRegex(termLower).replace(/\s+/g, '\\s+');
    // Must appear as a whole word (word boundaries)
    const wordRegex = new RegExp('\\b' + termPattern + '\\b', 'i');
    if (!wordRegex.test(contentLower)) return false;
    // Must NOT be followed by a street suffix
    if (suffixAlt) {
      const streetRegex = new RegExp('\\b' + termPattern + '\\s+(?:' + suffixAlt + ')\\b', 'i');
      if (streetRegex.test(contentLower)) return false;
    }
    return true;
  }

  let _suffixAlt = null;
  function getSuffixAlt() {
    if (_suffixAlt !== null) return _suffixAlt;
    if (state.streetSuffixes && state.streetSuffixes.length > 0) {
      _suffixAlt = state.streetSuffixes.map(s => escapeRegex(s)).join('|');
    } else {
      _suffixAlt = '';
    }
    return _suffixAlt;
  }

  function contentMatchesRegion(content, region) {
    const contentLower = (content || '').toLowerCase();
    if (region.excludes && region.excludes.length > 0) {
      for (const exc of region.excludes) {
        if (contentLower.includes(exc.toLowerCase())) return false;
      }
    }
    const suffixAlt = getSuffixAlt();
    return region.terms.some(term => termMatchesAsLocation(term.toLowerCase(), contentLower, suffixAlt));
  }

  function matchesFilters(msg) {
    const search = $('#filter-search').value.toLowerCase();
    const callType = $('#filter-call-type').value;
    const protocol = $('#filter-protocol').value;
    const capcode = $('#filter-capcode').value;
    const location = $('#filter-location').value.toLowerCase();
    const trucks = $('#filter-trucks').value.toLowerCase();
    const groupId = $('#filter-group').value;
    const regionName = $('#filter-region') ? $('#filter-region').value : '';
    const hideTest = $('#filter-hide-test') && $('#filter-hide-test').checked;
    const dateFrom = $('#filter-date-from') ? $('#filter-date-from').value : '';
    const dateTo = $('#filter-date-to') ? $('#filter-date-to').value : '';

    // Hide test and misc/status messages by default
    if (hideTest && (msg.call_type === 'TEST' || msg.call_type === 'MISC' || isStatusMessage(msg.content, msg.call_type))) return false;

    if (search && !(msg.content || '').toLowerCase().includes(search)) return false;
    if (callType && msg.call_type !== callType) return false;
    if (protocol && msg.protocol !== protocol) return false;
    if (capcode && normalizeCapcode(msg.capcode) !== normalizeCapcode(capcode)) return false;
    if (location && !(msg.location || '').toLowerCase().includes(location)) return false;
    if (trucks && !(msg.trucks || '').toLowerCase().includes(trucks)) return false;
    if (regionName) {
      const region = state.regions.find(r => r.name === regionName);
      if (region && !contentMatchesRegion(msg.content, region)) return false;
    }
    if (groupId) {
      const group = state.groups.find(g => g.id === parseInt(groupId, 10));
      if (group) {
        let matchesGroup = false;
        // Check capcode members
        if (group.members) {
          const caps = group.members.map(m => normalizeCapcode(m.capcode));
          if (caps.includes(normalizeCapcode(msg.capcode))) matchesGroup = true;
        }
        // Check keywords
        if (!matchesGroup && group.keywords && group.keywords.length > 0) {
          const content = (msg.content || '').toLowerCase();
          matchesGroup = group.keywords.some(kw => content.includes(kw.keyword.toLowerCase()));
        }
        if (!matchesGroup) return false;
      }
    }
    // Date range filtering
    if (dateFrom || dateTo) {
      const msgDate = new Date(msg.received_at + (msg.received_at.endsWith('Z') ? '' : 'Z'));
      if (dateFrom) {
        const from = new Date(dateFrom + 'T00:00:00Z');
        if (msgDate < from) return false;
      }
      if (dateTo) {
        const to = new Date(dateTo + 'T23:59:59Z');
        if (msgDate > to) return false;
      }
    }
    return true;
  }

  // ─── Load data ───
  async function loadInitialData() {
    try {
      const [groups, favs, aliases, callTypes, filters, keywordAlerts, alarmLevelData, prefs, silenced, regionData] = await Promise.all([
        api('/api/groups'),
        api('/api/favourites'),
        api('/api/aliases'),
        api('/api/messages/call-types'),
        api('/api/filters'),
        api('/api/keyword-alerts'),
        api('/api/alarm-level-alert'),
        api('/api/preferences'),
        api('/api/silenced-capcodes'),
        api('/api/regions'),
      ]);

      state.groups = groups;
      state.favourites = favs;
      state.callTypes = callTypes;
      state.regions = regionData.regions || regionData;
      state.streetSuffixes = regionData.streetSuffixes || [];
      _suffixAlt = null; // reset cached suffix regex
      state.filters = filters;
      state.keywordAlerts = keywordAlerts;
      state.alarmLevelSetting = alarmLevelData.min_alarm_level || null;
      state.alarmLevelGroups = alarmLevelData.group_ids || [];
      state.preferences = prefs;
      state.silencedCapcodes = silenced;

      // Sync alarm level dropdown
      const alarmSelect = $('#alarm-level-select');
      if (alarmSelect) alarmSelect.value = state.alarmLevelSetting || '';

      // Build alias map
      state.aliases = {};
      for (const a of aliases) {
        state.aliases[a.capcode] = a;
      }

      // Load group members and keywords for in-app alert matching
      for (const g of state.groups) {
        try {
          const detail = await api(`/api/groups/${g.id}`);
          g.members = detail.members || [];
          g.keywords = detail.keywords || [];
        } catch { /* ignore */ }
      }

      renderSidebar();
      renderFilterOptions();
      loadRecentMessages();
    } catch (err) {
      toast('Failed to load data: ' + err.message, 'error');
    }
  }

  async function loadRecentMessages() {
    state.livePage = 0;
    await loadLivePage(0);
  }

  // ─── Sidebar rendering ───
  function renderSidebar() {
    // Favourites
    const favsEl = $('#sidebar-favourites');
    if (state.favourites.length === 0) {
      favsEl.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted);padding:0.25rem 0.625rem">No favourites yet</span>';
    } else {
      favsEl.innerHTML = state.favourites.map(f => `
        <a href="#" class="nav-item" data-view="live" data-group-filter="${f.group_id}">
          <span class="colour-dot" style="background:${esc(f.group_colour)}"></span>
          ${esc(f.group_name)}
          ${f.notify ? '<span class="nav-badge">&#128276;</span>' : ''}
        </a>
      `).join('');
    }

    // Groups (with favourite star toggle)
    const groupsEl = $('#sidebar-groups');
    if (state.groups.length === 0) {
      groupsEl.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted);padding:0.25rem 0.625rem">No groups yet</span>';
    } else {
      groupsEl.innerHTML = state.groups.map(g => {
        const isFav = state.favourites.some(f => f.group_id === g.id);
        return `
          <div class="nav-item" data-group-filter="${g.id}">
            <span class="colour-dot" style="background:${esc(g.colour)}"></span>
            <span style="flex:1;cursor:pointer" data-group-click="${g.id}">${esc(g.name)}</span>
            <span class="nav-badge">${g.member_count || 0}</span>
            <button class="fav-star ${isFav ? 'active' : ''}" data-fav-group="${g.id}" title="${isFav ? 'Remove from favourites' : 'Add to favourites'}">${isFav ? '\u2605' : '\u2606'}</button>
          </div>
        `;
      }).join('');
    }

    // Saved filters
    const filtersEl = $('#sidebar-filters');
    if (state.filters.length === 0) {
      filtersEl.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted);padding:0.25rem 0.625rem">No saved filters</span>';
    } else {
      filtersEl.innerHTML = state.filters.map(f => `
        <a href="#" class="nav-item" data-saved-filter='${esc(JSON.stringify(f.filter))}'>
          ${esc(f.name)}
        </a>
      `).join('');
    }

    // Keyword alerts
    const keywordsEl = $('#sidebar-keywords');
    if (state.keywordAlerts.length === 0) {
      keywordsEl.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted);padding:0.25rem 0.625rem">No keyword alerts</span>';
    } else {
      keywordsEl.innerHTML = state.keywordAlerts.map(ka => `
        <div class="keyword-item">
          <span class="keyword-text">${esc(ka.keyword)}${ka.group_name ? ' <span style="font-size:0.7rem;color:var(--text-muted)">(' + esc(ka.group_name) + ')</span>' : ''}</span>
          <button class="keyword-remove" data-remove-keyword="${ka.id}" title="Remove">&times;</button>
        </div>
      `).join('');
    }

    // Keyword alert remove handlers
    keywordsEl.querySelectorAll('[data-remove-keyword]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await api(`/api/keyword-alerts/${btn.dataset.removeKeyword}`, { method: 'DELETE' });
          state.keywordAlerts = await api('/api/keyword-alerts');
          renderSidebar();
          toast('Keyword alert removed', 'success');
        } catch (err) { toast(err.message, 'error'); }
      });
    });

    // Click handlers for sidebar items
    favsEl.querySelectorAll('[data-group-filter]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        $('#filter-group').value = el.dataset.groupFilter;
        switchView('live');
        applyFilters();
        closeSidebar();
      });
    });
    // Group name click -> filter by group
    groupsEl.querySelectorAll('[data-group-click]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        $('#filter-group').value = el.dataset.groupClick;
        switchView('live');
        applyFilters();
        closeSidebar();
      });
    });
    // Group favourite star click
    groupsEl.querySelectorAll('[data-fav-group]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavourite(parseInt(btn.dataset.favGroup, 10));
      });
    });
    filtersEl.querySelectorAll('[data-saved-filter]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        try {
          const f = JSON.parse(el.dataset.savedFilter);
          if (f.search) $('#filter-search').value = f.search;
          if (f.call_type) $('#filter-call-type').value = f.call_type;
          if (f.protocol) $('#filter-protocol').value = f.protocol;
          if (f.region) $('#filter-region').value = f.region;
          if (f.capcode) $('#filter-capcode').value = f.capcode;
          if (f.location) $('#filter-location').value = f.location;
          if (f.trucks) $('#filter-trucks').value = f.trucks;
          if (f.group_id) $('#filter-group').value = f.group_id;
          if (f.date_from && $('#filter-date-from')) $('#filter-date-from').value = f.date_from;
          if (f.date_to && $('#filter-date-to')) $('#filter-date-to').value = f.date_to;
          switchView('live');
          applyFilters();
          closeSidebar();
        } catch { /* ignore */ }
      });
    });

    // Show admin link if admin
    if (state.user && state.user.role === 'admin') {
      $('#menu-admin').classList.remove('hidden');
    }
  }

  function renderFilterOptions() {
    // Call types
    const sel = $('#filter-call-type');
    sel.innerHTML = '<option value="">All Types</option>';
    for (const ct of state.callTypes) {
      sel.innerHTML += `<option value="${esc(ct.type)}">${esc(ct.type)}</option>`;
    }

    // Groups
    const gsel = $('#filter-group');
    gsel.innerHTML = '<option value="">All Groups</option>';
    for (const g of state.groups) {
      gsel.innerHTML += `<option value="${g.id}">${esc(g.name)}</option>`;
    }

    // Regions
    const rsel = $('#filter-region');
    if (rsel && state.regions) {
      rsel.innerHTML = '<option value="">All Regions</option>';
      for (const r of state.regions) {
        rsel.innerHTML += `<option value="${esc(r.name)}">${esc(r.name)}</option>`;
      }
    }
  }

  // ─── Apply filters (re-fetch for search, re-filter for live) ───
  // ─── Shared filter params builder ───
  function buildFilterParams() {
    const params = new URLSearchParams();
    const search = $('#filter-search').value;
    const callType = $('#filter-call-type').value;
    const protocol = $('#filter-protocol').value;
    const capcode = $('#filter-capcode').value;
    const location = $('#filter-location').value;
    const trucks = $('#filter-trucks').value;
    const groupId = $('#filter-group').value;
    const regionName = $('#filter-region') ? $('#filter-region').value : '';
    const hideTest = $('#filter-hide-test') && $('#filter-hide-test').checked;
    const dateFrom = $('#filter-date-from') ? $('#filter-date-from').value : '';
    const dateTo = $('#filter-date-to') ? $('#filter-date-to').value : '';
    if (search) params.set('search', search);
    if (callType) params.set('call_type', callType);
    if (protocol) params.set('protocol', protocol);
    if (capcode) params.set('capcode', capcode);
    if (location) params.set('location', location);
    if (trucks) params.set('trucks', trucks);
    if (groupId) params.set('group_id', groupId);
    if (regionName) params.set('region', regionName);
    if (hideTest) params.set('exclude_call_type', 'TEST,MISC');
    if (dateFrom) params.set('since', dateFrom + 'T00:00:00');
    if (dateTo) params.set('until', dateTo + 'T23:59:59');
    return params;
  }

  async function applyFilters() {
    if (state.currentView === 'search') {
      await doSearch(0);
    }
    if (state.currentView === 'live') {
      state.livePage = 0;
      await loadLivePage(0);
    }
  }

  // ─── Live feed pagination (24-hour window) ───
  async function loadLivePage(page) {
    state.livePage = page;
    try {
      const params = buildFilterParams();
      params.set('limit', state.liveLimit.toString());
      params.set('offset', (page * state.liveLimit).toString());
      // Live feed: 24-hour window unless a date filter is explicitly set
      const dateFrom = $('#filter-date-from') ? $('#filter-date-from').value : '';
      if (!dateFrom) {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
        params.set('since', since);
      }

      // Fetch messages and count in parallel
      const [msgs, countData] = await Promise.all([
        api('/api/messages?' + params.toString()),
        api('/api/messages/count?' + params.toString()),
      ]);

      state.liveTotalCount = countData.total || 0;

      const list = $('#message-list');
      list.innerHTML = '';
      state.messages = msgs;
      for (const msg of state.messages) {
        list.appendChild(renderMessageCard(msg));
      }

      renderLivePagination();

      // If we have a pending messageId from notification click, scroll to it
      if (state.pendingMessageId) {
        const msgId = state.pendingMessageId;
        state.pendingMessageId = null;
        requestAnimationFrame(() => {
          const card = document.querySelector(`.msg-card[data-id="${msgId}"]`);
          if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.classList.add('highlight-flash');
            setTimeout(() => card.classList.remove('highlight-flash'), 3000);
          }
        });
      }
    } catch (err) {
      toast('Failed to load messages: ' + err.message, 'error');
    }
  }

  function renderLivePagination() {
    const el = $('#live-pagination');
    if (!el) return;
    const totalPages = Math.max(1, Math.ceil(state.liveTotalCount / state.liveLimit));
    if (totalPages <= 1) { el.innerHTML = ''; return; }
    renderPageControls(el, state.livePage, totalPages, (p) => loadLivePage(p));
  }

  // ─── Search (unlimited history) ───
  async function doSearch(page) {
    state.searchPage = page;
    try {
      const params = buildFilterParams();
      params.set('limit', state.searchLimit.toString());
      params.set('offset', (page * state.searchLimit).toString());
      // No 'since' param — search goes back to the beginning of time

      const [msgs, countData] = await Promise.all([
        api('/api/messages?' + params.toString()),
        api('/api/messages/count?' + params.toString()),
      ]);

      const list = $('#search-results');
      list.innerHTML = '';
      for (const msg of msgs) {
        list.appendChild(renderMessageCard(msg));
      }

      const totalPages = Math.max(1, Math.ceil((countData.total || 0) / state.searchLimit));
      renderPageControls($('#search-pagination'), state.searchPage, totalPages, (p) => doSearch(p));
    } catch (err) {
      toast('Search failed: ' + err.message, 'error');
    }
  }

  // ─── Shared page controls renderer ───
  function renderPageControls(el, currentPage, totalPages, onPageChange) {
    if (!el) return;
    el.innerHTML = '';

    // Previous button
    const prevBtn = document.createElement('button');
    prevBtn.textContent = '\u25C0 Prev';
    prevBtn.disabled = currentPage === 0;
    if (!prevBtn.disabled) prevBtn.onclick = () => onPageChange(currentPage - 1);
    el.appendChild(prevBtn);

    // Page number buttons (show up to 7 pages with ellipsis)
    const maxVisible = 7;
    let startPage = Math.max(0, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages - 1, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) {
      startPage = Math.max(0, endPage - maxVisible + 1);
    }

    if (startPage > 0) {
      const btn = document.createElement('button');
      btn.textContent = '1';
      btn.onclick = () => onPageChange(0);
      el.appendChild(btn);
      if (startPage > 1) {
        const dots = document.createElement('span');
        dots.textContent = '\u2026';
        dots.style.cssText = 'font-size:0.85rem;color:var(--text-dim);padding:0 0.25rem';
        el.appendChild(dots);
      }
    }

    for (let i = startPage; i <= endPage; i++) {
      const btn = document.createElement('button');
      btn.textContent = (i + 1).toString();
      if (i === currentPage) btn.classList.add('active');
      else btn.onclick = () => onPageChange(i);
      el.appendChild(btn);
    }

    if (endPage < totalPages - 1) {
      if (endPage < totalPages - 2) {
        const dots = document.createElement('span');
        dots.textContent = '\u2026';
        dots.style.cssText = 'font-size:0.85rem;color:var(--text-dim);padding:0 0.25rem';
        el.appendChild(dots);
      }
      const btn = document.createElement('button');
      btn.textContent = totalPages.toString();
      btn.onclick = () => onPageChange(totalPages - 1);
      el.appendChild(btn);
    }

    // Next button
    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next \u25B6';
    nextBtn.disabled = currentPage >= totalPages - 1;
    if (!nextBtn.disabled) nextBtn.onclick = () => onPageChange(currentPage + 1);
    el.appendChild(nextBtn);

    // Page info
    const info = document.createElement('span');
    info.style.cssText = 'font-size:0.75rem;color:var(--text-dim);margin-left:0.5rem';
    info.textContent = `Page ${currentPage + 1} of ${totalPages}`;
    el.appendChild(info);
  }

  // ─── Stats ───
  async function loadStats() {
    try {
      const stats = await api('/api/messages/stats');
      const el = $('#stats-content');
      let callTypeHtml = stats.callTypes.map(ct => `
        <li>
          <span><span class="colour-dot" style="background:${CALL_TYPE_COLOURS[ct.call_type] || '#6b7280'}"></span>${esc(ct.call_type)}</span>
          <span>${ct.count}</span>
        </li>
      `).join('');
      let capcodeHtml = stats.topCapcodes.map(cc => {
        const colour = cc.alias_colour || '#6b7280';
        const aliasName = cc.alias || '';
        const trucksStr = cc.trucks ? cc.trucks.join(', ') : '';
        return `<li>
          <span style="display:flex;flex-direction:column;gap:0.125rem;min-width:0">
            <span style="display:flex;align-items:center;gap:0.375rem">
              <span class="colour-dot" style="background:${esc(colour)}"></span>
              <span>${esc(cc.capcode)}${aliasName ? ' <b>' + esc(aliasName) + '</b>' : ''}</span>
            </span>
            ${trucksStr ? '<span class="stat-trucks">' + esc(trucksStr) + '</span>' : ''}
          </span>
          <span>${cc.count}</span>
        </li>`;
      }).join('');

      el.innerHTML = `
        <div class="stat-card"><h4>Total Messages</h4><div class="stat-value">${stats.total.toLocaleString()}</div></div>
        <div class="stat-card"><h4>Last 24 Hours</h4><div class="stat-value">${stats.today.toLocaleString()}</div></div>
        <div class="stat-card" style="grid-column: span 1"><h4>Call Types (24h)</h4><ul class="stat-list">${callTypeHtml || '<li>No data</li>'}</ul></div>
        <div class="stat-card" style="grid-column: span 1"><h4>Top Capcodes (24h)</h4><ul class="stat-list">${capcodeHtml || '<li>No data</li>'}</ul></div>
      `;
    } catch (err) {
      toast('Failed to load stats', 'error');
    }
  }

  // ─── Settings view ───
  async function loadNotifications() {
    const el = $('#notifications-content');
    if (!el) return;

    // Tabs: Notification Settings | Recent Notifications | Display Settings
    el.innerHTML = `
      <div class="notif-tabs">
        <button class="notif-tab ${state.notifTab === 'settings' ? 'active' : ''}" data-ntab="settings">Notification Settings</button>
        <button class="notif-tab ${state.notifTab === 'history' ? 'active' : ''}" data-ntab="history">Recent Notifications</button>
        <button class="notif-tab ${state.notifTab === 'display' ? 'active' : ''}" data-ntab="display">Display Settings</button>
      </div>
      <div id="notif-tab-content"></div>
    `;

    el.querySelectorAll('.notif-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        state.notifTab = tab.dataset.ntab;
        loadNotifications();
      });
    });

    if (state.notifTab === 'history') {
      await loadNotificationHistory();
    } else if (state.notifTab === 'display') {
      await loadDisplaySettings();
    } else {
      await loadNotificationSettings();
    }
  }

  async function loadNotificationHistory() {
    const container = $('#notif-tab-content');
    if (!container) return;

    let logs = [];
    try {
      logs = await api('/api/notification-log?limit=100');
    } catch { /* ignore */ }

    if (logs.length === 0) {
      container.innerHTML = `
        <div class="notif-section">
          <div class="notif-empty">No recent notifications. Notifications will appear here once you start receiving them.</div>
        </div>
      `;
      return;
    }

    const logsHtml = logs.map(log => {
      const normCap = normalizeCapcode(log.capcode || '');
      const alias = state.aliases[normCap];
      const aliasName = alias ? alias.alias : '';
      const isSilenced = state.silencedCapcodes.some(s => s.capcode === normCap);
      return `
        <div class="notif-log-item">
          <div class="notif-log-header">
            <span class="notif-log-title">${esc(log.title)}</span>
            <span class="notif-log-time">${timeAgo(log.created_at)}</span>
          </div>
          <div class="notif-log-body">${esc(log.body || '')}</div>
          <div class="notif-log-meta">
            <span class="notif-log-badge ${esc(log.match_type)}">${esc(log.match_type)}</span>
            ${log.match_detail ? '<span>' + esc(log.match_detail) + '</span>' : ''}
            ${log.capcode ? '<span>Cap: ' + esc(log.capcode) + (aliasName ? ' (' + esc(aliasName) + ')' : '') + '</span>' : ''}
            ${log.capcode && !isSilenced ? '<button class="btn btn-sm" style="padding:0.15rem 0.375rem;font-size:0.65rem" data-silence-capcode="' + esc(normCap) + '">Silence</button>' : ''}
            ${log.capcode && isSilenced ? '<span style="font-size:0.65rem;color:var(--text-muted)">(silenced)</span>' : ''}
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="notif-section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
          <h3 style="margin:0">Recent Notifications</h3>
          <button class="btn btn-sm btn-secondary" id="btn-clear-notif-log">Clear All</button>
        </div>
        ${logsHtml}
      </div>
    `;

    // Bind silence buttons
    container.querySelectorAll('[data-silence-capcode]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const capcode = btn.dataset.silenceCapcode;
        try {
          await api('/api/silenced-capcodes', { method: 'POST', body: JSON.stringify({ capcode }) });
          state.silencedCapcodes = await api('/api/silenced-capcodes');
          toast(`Capcode ${capcode} silenced`, 'success');
          loadNotifications();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });

    // Bind clear log
    const clearBtn = container.querySelector('#btn-clear-notif-log');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        try {
          await api('/api/notification-log', { method: 'DELETE' });
          toast('Notification log cleared', 'success');
          loadNotifications();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }
  }

  async function loadNotificationSettings() {
    const container = $('#notif-tab-content');
    if (!container) return;

    // Check current push status
    let pushActive = false;
    try {
      if (isSecureContext() && 'serviceWorker' in navigator && 'PushManager' in window &&
          'Notification' in window && Notification.permission === 'granted') {
        const reg = await navigator.serviceWorker.getRegistration('/');
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          pushActive = !!sub;
        }
      }
    } catch { /* ignore */ }

    // Build group notifications list
    let groupsHtml = '';
    if (state.favourites.length === 0) {
      groupsHtml = '<div class="notif-empty">No favourited groups. Add groups to favourites from the sidebar to receive notifications.</div>';
    } else {
      groupsHtml = state.favourites.map(f => {
        const group = state.groups.find(g => g.id === f.group_id);
        const colour = f.group_colour || (group ? group.colour : '#6b7280');
        return `
          <div class="notif-item">
            <div class="notif-item-label">
              <span class="colour-dot" style="background:${esc(colour)}"></span>
              ${esc(f.group_name)}
            </div>
            <label class="notif-toggle">
              <input type="checkbox" ${f.notify ? 'checked' : ''} data-fav-notify="${f.group_id}">
              <span class="slider"></span>
            </label>
          </div>
        `;
      }).join('');
    }

    // Build keyword alerts list (show group scope)
    let keywordsHtml = '';
    if (state.keywordAlerts.length === 0) {
      keywordsHtml = '<div class="notif-empty">No keyword alerts. Add keywords from the sidebar to get notified when they appear in pages.</div>';
    } else {
      keywordsHtml = state.keywordAlerts.map(ka => `
        <div class="notif-item">
          <div class="notif-item-label">
            ${esc(ka.keyword)}
            ${ka.group_name ? '<span style="font-size:0.7rem;color:var(--text-muted);margin-left:0.25rem">(' + esc(ka.group_name) + ')</span>' : ''}
          </div>
          <label class="notif-toggle">
            <input type="checkbox" ${ka.notify ? 'checked' : ''} data-keyword-notify="${ka.id}">
            <span class="slider"></span>
          </label>
        </div>
      `).join('');
    }

    // Alarm level
    const alarmVal = state.alarmLevelSetting || '';
    const alarmOptions = [
      { val: '', label: 'Off' },
      { val: '2', label: '2nd Alarm and above' },
      { val: '3', label: '3rd Alarm and above' },
      { val: '4', label: '4th Alarm and above' },
      { val: '5', label: '5th Alarm only' },
    ];
    const alarmGroupsHtml = state.groups.map(g => {
      const checked = state.alarmLevelGroups.includes(g.id) ? 'checked' : '';
      return `<label class="checkbox-label"><input type="checkbox" value="${g.id}" class="alarm-group-cb" ${checked}> <span class="colour-dot" style="background:${esc(g.colour)}"></span>${esc(g.name)}</label>`;
    }).join('');

    // Silenced capcodes
    const silencedHtml = state.silencedCapcodes.length === 0
      ? '<div class="notif-empty">No silenced capcodes. You can silence a capcode from the Recent tab to stop receiving notifications for it.</div>'
      : '<div style="display:flex;flex-wrap:wrap">' + state.silencedCapcodes.map(s => {
          const alias = state.aliases[s.capcode];
          return `<div class="silenced-chip">
            <span>${esc(s.capcode)}${alias ? ' (' + esc(alias.alias) + ')' : ''}</span>
            <button data-unsilence="${esc(s.capcode)}" title="Unsilence">&times;</button>
          </div>`;
        }).join('') + '</div>';

    // Default view preference
    const groupOptions = state.groups.map(g =>
      `<option value="${g.id}" ${state.preferences.default_group_id == g.id ? 'selected' : ''}>${esc(g.name)}</option>`
    ).join('');

    container.innerHTML = `
      <div class="notif-section">
        <h3>Push Notifications</h3>
        <div class="notif-status">
          <span class="notif-status-label">Browser push</span>
          <span class="notif-status-badge ${pushActive ? 'on' : 'off'}">
            ${pushActive ? 'ON' : 'OFF'}
          </span>
        </div>
        <div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.5rem;flex-wrap:wrap">
          <button class="btn btn-sm ${pushActive ? 'btn-danger' : 'btn-primary'}" id="notif-push-toggle">
            ${pushActive ? 'Disable Push' : 'Enable Push'}
          </button>
          ${pushActive ? '<button class="btn btn-sm btn-secondary" id="btn-test-push-settings">Test Notification</button>' : ''}
        </div>
        <p style="font-size:0.75rem;color:var(--text-muted);margin-top:0.5rem">
          Push notifications are sent when pages match your favourited groups, keyword alerts, or alarm level settings below.
        </p>
      </div>

      <div class="notif-section">
        <h3>Group Notifications</h3>
        <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.5rem">
          Toggle notifications for each of your favourited groups.
        </p>
        ${groupsHtml}
      </div>

      <div class="notif-section">
        <h3>Keyword Alerts</h3>
        <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.5rem">
          Toggle notifications for each keyword. Keywords scoped to a group will only match pages from that group.
        </p>
        ${keywordsHtml}
      </div>

      <div class="notif-section">
        <h3>Alarm Level Alerts</h3>
        <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.5rem">
          Get notified on multi-alarm fires.
        </p>
        <select id="notif-alarm-level" class="filter-select" style="width:100%">
          ${alarmOptions.map(o => `<option value="${o.val}" ${o.val === String(alarmVal) ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
        <div id="alarm-group-scope" style="margin-top:0.75rem;${!alarmVal ? 'display:none' : ''}">
          <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.375rem">
            Regions to monitor (leave all unchecked for nationwide):
          </p>
          <div class="checkbox-group">
            ${alarmGroupsHtml || '<span style="color:var(--text-muted);font-size:0.8rem">No groups created yet</span>'}
          </div>
        </div>
      </div>

      <div class="notif-section">
        <h3>Silenced Capcodes</h3>
        <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.5rem">
          Capcodes you've silenced will not trigger push notifications for you.
        </p>
        ${silencedHtml}
      </div>
    `;

    // Bind push toggle
    container.querySelector('#notif-push-toggle').addEventListener('click', async () => {
      await toggleNotifications();
      loadNotifications();
    });

    // Bind group notify toggles
    container.querySelectorAll('[data-fav-notify]').forEach(input => {
      input.addEventListener('change', async () => {
        const groupId = parseInt(input.dataset.favNotify, 10);
        try {
          await api(`/api/favourites/${groupId}/notify`, {
            method: 'PUT',
            body: JSON.stringify({ notify: input.checked }),
          });
          const fav = state.favourites.find(f => f.group_id === groupId);
          if (fav) fav.notify = input.checked ? 1 : 0;
          renderSidebar();
        } catch (err) {
          toast('Failed to update: ' + err.message, 'error');
          input.checked = !input.checked;
        }
      });
    });

    // Bind keyword notify toggles
    container.querySelectorAll('[data-keyword-notify]').forEach(input => {
      input.addEventListener('change', async () => {
        const id = parseInt(input.dataset.keywordNotify, 10);
        try {
          await api(`/api/keyword-alerts/${id}/notify`, {
            method: 'PUT',
            body: JSON.stringify({ notify: input.checked }),
          });
          const ka = state.keywordAlerts.find(k => k.id === id);
          if (ka) ka.notify = input.checked ? 1 : 0;
        } catch (err) {
          toast('Failed to update: ' + err.message, 'error');
          input.checked = !input.checked;
        }
      });
    });

    // Bind alarm level
    const alarmLevelSelect = container.querySelector('#notif-alarm-level');
    const alarmGroupScope = container.querySelector('#alarm-group-scope');

    alarmLevelSelect.addEventListener('change', async (e) => {
      const level = e.target.value || null;
      // Show/hide group scope section
      if (alarmGroupScope) {
        alarmGroupScope.style.display = level ? '' : 'none';
      }
      const groupIds = Array.from(container.querySelectorAll('.alarm-group-cb:checked')).map(cb => parseInt(cb.value, 10));
      try {
        await api('/api/alarm-level-alert', {
          method: 'PUT',
          body: JSON.stringify({ min_alarm_level: level, group_ids: groupIds }),
        });
        state.alarmLevelSetting = level ? parseInt(level, 10) : null;
        state.alarmLevelGroups = groupIds;
        const sidebarSelect = $('#alarm-level-select');
        if (sidebarSelect) sidebarSelect.value = level || '';
        toast('Alarm level updated', 'success');
      } catch (err) {
        toast('Failed to update: ' + err.message, 'error');
      }
    });

    // Bind alarm group checkboxes - save on change
    container.querySelectorAll('.alarm-group-cb').forEach(cb => {
      cb.addEventListener('change', async () => {
        const level = alarmLevelSelect.value || null;
        if (!level) return; // Don't save groups if alarm level is off
        const groupIds = Array.from(container.querySelectorAll('.alarm-group-cb:checked')).map(c => parseInt(c.value, 10));
        try {
          await api('/api/alarm-level-alert', {
            method: 'PUT',
            body: JSON.stringify({ min_alarm_level: level, group_ids: groupIds }),
          });
          state.alarmLevelGroups = groupIds;
          toast('Alarm regions updated', 'success');
        } catch (err) {
          toast('Failed to update: ' + err.message, 'error');
        }
      });
    });

    // Bind unsilence buttons
    container.querySelectorAll('[data-unsilence]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const capcode = btn.dataset.unsilence;
        try {
          await api(`/api/silenced-capcodes/${encodeURIComponent(capcode)}`, { method: 'DELETE' });
          state.silencedCapcodes = await api('/api/silenced-capcodes');
          toast(`Capcode ${capcode} unsilenced`, 'success');
          loadNotifications();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });

    // Bind test push button
    const testPushBtn = container.querySelector('#btn-test-push-settings');
    if (testPushBtn) {
      testPushBtn.addEventListener('click', async () => {
        testPushBtn.disabled = true;
        testPushBtn.textContent = 'Sending...';
        try {
          const result = await api('/api/push/test', { method: 'POST' });
          if (result.sent > 0) {
            toast(`Test notification sent! (${result.sent} delivered, ${result.failed} failed)`, 'success');
          } else {
            toast('All notifications failed: ' + (result.errors || []).join(', '), 'error');
          }
        } catch (err) {
          toast('Test failed: ' + err.message, 'error');
        }
        testPushBtn.disabled = false;
        testPushBtn.textContent = 'Test Notification';
      });
    }
  }

  async function loadDisplaySettings() {
    const container = $('#notif-tab-content');
    if (!container) return;

    const groupOptions = state.groups.map(g =>
      `<option value="${g.id}" ${state.preferences.default_group_id == g.id ? 'selected' : ''}>${esc(g.name)}</option>`
    ).join('');

    const regionOptions = (state.regions || []).map(r =>
      `<option value="${r.name}" ${state.preferences.default_region === r.name ? 'selected' : ''}>${esc(r.name)}</option>`
    ).join('');

    container.innerHTML = `
      <div class="notif-section">
        <h3>Default View</h3>
        <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.5rem">
          Choose what to show when you open the app or tap the home button.
        </p>
        <div class="pref-row">
          <label>Default page</label>
          <select id="pref-default-view" class="filter-select">
            <option value="live" ${state.preferences.default_view === 'live' ? 'selected' : ''}>Live Feed</option>
            <option value="search" ${state.preferences.default_view === 'search' ? 'selected' : ''}>Search</option>
            <option value="stats" ${state.preferences.default_view === 'stats' ? 'selected' : ''}>Stats</option>
            <option value="notifications" ${state.preferences.default_view === 'notifications' ? 'selected' : ''}>Settings</option>
          </select>
        </div>
        <div class="pref-row">
          <label>Default group filter</label>
          <select id="pref-default-group" class="filter-select">
            <option value="">None (all groups)</option>
            ${groupOptions}
          </select>
        </div>
        <div class="pref-row">
          <label>Default region filter</label>
          <select id="pref-default-region" class="filter-select">
            <option value="">None (all regions)</option>
            ${regionOptions}
          </select>
          <p style="font-size:0.75rem;color:var(--text-muted);margin-top:0.25rem">Region filter applies alongside group filter</p>
        </div>
      </div>
    `;

    container.querySelector('#pref-default-view').addEventListener('change', async (e) => {
      state.preferences.default_view = e.target.value;
      await savePreferences();
    });
    container.querySelector('#pref-default-group').addEventListener('change', async (e) => {
      state.preferences.default_group_id = e.target.value || null;
      await savePreferences();
    });
    container.querySelector('#pref-default-region').addEventListener('change', async (e) => {
      state.preferences.default_region = e.target.value || null;
      await savePreferences();
    });
  }

  async function savePreferences() {
    try {
      await api('/api/preferences', {
        method: 'PUT',
        body: JSON.stringify(state.preferences),
      });
      toast('Preferences saved', 'success');
    } catch (err) {
      toast('Failed to save: ' + err.message, 'error');
    }
  }

  // ─── Admin panel ───
  async function loadAdminTab(tab) {
    state.currentAdminTab = tab;
    $$('.admin-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    const el = $('#admin-content');

    if (tab === 'groups') {
      try {
        const groups = await api('/api/groups');
        state.groups = groups;
        el.innerHTML = `
          <div style="margin-bottom:0.75rem"><button class="btn btn-primary btn-sm" id="btn-add-group">Add Group</button></div>
          <table class="admin-table">
            <thead><tr><th>Name</th><th>Colour</th><th>Members</th><th>Keywords</th><th>Fav</th><th>Actions</th></tr></thead>
            <tbody>
              ${groups.map(g => {
                const isFav = state.favourites.some(f => f.group_id === g.id);
                return `
                <tr>
                  <td>${esc(g.name)}</td>
                  <td><span class="colour-dot" style="background:${esc(g.colour)}"></span>${esc(g.colour)}</td>
                  <td>${g.member_count || 0}</td>
                  <td>${g.keyword_count || 0}</td>
                  <td><button class="fav-star ${isFav ? 'active' : ''}" data-fav-group="${g.id}" title="${isFav ? 'Remove from favourites' : 'Add to favourites'}">${isFav ? '\u2605' : '\u2606'}</button></td>
                  <td class="admin-actions">
                    <button class="btn btn-sm" data-edit-group="${g.id}">Edit</button>
                    <button class="btn btn-sm btn-danger" data-delete-group="${g.id}">Delete</button>
                  </td>
                </tr>
              `}).join('')}
            </tbody>
          </table>
        `;
        el.querySelector('#btn-add-group').onclick = () => showGroupModal();
        el.querySelectorAll('[data-edit-group]').forEach(btn => {
          btn.onclick = () => showGroupModal(parseInt(btn.dataset.editGroup, 10));
        });
        el.querySelectorAll('[data-delete-group]').forEach(btn => {
          btn.onclick = async () => {
            if (confirm('Delete this group?')) {
              await api(`/api/groups/${btn.dataset.deleteGroup}`, { method: 'DELETE' });
              loadAdminTab('groups');
              toast('Group deleted', 'success');
            }
          };
        });
        el.querySelectorAll('[data-fav-group]').forEach(btn => {
          btn.onclick = async () => {
            await toggleFavourite(parseInt(btn.dataset.favGroup, 10));
            loadAdminTab('groups');
          };
        });
      } catch (err) {
        el.innerHTML = `<p>Error: ${esc(err.message)}</p>`;
      }
    } else if (tab === 'aliases') {
      try {
        const aliases = await api('/api/aliases');
        el.innerHTML = `
          <div style="margin-bottom:0.75rem"><button class="btn btn-primary btn-sm" id="btn-add-alias">Add Alias</button></div>
          <table class="admin-table">
            <thead><tr><th>Capcode</th><th>Alias</th><th>Colour</th><th>Call Type</th><th>Location</th><th>Hidden</th><th>Actions</th></tr></thead>
            <tbody>
              ${aliases.map(a => `
                <tr${a.hidden ? ' style="opacity:0.5"' : ''}>
                  <td class="mono">${esc(a.capcode)}</td>
                  <td>${esc(a.alias)}</td>
                  <td><span class="colour-dot" style="background:${esc(a.colour)}"></span></td>
                  <td>${esc(a.call_type || '')}</td>
                  <td>${esc(a.location || '')}</td>
                  <td>${a.hidden ? 'Yes' : ''}</td>
                  <td class="admin-actions">
                    <button class="btn btn-sm" data-edit-alias="${esc(a.capcode)}">Edit</button>
                    <button class="btn btn-sm btn-danger" data-delete-alias="${esc(a.capcode)}">Delete</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
        el.querySelector('#btn-add-alias').onclick = () => showAliasModal();
        el.querySelectorAll('[data-edit-alias]').forEach(btn => {
          btn.onclick = () => showAliasModal(btn.dataset.editAlias);
        });
        el.querySelectorAll('[data-delete-alias]').forEach(btn => {
          btn.onclick = async () => {
            if (confirm('Delete this alias?')) {
              await api(`/api/aliases/${btn.dataset.deleteAlias}`, { method: 'DELETE' });
              loadAdminTab('aliases');
              toast('Alias deleted', 'success');
            }
          };
        });
      } catch (err) {
        el.innerHTML = `<p>Error: ${esc(err.message)}</p>`;
      }
    } else if (tab === 'import') {
      el.innerHTML = `
        <div class="import-sections">
          <div class="import-section">
            <h3>Import Capcodes from CSV</h3>
            <p style="font-size:0.85rem;color:var(--text-dim);margin-bottom:0.75rem">
              Bulk import pager capcodes with aliases. CSV format: <code>Capcode,Alias,Colour,Icon,CallType,Location,Notes</code>
              Only Capcode and Alias are required. The first row must be a header.
            </p>
            <textarea id="import-capcode-csv" rows="8" placeholder="Capcode,Alias,Colour,Icon,CallType,Location,Notes&#10;1234567,MATAFRU,#f59e0b,radio,MIN,Matamata," style="width:100%;font-family:monospace;font-size:0.8rem;padding:0.5rem;background:var(--bg-secondary);border:1px solid var(--border);border-radius:4px;color:var(--text);resize:vertical"></textarea>
            <div style="display:flex;gap:0.5rem;margin-top:0.5rem;align-items:center;flex-wrap:wrap">
              <button class="btn btn-sm btn-primary" id="btn-import-capcodes">Import Capcodes</button>
              <select id="import-capcode-mode" class="filter-select" style="font-size:0.8rem">
                <option value="upsert">Upsert (update existing)</option>
                <option value="insert">Insert only (skip existing)</option>
              </select>
              <input type="file" id="import-capcode-file" accept=".csv,.tsv,.txt" style="font-size:0.8rem">
            </div>
            <div id="import-capcode-result" style="margin-top:0.75rem;font-size:0.85rem"></div>
          </div>

          <div class="import-section" style="margin-top:1.5rem">
            <h3>Create Group from CSV (Capcodes + Aliases)</h3>
            <p style="font-size:0.85rem;color:var(--text-dim);margin-bottom:0.75rem">
              Create a new group and populate it with capcodes + aliases in one step.
              CSV format: <code>Capcode,Alias,Colour,Icon,Notes</code>
            </p>
            <div class="form-group"><label>Group Name</label><input type="text" id="import-group-name" placeholder="e.g. Taranaki Region"></div>
            <div class="form-group"><label>Description</label><input type="text" id="import-group-desc" placeholder="e.g. All Taranaki fire capcodes"></div>
            <div class="form-group"><label>Colour</label><input type="color" id="import-group-colour" value="#3b82f6" style="width:60px;height:32px;padding:2px"></div>
            <textarea id="import-group-csv" rows="8" placeholder="Capcode,Alias,Colour,Icon,Notes&#10;1234567,NEWPLY,#3b82f6,radio,Min,New Plymouth&#10;7654321,WAITARA,#2563eb,radio,Min,Waitara" style="width:100%;font-family:monospace;font-size:0.8rem;padding:0.5rem;background:var(--bg-secondary);border:1px solid var(--border);border-radius:4px;color:var(--text);resize:vertical"></textarea>
            <div style="display:flex;gap:0.5rem;margin-top:0.5rem;align-items:center;flex-wrap:wrap">
              <button class="btn btn-sm btn-primary" id="btn-import-group">Create Group & Import</button>
              <input type="file" id="import-group-file" accept=".csv,.tsv,.txt" style="font-size:0.8rem">
            </div>
            <div id="import-group-result" style="margin-top:0.75rem;font-size:0.85rem"></div>
          </div>

          <div class="import-section" style="margin-top:1.5rem">
            <h3>Add Capcodes to Existing Group</h3>
            <p style="font-size:0.85rem;color:var(--text-dim);margin-bottom:0.75rem">
              Add a list of capcodes to an existing group. One capcode per line, or CSV with a Capcode column.
            </p>
            <div class="form-group"><label>Group</label><select id="import-addcap-group" class="filter-select" style="width:100%"></select></div>
            <textarea id="import-addcap-csv" rows="6" placeholder="Capcode&#10;1234567&#10;7654321" style="width:100%;font-family:monospace;font-size:0.8rem;padding:0.5rem;background:var(--bg-secondary);border:1px solid var(--border);border-radius:4px;color:var(--text);resize:vertical"></textarea>
            <div style="display:flex;gap:0.5rem;margin-top:0.5rem;align-items:center;flex-wrap:wrap">
              <button class="btn btn-sm btn-primary" id="btn-addcap-to-group">Add to Group</button>
              <input type="file" id="import-addcap-file" accept=".csv,.tsv,.txt" style="font-size:0.8rem">
            </div>
            <div id="import-addcap-result" style="margin-top:0.75rem;font-size:0.85rem"></div>
          </div>
        </div>
      `;

      // Populate group dropdowns
      const groupSelect = el.querySelector('#import-addcap-group');
      for (const g of state.groups) {
        groupSelect.innerHTML += `<option value="${g.id}">${esc(g.name)}</option>`;
      }

      // File input handlers
      el.querySelector('#import-capcode-file').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => { el.querySelector('#import-capcode-csv').value = ev.target.result; };
        reader.readAsText(file);
      });
      el.querySelector('#import-group-file').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => { el.querySelector('#import-group-csv').value = ev.target.result; };
        reader.readAsText(file);
      });
      el.querySelector('#import-addcap-file').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => { el.querySelector('#import-addcap-csv').value = ev.target.result; };
        reader.readAsText(file);
      });

      // Import capcodes
      el.querySelector('#btn-import-capcodes').addEventListener('click', async () => {
        const csv = el.querySelector('#import-capcode-csv').value.trim();
        const mode = el.querySelector('#import-capcode-mode').value;
        if (!csv) return toast('CSV data required', 'error');
        const resultEl = el.querySelector('#import-capcode-result');
        resultEl.textContent = 'Importing...';
        try {
          const result = await api('/api/admin/capcodes/import', {
            method: 'POST',
            body: JSON.stringify({ csv, mode }),
          });
          resultEl.innerHTML = `<span style="color:var(--success)">Imported: ${result.imported}</span> | Skipped: ${result.skipped}${result.errors && result.errors.length ? '<br>Errors: ' + result.errors.slice(0, 10).join('<br>') : ''}`;
          await refreshAliasesAndRerender();
          toast('Capcodes imported', 'success');
        } catch (err) {
          resultEl.innerHTML = `<span style="color:var(--danger)">Error: ${esc(err.message)}</span>`;
        }
      });

      // Create group with capcodes
      el.querySelector('#btn-import-group').addEventListener('click', async () => {
        const name = el.querySelector('#import-group-name').value.trim();
        const desc = el.querySelector('#import-group-desc').value.trim();
        const colour = el.querySelector('#import-group-colour').value;
        const csv = el.querySelector('#import-group-csv').value.trim();
        if (!name) return toast('Group name required', 'error');
        if (!csv) return toast('CSV data required', 'error');
        const resultEl = el.querySelector('#import-group-result');
        resultEl.textContent = 'Creating group...';
        try {
          const result = await api('/api/admin/groups/create-with-capcodes', {
            method: 'POST',
            body: JSON.stringify({ name, description: desc, colour, csv }),
          });
          resultEl.innerHTML = `<span style="color:var(--success)">Group created (ID: ${result.group_id}). Capcodes: ${result.capcodes_added}, Aliases: ${result.aliases_created}</span>`;
          await loadInitialData();
          toast('Group created with capcodes', 'success');
        } catch (err) {
          resultEl.innerHTML = `<span style="color:var(--danger)">Error: ${esc(err.message)}</span>`;
        }
      });

      // Add capcodes to existing group
      el.querySelector('#btn-addcap-to-group').addEventListener('click', async () => {
        const groupId = el.querySelector('#import-addcap-group').value;
        const csv = el.querySelector('#import-addcap-csv').value.trim();
        if (!groupId) return toast('Select a group', 'error');
        if (!csv) return toast('Capcode data required', 'error');
        const resultEl = el.querySelector('#import-addcap-result');
        resultEl.textContent = 'Adding capcodes...';
        try {
          const result = await api('/api/admin/groups/capcodes/import', {
            method: 'POST',
            body: JSON.stringify({ group_id: groupId, csv }),
          });
          resultEl.innerHTML = `<span style="color:var(--success)">Added: ${result.inserted} of ${result.total} capcodes</span>`;
          await loadInitialData();
          toast('Capcodes added to group', 'success');
        } catch (err) {
          resultEl.innerHTML = `<span style="color:var(--danger)">Error: ${esc(err.message)}</span>`;
        }
      });
    } else if (tab === 'backups') {
      el.innerHTML = `
        <div style="display:flex;gap:0.5rem;margin-bottom:1rem;align-items:center;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" id="btn-create-backup">Create Backup</button>
          <button class="btn btn-sm btn-secondary" id="btn-refresh-backups">Refresh</button>
        </div>
        <p style="font-size:0.85rem;color:var(--text-dim);margin-bottom:0.75rem">
          Full SQLite database backups. Backups are created online (no downtime) and stored in the data directory.
          Old backups are automatically pruned (keep last 30 by default).
        </p>
        <div id="backups-list">Loading...</div>
      `;

      async function loadBackupsList() {
        const listEl = el.querySelector('#backups-list');
        try {
          const data = await api('/api/admin/backups');
          if (!data.backups || data.backups.length === 0) {
            listEl.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:2rem 0">No backups yet. Click "Create Backup" to make one.</p>';
            return;
          }
          listEl.innerHTML = `
            <table class="admin-table">
              <thead><tr><th>Filename</th><th>Size</th><th>Created</th><th>Actions</th></tr></thead>
              <tbody>
                ${data.backups.map(b => `
                  <tr>
                    <td class="mono">${esc(b.filename)}</td>
                    <td>${(b.size / 1024 / 1024).toFixed(2)} MB</td>
                    <td>${formatDateTime(b.created_at)}</td>
                    <td class="admin-actions">
                      <button class="btn btn-sm btn-danger" data-delete-backup="${esc(b.filename)}">Delete</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `;
          listEl.querySelectorAll('[data-delete-backup]').forEach(btn => {
            btn.onclick = async () => {
              if (!confirm(`Delete backup "${btn.dataset.deleteBackup}"?`)) return;
              await api(`/api/admin/backups/${encodeURIComponent(btn.dataset.deleteBackup)}`, { method: 'DELETE' });
              loadBackupsList();
              toast('Backup deleted', 'success');
            };
          });
        } catch (err) {
          listEl.innerHTML = `<p style="color:var(--danger)">Error: ${esc(err.message)}</p>`;
        }
      }

      el.querySelector('#btn-create-backup').onclick = async () => {
        const btn = el.querySelector('#btn-create-backup');
        btn.disabled = true;
        btn.textContent = 'Creating...';
        try {
          const result = await api('/api/admin/backup', { method: 'POST' });
          toast(`Backup created: ${result.backup_file}`, 'success');
          loadBackupsList();
        } catch (err) {
          toast('Backup failed: ' + err.message, 'error');
        }
        btn.disabled = false;
        btn.textContent = 'Create Backup';
      };

      el.querySelector('#btn-refresh-backups').onclick = loadBackupsList;

      loadBackupsList();
    } else if (tab === 'users') {
      try {
        const users = await api('/api/admin/users');
        el.innerHTML = `
          <div style="margin-bottom:0.75rem"><button class="btn btn-primary btn-sm" id="btn-add-user">Add User</button></div>
          <table class="admin-table">
            <thead><tr><th>Username</th><th>Role</th><th>PW Change</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>
              ${users.map(u => `
                <tr>
                  <td>${esc(u.username)}</td>
                  <td>${esc(u.role)}</td>
                  <td>${u.must_change_password ? '<span style="color:var(--warning)">Pending</span>' : ''}</td>
                  <td>${esc(u.created_at)}</td>
                  <td class="admin-actions">
                    <button class="btn btn-sm" data-toggle-role="${u.id}" data-role="${u.role}">${u.role === 'admin' ? 'Make User' : 'Make Admin'}</button>
                    <button class="btn btn-sm btn-danger" data-delete-user="${u.id}" ${u.id === state.user.id ? 'disabled' : ''}>Delete</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
        el.querySelector('#btn-add-user').onclick = () => showAddUserModal();
        el.querySelectorAll('[data-toggle-role]').forEach(btn => {
          btn.onclick = async () => {
            const newRole = btn.dataset.role === 'admin' ? 'user' : 'admin';
            await api(`/api/admin/users/${btn.dataset.toggleRole}/role`, {
              method: 'PUT', body: JSON.stringify({ role: newRole })
            });
            loadAdminTab('users');
          };
        });
        el.querySelectorAll('[data-delete-user]').forEach(btn => {
          btn.onclick = async () => {
            if (confirm('Delete this user?')) {
              await api(`/api/admin/users/${btn.dataset.deleteUser}`, { method: 'DELETE' });
              loadAdminTab('users');
              toast('User deleted', 'success');
            }
          };
        });
      } catch (err) {
        el.innerHTML = `<p>Error: ${esc(err.message)}</p>`;
      }
    } else if (tab === 'settings') {
      try {
        const settings = await api('/api/admin/settings');
        el.innerHTML = `
          <div class="settings-section">
            <h3 style="margin:0 0 0.5rem 0;font-size:1rem">API Key</h3>
            <p style="font-size:0.85rem;color:var(--text-dim);margin:0 0 0.75rem 0">
              This key is used by the PDW client script to authenticate when sending messages to the server.
              Set the <code>X-API-Key</code> header to this value in your client.
            </p>
            <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
              <input type="text" id="settings-api-key" value="${esc(settings.api_key || '')}" readonly
                style="flex:1;min-width:200px;font-family:monospace;font-size:0.85rem;padding:0.5rem;background:var(--bg-secondary);border:1px solid var(--border);border-radius:4px;color:var(--text)">
              <button class="btn btn-sm" id="btn-copy-api-key">Copy</button>
              <button class="btn btn-sm btn-danger" id="btn-regenerate-api-key">Regenerate</button>
            </div>
          </div>
          <div class="settings-section" style="margin-top:1.5rem">
            <h3 style="margin:0 0 0.5rem 0;font-size:1rem">Push Notifications</h3>
            <p style="font-size:0.85rem;color:var(--text-dim);margin:0 0 0.75rem 0">
              Test that push notifications are working. You must first click the bell icon in the top bar to subscribe.
              Push requires HTTPS (access via your domain, not direct IP).
            </p>
            <button class="btn btn-sm btn-primary" id="btn-test-push">Test Push Notification</button>
          </div>
        `;
        el.querySelector('#btn-copy-api-key').onclick = () => {
          const input = el.querySelector('#settings-api-key');
          navigator.clipboard.writeText(input.value).then(() => {
            toast('API key copied to clipboard', 'success');
          }).catch(() => {
            input.select();
            document.execCommand('copy');
            toast('API key copied', 'success');
          });
        };
        el.querySelector('#btn-regenerate-api-key').onclick = async () => {
          if (!confirm('Regenerate the API key? Any existing clients using the old key will stop working until updated.')) return;
          try {
            const result = await api('/api/admin/settings/regenerate-api-key', { method: 'POST' });
            el.querySelector('#settings-api-key').value = result.api_key;
            toast('API key regenerated', 'success');
          } catch (err) {
            toast('Failed to regenerate: ' + err.message, 'error');
          }
        };
      } catch (err) {
        el.innerHTML = `<p>Error: ${esc(err.message)}</p>`;
      }
    } else if (tab === 'logs') {
      try {
        const data = await api('/api/admin/error-log?limit=100');
        el.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap;gap:0.5rem">
            <span style="font-size:0.85rem;color:var(--text-dim)">${data.total} total log entries</span>
            <button class="btn btn-sm btn-danger" id="btn-clear-logs">Clear All Logs</button>
          </div>
          ${data.logs.length === 0 ? '<p style="color:var(--text-dim);text-align:center;padding:2rem 0">No errors logged</p>' : `
          <div class="log-list">
            ${data.logs.map(log => `
              <div class="log-entry log-${esc(log.level)}">
                <div class="log-header">
                  <span class="log-level-badge log-level-${esc(log.level)}">${esc(log.level.toUpperCase())}</span>
                  <span class="log-source">${esc(log.source)}</span>
                  <span class="log-time">${formatDateTime(log.created_at)}</span>
                </div>
                <div class="log-message">${esc(log.message)}</div>
                ${log.stack ? `<details class="log-stack"><summary>Stack trace</summary><pre>${esc(log.stack)}</pre></details>` : ''}
                ${log.context ? `<details class="log-context"><summary>Context</summary><pre>${esc(log.context)}</pre></details>` : ''}
              </div>
            `).join('')}
          </div>`}
        `;
        el.querySelector('#btn-clear-logs').onclick = async () => {
          if (!confirm('Clear all error logs?')) return;
          try {
            await api('/api/admin/error-log', { method: 'DELETE' });
            toast('Logs cleared', 'success');
            loadAdminTab('logs');
          } catch (err) {
            toast('Failed to clear: ' + err.message, 'error');
          }
        };
      } catch (err) {
        el.innerHTML = `<p>Error: ${esc(err.message)}</p>`;
      }
    }
  }

  // ─── Modals ───
  function showModal(title, bodyHtml, footerHtml) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = bodyHtml;
    $('#modal-footer').innerHTML = footerHtml || '';
    $('#modal-overlay').classList.remove('hidden');
  }

  function hideModal() {
    $('#modal-overlay').classList.add('hidden');
  }

  async function showGroupModal(editId) {
    let group = null;
    let members = [];
    let keywords = [];
    if (editId) {
      group = await api(`/api/groups/${editId}`);
      members = group.members || [];
      keywords = group.keywords || [];
    }
    showModal(editId ? 'Edit Group' : 'Add Group', `
      <div class="form-group"><label>Name</label><input type="text" id="group-name" value="${esc(group ? group.name : '')}"></div>
      <div class="form-group"><label>Description</label><textarea id="group-desc">${esc(group ? group.description : '')}</textarea></div>
      <div class="form-group"><label>Colour</label><input type="color" id="group-colour" value="${group ? group.colour : '#3b82f6'}" style="width:60px;height:32px;padding:2px"></div>
      <div class="form-group"><label>Capcodes (one per line)</label><textarea id="group-capcodes" rows="5" placeholder="1234567\n7654321">${members.map(m => m.capcode).join('\n')}</textarea></div>
      <div class="form-group"><label>Keywords (one per line) — match messages containing these words (e.g. suburb names)</label><textarea id="group-keywords" rows="4" placeholder="Picton\nBlenheim\nWairau Valley">${keywords.map(k => k.keyword).join('\n')}</textarea></div>
    `, `
      <button class="btn" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save">Save</button>
    `);
    $('#modal-cancel').onclick = hideModal;
    $('#modal-save').onclick = async () => {
      const name = $('#group-name').value.trim();
      const description = $('#group-desc').value.trim();
      const colour = $('#group-colour').value;
      const capcodes = $('#group-capcodes').value.split('\n').map(c => c.trim()).filter(Boolean);
      const kwList = $('#group-keywords').value.split('\n').map(k => k.trim()).filter(Boolean);
      if (!name) return toast('Name required', 'error');
      try {
        const body = { name, description, colour, capcodes, keywords: kwList };
        if (editId) {
          await api(`/api/groups/${editId}`, { method: 'PUT', body: JSON.stringify(body) });
        } else {
          await api('/api/groups', { method: 'POST', body: JSON.stringify(body) });
        }
        hideModal();
        await loadInitialData();
        if (state.currentView === 'admin') loadAdminTab('groups');
        renderFilterOptions();
        toast('Group saved', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  async function showAliasModal(editCapcode) {
    let alias = null;
    let aliasGroups = [];
    if (editCapcode) {
      const aliases = await api('/api/aliases');
      alias = aliases.find(a => a.capcode === editCapcode);
      if (alias && alias.groups) aliasGroups = alias.groups.map(g => g.group_id);
    }

    // Build group checkboxes
    const groupCheckboxes = state.groups.map(g => {
      const checked = aliasGroups.includes(g.id) ? 'checked' : '';
      return `<label class="checkbox-label"><input type="checkbox" value="${g.id}" class="alias-group-cb" ${checked}> <span class="colour-dot" style="background:${esc(g.colour)}"></span>${esc(g.name)}</label>`;
    }).join('');

    const hiddenChecked = alias && alias.hidden ? 'checked' : '';

    showModal(editCapcode && alias ? 'Edit Alias' : (editCapcode ? 'Add Alias for ' + editCapcode : 'Add Alias'), `
      <div class="form-group"><label>Capcode</label><input type="text" id="alias-capcode" value="${esc(editCapcode || (alias ? alias.capcode : ''))}" ${editCapcode ? 'readonly' : ''}></div>
      <div class="form-group"><label>Alias Name (e.g. truck/unit name)</label><input type="text" id="alias-name" value="${esc(alias ? alias.alias : '')}" placeholder="e.g. MATAFRU, TAUP217"></div>
      <div class="form-group"><label>Notes</label><input type="text" id="alias-notes" value="${esc(alias ? alias.notes || '' : '')}" placeholder="e.g. Matamata Rural Fire Unit"></div>
      <div class="form-group"><label>Colour</label><input type="color" id="alias-colour" value="${alias ? alias.colour : '#6b7280'}" style="width:60px;height:32px;padding:2px"></div>
      <div class="form-group"><label>Default Call Type</label><input type="text" id="alias-calltype" value="${esc(alias ? alias.call_type || '' : '')}" placeholder="e.g. AMBO, MIN"></div>
      <div class="form-group"><label>Default Location</label><input type="text" id="alias-location" value="${esc(alias ? alias.location || '' : '')}" placeholder="e.g. Wellington"></div>
      <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="alias-hidden" ${hiddenChecked}> Hidden — hide all messages from this capcode (filter out junk/unrelated pages)</label></div>
      <div class="form-group"><label>Groups</label><div class="checkbox-group">${groupCheckboxes || '<span style="color:var(--text-muted);font-size:0.8rem">No groups created yet</span>'}</div></div>
    `, `
      <button class="btn" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save">Save</button>
    `);
    $('#modal-cancel').onclick = hideModal;
    $('#modal-save').onclick = async () => {
      const capcode = $('#alias-capcode').value.trim();
      const name = $('#alias-name').value.trim();
      if (!capcode || !name) return toast('Capcode and alias required', 'error');

      // Collect selected groups
      const groupIds = Array.from($$('.alias-group-cb:checked')).map(cb => parseInt(cb.value, 10));

      try {
        await api('/api/aliases', {
          method: 'POST',
          body: JSON.stringify({
            capcode,
            alias: name,
            notes: $('#alias-notes').value.trim() || null,
            colour: $('#alias-colour').value,
            call_type: $('#alias-calltype').value.trim() || null,
            location: $('#alias-location').value.trim() || null,
            group_ids: groupIds,
            hidden: $('#alias-hidden').checked,
          })
        });
        // Refresh aliases in state and re-render live messages
        await refreshAliasesAndRerender();
        hideModal();
        if (state.currentView === 'admin') loadAdminTab('aliases');
        toast('Alias saved', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  function showAddUserModal() {
    showModal('Add User', `
      <div class="form-group"><label>Username</label><input type="text" id="new-username"></div>
      <div class="form-group"><label>Password</label><input type="password" id="new-password"></div>
      <div class="form-group"><label>Role</label><select id="new-role"><option value="user">User</option><option value="admin">Admin</option></select></div>
      <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="new-must-change-pw" checked> Require password change on first login</label></div>
    `, `
      <button class="btn" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save">Create</button>
    `);
    $('#modal-cancel').onclick = hideModal;
    $('#modal-save').onclick = async () => {
      const username = $('#new-username').value.trim();
      const password = $('#new-password').value;
      const role = $('#new-role').value;
      const mustChangePw = $('#new-must-change-pw').checked;
      if (!username || !password) return toast('Username and password required', 'error');
      try {
        await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password, role, must_change_password: mustChangePw }) });
        hideModal();
        loadAdminTab('users');
        toast('User created', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  function showChangePasswordModal() {
    showModal('Change Password', `
      <div class="form-group"><label>Current Password</label><input type="password" id="cur-password"></div>
      <div class="form-group"><label>New Password</label><input type="password" id="new-pw"></div>
    `, `
      <button class="btn" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save">Change</button>
    `);
    $('#modal-cancel').onclick = hideModal;
    $('#modal-save').onclick = async () => {
      const curPw = $('#cur-password').value;
      const newPw = $('#new-pw').value;
      if (!curPw || !newPw) return toast('Both passwords required', 'error');
      if (newPw.length < 8) return toast('Password must be at least 8 characters', 'error');
      try {
        await api('/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({ currentPassword: curPw, newPassword: newPw })
        });
        hideModal();
        toast('Password changed', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  function showForceChangePasswordModal() {
    showModal('Change Your Password', `
      <p style="font-size:0.85rem;color:var(--text-dim);margin-bottom:0.75rem">
        Your account requires a password change before you can continue. Please set a new password.
      </p>
      <div class="form-group"><label>Current Password</label><input type="password" id="force-cur-pw"></div>
      <div class="form-group"><label>New Password</label><input type="password" id="force-new-pw"></div>
      <div class="form-group"><label>Confirm New Password</label><input type="password" id="force-confirm-pw"></div>
    `, `
      <button class="btn btn-primary" id="modal-save">Change Password</button>
    `);
    // Prevent closing without changing password
    $('#modal-close').onclick = null;
    $('#modal-overlay').onclick = null;
    $('#modal-save').onclick = async () => {
      const curPw = $('#force-cur-pw').value;
      const newPw = $('#force-new-pw').value;
      const confirmPw = $('#force-confirm-pw').value;
      if (!curPw || !newPw) return toast('All fields required', 'error');
      if (newPw !== confirmPw) return toast('New passwords do not match', 'error');
      if (newPw.length < 8) return toast('Password must be at least 8 characters', 'error');
      try {
        await api('/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({ currentPassword: curPw, newPassword: newPw })
        });
        state.user.must_change_password = false;
        hideModal();
        // Restore normal modal close behaviour
        $('#modal-close').onclick = hideModal;
        $('#modal-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) hideModal(); });
        toast('Password changed successfully', 'success');
        // Show disclaimer if needed
        if (!localStorage.getItem('pdw_disclaimer_accepted')) {
          showDisclaimerModal();
        }
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  function showSaveFilterModal() {
    showModal('Save Filter', `
      <div class="form-group"><label>Filter Name</label><input type="text" id="filter-name" placeholder="e.g. Wellington Fires"></div>
    `, `
      <button class="btn" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save">Save</button>
    `);
    $('#modal-cancel').onclick = hideModal;
    $('#modal-save').onclick = async () => {
      const name = $('#filter-name').value.trim();
      if (!name) return toast('Name required', 'error');
      const filter = {};
      if ($('#filter-search').value) filter.search = $('#filter-search').value;
      if ($('#filter-call-type').value) filter.call_type = $('#filter-call-type').value;
      if ($('#filter-protocol').value) filter.protocol = $('#filter-protocol').value;
      if ($('#filter-region').value) filter.region = $('#filter-region').value;
      if ($('#filter-capcode').value) filter.capcode = $('#filter-capcode').value;
      if ($('#filter-location').value) filter.location = $('#filter-location').value;
      if ($('#filter-trucks').value) filter.trucks = $('#filter-trucks').value;
      if ($('#filter-group').value) filter.group_id = $('#filter-group').value;
      if ($('#filter-date-from') && $('#filter-date-from').value) filter.date_from = $('#filter-date-from').value;
      if ($('#filter-date-to') && $('#filter-date-to').value) filter.date_to = $('#filter-date-to').value;
      try {
        await api('/api/filters', { method: 'POST', body: JSON.stringify({ name, filter }) });
        const filters = await api('/api/filters');
        state.filters = filters;
        renderSidebar();
        hideModal();
        toast('Filter saved', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  // ─── Keyword alert modal ───
  function showAddKeywordModal() {
    const groupOptions = state.groups.map(g =>
      `<option value="${g.id}">${esc(g.name)}</option>`
    ).join('');
    showModal('Add Keyword Alert', `
      <p style="font-size:0.85rem;color:var(--text-dim);margin-bottom:0.75rem">
        Get an in-app alert (with sound) when a message contains this keyword or address.
        Optionally scope it to a specific group/region.
      </p>
      <div class="form-group"><label>Keyword or Address</label><input type="text" id="keyword-input" placeholder="e.g. 3rd alarm, 123 Main St"></div>
      <div class="form-group">
        <label>Scope to Group (optional)</label>
        <select id="keyword-group-select" class="filter-select" style="width:100%">
          <option value="">All Groups (any page)</option>
          ${groupOptions}
        </select>
        <p style="font-size:0.75rem;color:var(--text-muted);margin-top:0.25rem">Only alert when keyword appears in pages from this group</p>
      </div>
    `, `
      <button class="btn" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save">Add Alert</button>
    `);
    $('#modal-cancel').onclick = hideModal;
    $('#modal-save').onclick = async () => {
      const keyword = $('#keyword-input').value.trim();
      if (!keyword) return toast('Keyword required', 'error');
      const groupId = $('#keyword-group-select').value || null;
      try {
        await api('/api/keyword-alerts', { method: 'POST', body: JSON.stringify({ keyword, group_id: groupId }) });
        state.keywordAlerts = await api('/api/keyword-alerts');
        renderSidebar();
        hideModal();
        toast('Keyword alert added', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  // ─── Check if we're on a secure context (HTTPS or localhost) ───
  function isSecureContext() {
    return window.isSecureContext ||
           location.protocol === 'https:' ||
           location.hostname === 'localhost' ||
           location.hostname === '127.0.0.1';
  }

  // ─── Push notifications ───
  async function toggleNotifications() {
    // Check if already subscribed - if so, disable
    try {
      if (isSecureContext() && 'serviceWorker' in navigator && 'PushManager' in window) {
        const reg = await navigator.serviceWorker.getRegistration('/');
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            // Currently enabled - disable
            await disableNotifications(sub);
            return;
          }
        }
      }
    } catch { /* Fall through to enable */ }
    // Not subscribed - enable
    await enableNotifications();
  }

  async function disableNotifications(sub) {
    try {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await api('/api/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint }) });
      toast('Push notifications disabled.', 'info');
      updateNotificationBell();
    } catch (err) {
      toast('Failed to disable notifications: ' + err.message, 'error');
    }
  }

  async function enableNotifications() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    // 1. Check secure context (HTTPS required for push)
    if (!isSecureContext()) {
      toast('Push notifications require HTTPS. Access via your domain (e.g. pager.turt.dev) instead of IP. In-app alerts still work here.', 'info');
      return;
    }

    // 2. Check service worker support
    if (!('serviceWorker' in navigator)) {
      toast('Your browser does not support push notifications. Try Chrome, Edge, or Firefox.', 'error');
      return;
    }

    // 3. Check Notification API
    if (!('Notification' in window)) {
      if (isIOS) {
        toast('For push notifications on iOS: tap Share > "Add to Home Screen", then open from there and tap this bell again.', 'info');
      } else {
        toast('Notifications not available in this browser. In-app alerts with sound still work.', 'info');
      }
      return;
    }

    // 4. Check PushManager
    if (!('PushManager' in window)) {
      if (isSafari && !isIOS) {
        toast('Safari on Mac supports push when added as a web app. Try Chrome for easiest setup, or use Dock > Add to Dock.', 'info');
      } else if (isIOS) {
        toast('For push on iOS: tap Share > "Add to Home Screen", then open from there and tap this bell again.', 'info');
      } else {
        toast('Push not supported in this browser. Try Chrome or Edge. In-app alerts still work.', 'info');
      }
      return;
    }

    // 5. Request notification permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      toast('Notification permission denied. Check your browser settings to allow notifications for this site.', 'error');
      return;
    }

    // 6. Ensure service worker is registered and ready
    try {
      // Register SW if not already
      let reg = await navigator.serviceWorker.getRegistration('/');
      if (!reg) {
        reg = await navigator.serviceWorker.register('/sw.js');
      }
      // Wait for it to be ready with a timeout
      const readyPromise = navigator.serviceWorker.ready;
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Service worker not ready')), 10000)
      );
      reg = await Promise.race([readyPromise, timeoutPromise]);

      // 7. Get VAPID key and subscribe
      const { publicKey } = await api('/api/push/vapid-key');
      if (!publicKey) {
        toast('Push not configured on server (VAPID keys missing). Contact your admin.', 'error');
        return;
      }

      // Clear any stale browser-side subscription before subscribing fresh.
      // Required when VAPID keys changed (container rebuild) — browser holds an old Apple/FCM token
      // that conflicts with the new key, causing "Registration failed - push service error".
      const existingSub = await reg.pushManager.getSubscription();
      if (existingSub) {
        await existingSub.unsubscribe();
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
      toast('Push notifications enabled! You will receive alerts even when the app is closed.', 'success');
      updateNotificationBell();
    } catch (err) {
      console.error('Push setup failed:', err);
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const msg = err.message || '';
      if (isIOS && (msg.includes('Registration failed') || msg.includes('push service'))) {
        toast('Push failed. On iOS, open the app from your Home Screen icon (not Safari). Tap Share → "Add to Home Screen" first.', 'error');
      } else {
        toast('Push setup failed: ' + (msg || 'unknown error') + '. In-app alerts with sound still work.', 'error');
      }
    }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  // ─── Favourites toggle ───
  async function toggleFavourite(groupId) {
    const existing = state.favourites.find(f => f.group_id === groupId);
    try {
      if (existing) {
        await api(`/api/favourites/${groupId}`, { method: 'DELETE' });
        toast('Removed from favourites', 'info');
      } else {
        await api(`/api/favourites/${groupId}`, { method: 'POST', body: JSON.stringify({ notify: true }) });
        toast('Added to favourites', 'success');
      }
      state.favourites = await api('/api/favourites');
      renderSidebar();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ─── View switching ───
  function switchView(view) {
    state.currentView = view;
    $$('.view').forEach(v => v.classList.remove('active'));
    $(`#view-${view}`).classList.add('active');
    $$('.nav-item[data-view]').forEach(n => n.classList.toggle('active', n.dataset.view === view));

    if (view === 'stats') loadStats();
    if (view === 'notifications') loadNotifications();
    if (view === 'admin') loadAdminTab(state.currentAdminTab);
    if (view === 'search') doSearch(0);
  }

  // ─── Sidebar toggle ───
  function openSidebar() {
    $('#sidebar').classList.add('open');
    $('#sidebar-overlay').classList.add('active');
  }
  function closeSidebar() {
    $('#sidebar').classList.remove('open');
    $('#sidebar-overlay').classList.remove('active');
  }

  // ─── Auth ───
  async function handleLogin(e) {
    e.preventDefault();
    const username = $('#login-username').value.trim();
    const password = $('#login-password').value;
    try {
      const result = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error);
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('pdw_token', data.token);
      storeTokenForSW(data.token);
      showApp();
    } catch (err) {
      const errEl = $('#login-error');
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  }

  function logout() {
    state.token = null;
    state.user = null;
    localStorage.removeItem('pdw_token');
    storeTokenForSW(null);
    disconnectWs();
    // Clear intervals to prevent memory leaks
    if (state.timeAgoInterval) {
      clearInterval(state.timeAgoInterval);
      state.timeAgoInterval = null;
    }
    if (state.autoRefreshInterval) {
      clearInterval(state.autoRefreshInterval);
      state.autoRefreshInterval = null;
    }
    $('#login-screen').classList.add('active');
    $('#app-screen').classList.remove('active');
    $('#login-error').classList.add('hidden');
  }

  async function showApp() {
    // Validate token
    try {
      state.user = await api('/api/auth/me');
    } catch {
      logout();
      return;
    }

    $('#login-screen').classList.remove('active');
    $('#app-screen').classList.add('active');
    $('#user-info').textContent = `${state.user.username} (${state.user.role})`;

    updateAppHeight();
    updateTopbarHeight();
    connectWs();
    await loadInitialData();

    // Apply default view preference
    if (state.preferences.default_view && state.preferences.default_view !== 'live') {
      switchView(state.preferences.default_view);
    }
    let hasDefaultFilter = false;
    if (state.preferences.default_group_id) {
      $('#filter-group').value = state.preferences.default_group_id;
      hasDefaultFilter = true;
    }
    if (state.preferences.default_region) {
      $('#filter-region').value = state.preferences.default_region;
      hasDefaultFilter = true;
    }
    if (hasDefaultFilter) {
      applyFilters();
    }

    // Auto-refresh live messages every 30s (catches missed WS messages)
    // Reloads the current page rather than resetting to page 1
    if (state.autoRefreshInterval) clearInterval(state.autoRefreshInterval);
    state.autoRefreshInterval = setInterval(() => {
      if (state.currentView === 'live' && !state.paused && !document.hidden) {
        loadLivePage(state.livePage);
      }
    }, 30000);

    // Auto-subscribe to push if permission already granted (ensures background notifications work)
    autoSubscribePush();
    updateNotificationBell();
    silentTokenRefresh();

    // Initialise audio player if RTL-SDR stream is configured
    initAudioPlayer();

    // Force password change if required
    if (state.user.must_change_password) {
      showForceChangePasswordModal();
    } else if (!localStorage.getItem('pdw_disclaimer_accepted')) {
      // Show first-login disclaimer if not yet accepted
      showDisclaimerModal();
    }
  }

  function showDisclaimerModal() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isAndroid = /Android/.test(navigator.userAgent);

    let installInstructions = '';
    if (isIOS) {
      installInstructions = `
        <li>Tap the <strong>Share</strong> button (box with arrow) in Safari</li>
        <li>Scroll down and tap <strong>"Add to Home Screen"</strong></li>
        <li>Tap <strong>"Add"</strong> to confirm</li>
      `;
    } else if (isAndroid) {
      installInstructions = `
        <li>Tap the <strong>menu</strong> (three dots) in Chrome</li>
        <li>Tap <strong>"Add to Home screen"</strong> or <strong>"Install app"</strong></li>
        <li>Tap <strong>"Install"</strong> to confirm</li>
      `;
    } else {
      installInstructions = `
        <li>In Chrome: click the <strong>install icon</strong> in the address bar (or Menu > "Install PDW Monitor")</li>
        <li>In Edge: click <strong>Menu > Apps > Install this site as an app</strong></li>
        <li>In Firefox: bookmark the page for quick access</li>
      `;
    }

    showModal('Welcome to PDW Monitor', `
      <div style="margin-bottom:1rem">
        <h4 style="color:var(--warning);margin-bottom:0.5rem">Important Notice</h4>
        <p style="font-size:0.85rem;line-height:1.5;color:var(--text-dim)">
          This system monitors emergency services pager traffic for informational purposes only.
          By using this system you agree that you will:
        </p>
        <ul style="font-size:0.85rem;line-height:1.6;color:var(--text-dim);margin:0.5rem 0 0 1.25rem">
          <li><strong>Not act on</strong> any information received through this system</li>
          <li><strong>Not share</strong> specific operational details publicly</li>
          <li><strong>Not attend</strong> emergency scenes based on this information</li>
          <li><strong>Not interfere</strong> with emergency services operations</li>
        </ul>
      </div>
      <div style="margin-bottom:1rem">
        <h4 style="margin-bottom:0.5rem">Install as App</h4>
        <p style="font-size:0.85rem;color:var(--text-dim);margin-bottom:0.375rem">For the best experience, install PDW Monitor as a web app:</p>
        <ol style="font-size:0.85rem;line-height:1.6;color:var(--text-dim);margin:0 0 0 1.25rem">${installInstructions}</ol>
      </div>
      <div>
        <h4 style="margin-bottom:0.5rem">Notifications</h4>
        <p style="font-size:0.85rem;line-height:1.5;color:var(--text-dim)">
          To receive push notifications for specific groups:
        </p>
        <ol style="font-size:0.85rem;line-height:1.6;color:var(--text-dim);margin:0 0 0 1.25rem">
          <li>Click the <strong>bell icon</strong> in the top bar or go to <strong>Settings</strong> to enable push</li>
          <li>Allow notifications when prompted by your browser</li>
          <li>Add groups to your <strong>Favourites</strong> in the sidebar</li>
          <li>Manage all notification toggles in <strong>Settings &gt; Notification Settings</strong></li>
        </ol>
      </div>
    `, `
      <button class="btn btn-primary" id="modal-accept-disclaimer">I Understand and Agree</button>
    `);

    const cancelBtn = $('#modal-close');
    const origClose = cancelBtn.onclick;
    // Prevent closing without accepting
    cancelBtn.onclick = null;
    $('#modal-overlay').onclick = null;

    $('#modal-accept-disclaimer').onclick = () => {
      localStorage.setItem('pdw_disclaimer_accepted', '1');
      hideModal();
      // Restore normal close behaviour
      cancelBtn.onclick = origClose;
      $('#modal-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) hideModal(); });
    };
  }

  // ─── Filter debounce ───
  let filterTimer = null;
  function onFilterChange() {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(applyFilters, 400);
  }

  // ─── Event bindings ───
  function bindEvents() {
    // Login
    $('#login-form').addEventListener('submit', handleLogin);

    // Nav toggle
    $('#nav-toggle').addEventListener('click', () => {
      if ($('#sidebar').classList.contains('open')) closeSidebar();
      else openSidebar();
    });
    $('#sidebar-overlay').addEventListener('click', closeSidebar);

    // View nav
    $$('.nav-item[data-view]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        switchView(item.dataset.view);
        closeSidebar();
      });
    });

    // User menu
    $('#btn-user-menu').addEventListener('click', (e) => {
      e.stopPropagation();
      $('#user-menu').classList.toggle('hidden');
    });
    document.addEventListener('click', () => $('#user-menu').classList.add('hidden'));
    $('#menu-logout').addEventListener('click', (e) => { e.preventDefault(); logout(); });
    $('#menu-change-pw').addEventListener('click', (e) => { e.preventDefault(); showChangePasswordModal(); });
    $('#menu-admin').addEventListener('click', (e) => { e.preventDefault(); switchView('admin'); $('#user-menu').classList.add('hidden'); });

    // Home button - go to user's default view (with default group filter)
    $('#btn-home').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Clear all filters first
      $('#filter-search').value = '';
      $('#filter-call-type').value = '';
      $('#filter-protocol').value = '';
      $('#filter-region').value = '';
      $('#filter-capcode').value = '';
      $('#filter-location').value = '';
      $('#filter-trucks').value = '';
      $('#filter-group').value = '';
      if ($('#filter-hide-test')) $('#filter-hide-test').checked = true;
      if ($('#filter-date-from')) $('#filter-date-from').value = '';
      if ($('#filter-date-to')) $('#filter-date-to').value = '';
      // Apply default group and region filters if set
      if (state.preferences.default_group_id) {
        $('#filter-group').value = state.preferences.default_group_id;
      }
      if (state.preferences.default_region) {
        $('#filter-region').value = state.preferences.default_region;
      }
      // Switch to default view
      const defaultView = state.preferences.default_view || 'live';
      // Close panels
      closeSidebar();
      hideDetail();
      // Un-pause if paused
      state.paused = false;
      $('#btn-pause').textContent = 'Pause';
      // Switch view (triggers reload for stats/search/etc)
      switchView(defaultView);
      // Always reload messages for live view (even if already on live)
      if (defaultView === 'live') {
        applyFilters();
      }
    });

    // Detail backdrop click to close
    $('#detail-backdrop').addEventListener('click', hideDetail);

    // Notifications - toggle on/off
    $('#btn-notifications').addEventListener('click', toggleNotifications);

    // Test push button (if exists - added in admin settings)
    document.addEventListener('click', async (e) => {
      if (e.target && e.target.id === 'btn-test-push') {
        e.target.disabled = true;
        e.target.textContent = 'Sending...';
        try {
          const result = await api('/api/push/test', { method: 'POST' });
          if (result.sent > 0) {
            toast(`Test notification sent! (${result.sent} delivered, ${result.failed} failed)`, 'success');
          } else {
            toast('All notifications failed: ' + (result.errors || []).join(', '), 'error');
          }
        } catch (err) {
          toast('Test failed: ' + err.message, 'error');
        }
        e.target.disabled = false;
        e.target.textContent = 'Test Push Notification';
      }
    });

    // Mobile search toggle
    $('#btn-search-toggle').addEventListener('click', () => {
      const bar = $('#search-bar');
      bar.classList.toggle('hidden-mobile');
      bar.classList.toggle('show-mobile');
      if (bar.classList.contains('show-mobile')) {
        $('#filter-search').focus();
      }
    });

    // Filters
    $('#filter-search').addEventListener('input', onFilterChange);
    $('#filter-call-type').addEventListener('change', onFilterChange);
    $('#filter-protocol').addEventListener('change', onFilterChange);
    $('#filter-region').addEventListener('change', onFilterChange);
    $('#filter-capcode').addEventListener('input', onFilterChange);
    $('#filter-location').addEventListener('input', onFilterChange);
    $('#filter-trucks').addEventListener('input', onFilterChange);
    $('#filter-group').addEventListener('change', onFilterChange);
    $('#filter-hide-test').addEventListener('change', onFilterChange);
    if ($('#filter-date-from')) $('#filter-date-from').addEventListener('change', onFilterChange);
    if ($('#filter-date-to')) $('#filter-date-to').addEventListener('change', onFilterChange);
    $('#btn-clear-filters').addEventListener('click', () => {
      $('#filter-search').value = '';
      $('#filter-call-type').value = '';
      $('#filter-protocol').value = '';
      $('#filter-region').value = '';
      $('#filter-capcode').value = '';
      $('#filter-location').value = '';
      $('#filter-trucks').value = '';
      $('#filter-group').value = '';
      $('#filter-hide-test').checked = true;
      if ($('#filter-date-from')) $('#filter-date-from').value = '';
      if ($('#filter-date-to')) $('#filter-date-to').value = '';
      // Switch to live view if not already there
      if (state.currentView !== 'live') {
        switchView('live');
      }
      applyFilters();
    });
    $('#btn-save-filter').addEventListener('click', showSaveFilterModal);

    // Live controls
    $('#toggle-autoscroll').addEventListener('change', (e) => { state.autoScroll = e.target.checked; });
    $('#btn-pause').addEventListener('click', () => {
      state.paused = !state.paused;
      $('#btn-pause').textContent = state.paused ? 'Resume' : 'Pause';
    });

    // Alarm level selector
    $('#alarm-level-select').addEventListener('change', async (e) => {
      const val = e.target.value ? parseInt(e.target.value, 10) : null;
      try {
        await api('/api/alarm-level-alert', {
          method: 'PUT',
          body: JSON.stringify({ min_alarm_level: val, group_ids: state.alarmLevelGroups }),
        });
        state.alarmLevelSetting = val;
        if (val) {
          const ordinal = val === 2 ? '2nd' : val === 3 ? '3rd' : `${val}th`;
          toast(`Alarm level alerts enabled: ${ordinal} alarm and above`, 'success');
        } else {
          toast('Alarm level alerts disabled', 'info');
        }
      } catch (err) {
        toast('Failed to update alarm level: ' + err.message, 'error');
        e.target.value = state.alarmLevelSetting || '';
      }
    });

    // Keyword alert add button
    $('#btn-add-keyword').addEventListener('click', showAddKeywordModal);

    // Stats refresh
    $('#btn-refresh-stats').addEventListener('click', loadStats);

    // Admin tabs
    $$('.admin-tab').forEach(tab => {
      tab.addEventListener('click', () => loadAdminTab(tab.dataset.tab));
    });

    // Detail panel close
    $('#detail-close').addEventListener('click', hideDetail);

    // Modal close
    $('#modal-close').addEventListener('click', hideModal);
    $('#modal-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) hideModal();
    });

    // Update time-ago labels periodically (stored on state for cleanup)
    state.timeAgoInterval = setInterval(() => {
      $$('.msg-time').forEach(el => {
        const card = el.closest('.msg-card');
        if (!card) return;
        const id = card.dataset.id;
        const msg = state.messages.find(m => m.id == id);
        if (msg) el.textContent = timeAgo(msg.received_at);
      });
    }, 30000);
  }

  // ─── Service worker registration ───
  async function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    // Service workers require a secure context (HTTPS or localhost)
    if (!isSecureContext()) {
      console.log('Skipping SW registration: not a secure context (HTTPS required)');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      // Check for updates periodically (every 30 min)
      setInterval(() => reg.update(), 30 * 60 * 1000);
    } catch (err) {
      console.warn('SW registration failed:', err);
    }
  }

  // ─── Update notification bell icon to show active state ───
  async function updateNotificationBell() {
    try {
      const bell = $('#btn-notifications');
      if (!bell) return;
      if (!isSecureContext() || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        bell.classList.remove('notifications-active');
        bell.classList.add('notifications-off');
        bell.title = 'Notifications not available';
        return;
      }
      if (Notification.permission !== 'granted') {
        bell.classList.remove('notifications-active');
        bell.classList.add('notifications-off');
        bell.title = 'Click to enable notifications';
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration('/');
      if (!reg) return;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        bell.classList.add('notifications-active');
        bell.classList.remove('notifications-off');
        bell.title = 'Notifications ON - click to disable';
      } else {
        bell.classList.remove('notifications-active');
        bell.classList.add('notifications-off');
        bell.title = 'Notifications OFF - click to enable';
      }
    } catch { /* ignore */ }
  }

  // ─── Auto-subscribe to push if permission already granted ───
  async function autoSubscribePush() {
    try {
      if (!isSecureContext()) return;
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;
      const reg = await navigator.serviceWorker.getRegistration('/');
      if (!reg || !reg.active) return;
      const existing = await reg.pushManager.getSubscription();
      const { publicKey } = await api('/api/push/vapid-key');
      if (!publicKey) return;
      let sub = existing;
      // Detect VAPID key mismatch (e.g. after container rebuild) and force re-subscribe
      if (existing && existing.options?.applicationServerKey) {
        const oldKey = new Uint8Array(existing.options.applicationServerKey);
        const newKey = urlBase64ToUint8Array(publicKey);
        if (oldKey.length !== newKey.length || oldKey.some((b, i) => b !== newKey[i])) {
          await existing.unsubscribe();
          sub = null;
        }
      }
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }
      await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
      console.log('Push subscription synced');
    } catch (err) {
      console.warn('Auto push subscribe failed:', err.message);
    }
  }

  // ─── Audio Player ───
  const audioState = {
    available: false,
    playing: false,
    muted: false,
    volume: parseFloat(localStorage.getItem('pdw_audio_vol') || '0.8'),
    freq: '',
    mode: '',
    statusPollTimer: null,
    el: null,       // the <audio> element
    audioCtx: null, // Web Audio API context
    analyser: null, // AnalyserNode for level metering
    levelRaf: null, // requestAnimationFrame handle
  };

  async function initAudioPlayer() {
    try {
      const resp = await fetch('/api/audio/status');
      const data = await resp.json();
      if (!data.available) return;
      audioState.available = true;
      audioState.freq = data.freq || '';

      const bar = $('#audio-player');
      bar.classList.remove('hidden');
      document.getElementById('app-screen').classList.add('audio-player-visible');

      // Show admin controls for admins
      if (state.user && state.user.role === 'admin') {
        bar.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
      }

      updateAudioFreqLabel(data.freq);
      updateAudioDot('ready');
      updateListenerCount(data.clients);

      // Create persistent <audio> element
      if (!audioState.el) {
        audioState.el = new Audio();
        audioState.el.preload = 'none';
        audioState.el.volume = audioState.volume;
        audioState.el.muted = audioState.muted;

        // State is set immediately in toggleAudioPlay() so users see
        // "connected" even when squelch gates the audio (no MP3 data).
        // These listeners handle unexpected disconnects / errors.
        audioState.el.addEventListener('error',  () => {
          if (!audioState.playing) return;
          audioState.playing = false;
          updateAudioDot('error');
          setPlayBtnState(false);
          stopLevelMeter();
        });
        audioState.el.addEventListener('ended', () => {
          if (!audioState.playing) return;
          audioState.playing = false;
          updateAudioDot('ready');
          setPlayBtnState(false);
          stopLevelMeter();
        });
      }
      $('#audio-volume').value = audioState.volume;

      // Bind controls
      $('#btn-audio-play').addEventListener('click', toggleAudioPlay);
      $('#audio-volume').addEventListener('input', (e) => {
        audioState.volume = parseFloat(e.target.value);
        if (audioState.el) audioState.el.volume = audioState.volume;
        localStorage.setItem('pdw_audio_vol', audioState.volume);
        if (audioState.muted && audioState.volume > 0) setAudioMute(false);
      });
      $('#btn-audio-mute').addEventListener('click', () => setAudioMute(!audioState.muted));
      $('#btn-audio-settings').addEventListener('click', showAudioSettingsModal);

      // Poll status every 30s to update listener count
      audioState.statusPollTimer = setInterval(pollAudioStatus, 30000);
    } catch { /* audio feature unavailable - bar stays hidden */ }
  }

  function updateAudioFreqLabel(freq) {
    const label = $('#audio-freq-label');
    if (!label) return;
    label.textContent = freq ? `FireComm ${freq}` : 'FireComm';
  }

  function updateAudioDot(state_) {
    const dot = $('#audio-status-dot');
    if (!dot) return;
    dot.className = 'audio-dot audio-dot-' + state_;
    const titles = { off: 'Unavailable', ready: 'Ready', playing: 'Connected — streaming', error: 'Disconnected' };
    dot.title = titles[state_] || state_;
  }

  function updateListenerCount(n) {
    const el = $('#audio-listener-count');
    if (!el) return;
    if (typeof n === 'number' && n >= 0) {
      el.textContent = n === 1 ? '1 listener' : `${n} listeners`;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  function setPlayBtnState(isPlaying) {
    const playBtn = $('#btn-audio-play');
    if (!playBtn) return;
    $('#audio-icon-play').classList.toggle('hidden', isPlaying);
    $('#audio-icon-stop').classList.toggle('hidden', !isPlaying);
    playBtn.classList.toggle('playing', isPlaying);
    playBtn.title = isPlaying ? 'Stop audio' : 'Play FireComm audio';
    playBtn.setAttribute('aria-label', isPlaying ? 'Stop stream' : 'Play stream');
  }

  function toggleAudioPlay() {
    if (!audioState.el) return;
    if (audioState.playing) {
      audioState.el.pause();
      audioState.el.removeAttribute('src');
      audioState.el.load();
      audioState.playing = false;
      updateAudioDot('ready');
      setPlayBtnState(false);
      stopLevelMeter();
    } else {
      // Show connected state immediately — don't wait for 'playing' event
      // because squelch can starve ffmpeg (no MP3 chunks) and the browser
      // never fires 'playing' while the stream is silent.
      audioState.playing = true;
      updateAudioDot('playing');
      setPlayBtnState(true);
      setupAudioAnalyser();
      startLevelMeter();
      audioState.el.src = '/api/audio/stream';
      audioState.el.load();
      audioState.el.play().catch(() => {
        audioState.playing = false;
        updateAudioDot('error');
        setPlayBtnState(false);
        stopLevelMeter();
      });
    }
  }

  function setAudioMute(muted) {
    audioState.muted = muted;
    if (audioState.el) audioState.el.muted = muted;
    const volIcon  = $('#audio-icon-vol');
    const muteIcon = $('#audio-icon-mute');
    if (volIcon)  volIcon.classList.toggle('hidden', muted);
    if (muteIcon) muteIcon.classList.toggle('hidden', !muted);
    const btn = $('#btn-audio-mute');
    if (btn) {
      btn.title = muted ? 'Unmute' : 'Mute';
      btn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    }
  }

  // ─── Web Audio level metering ───

  function setupAudioAnalyser() {
    if (audioState.analyser || !audioState.el) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const source = ctx.createMediaElementSource(audioState.el);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      audioState.audioCtx = ctx;
      audioState.analyser = analyser;
      // Resume in case browser suspended it before user interaction
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch { /* AudioContext unavailable */ }
  }

  function getRmsLevel() {
    if (!audioState.analyser) return 0;
    const buf = new Uint8Array(audioState.analyser.frequencyBinCount);
    audioState.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const s = (buf[i] - 128) / 128;
      sum += s * s;
    }
    return Math.sqrt(sum / buf.length);
  }

  function startLevelMeter() {
    if (audioState.levelRaf) cancelAnimationFrame(audioState.levelRaf);
    // Resume AudioContext if suspended (required after background tab)
    if (audioState.audioCtx && audioState.audioCtx.state === 'suspended') {
      audioState.audioCtx.resume().catch(() => {});
    }
    function tick() {
      if (!audioState.playing) return;
      const rms = getRmsLevel();
      // rms is 0–1 (typically 0–0.3 in practice); scale to 0–100%
      const pct = Math.min(100, Math.round(rms * 350));
      const fill = $('#audio-level-fill');
      const sqLabel = $('#audio-sq-label');
      if (fill) {
        fill.style.width = pct + '%';
        fill.className = 'audio-level-fill' + (pct < 3 ? ' level-low' : pct < 60 ? ' level-mid' : ' level-high');
      }
      if (sqLabel) {
        sqLabel.classList.toggle('hidden', pct >= 3);
      }
      audioState.levelRaf = requestAnimationFrame(tick);
    }
    audioState.levelRaf = requestAnimationFrame(tick);
  }

  function stopLevelMeter() {
    if (audioState.levelRaf) cancelAnimationFrame(audioState.levelRaf);
    audioState.levelRaf = null;
    const fill = $('#audio-level-fill');
    if (fill) { fill.style.width = '0%'; fill.className = 'audio-level-fill'; }
    const sqLabel = $('#audio-sq-label');
    if (sqLabel) sqLabel.classList.add('hidden');
  }

  async function pollAudioStatus() {
    try {
      const resp = await fetch('/api/audio/status');
      const data = await resp.json();
      if (!data.available) {
        updateAudioDot('error');
        return;
      }
      if (!audioState.playing) updateAudioDot('ready');
      updateListenerCount(data.clients);
    } catch { /* ignore */ }
  }

  // ─── Audio Settings Modal (admin) ───
  async function showAudioSettingsModal() {
    let settings = { freq: '', mode: 'fm', gain: '40', squelch: '0' };
    try {
      const r = await fetch('/api/audio/settings');
      if (r.ok) settings = await r.json();
    } catch { /* use defaults */ }

    showModal('RTL-SDR Settings', `
      <div class="form-group">
        <label>Frequency (e.g. 75.5875M)</label>
        <input type="text" id="rtl-freq" value="${esc(settings.freq || '')}" placeholder="75.5875M">
      </div>
      <div class="form-group">
        <label>Mode</label>
        <select id="rtl-mode">
          <option value="fm"  ${settings.mode === 'fm'  ? 'selected' : ''}>FM (wideband)</option>
          <option value="nfm" ${settings.mode === 'nfm' ? 'selected' : ''}>NFM (narrowband)</option>
          <option value="am"  ${settings.mode === 'am'  ? 'selected' : ''}>AM</option>
        </select>
      </div>
      <div class="form-group">
        <label>Gain (0 = auto, 1–50 = manual dB)</label>
        <input type="number" id="rtl-gain" value="${esc(String(settings.gain || '40'))}" min="0" max="50">
      </div>
      <div class="form-group">
        <label>Squelch (0 = open)</label>
        <input type="number" id="rtl-squelch" value="${esc(String(settings.squelch || '0'))}" min="0" max="50">
      </div>
      <div style="margin-top:0.5rem">
        <button class="btn btn-sm btn-secondary" id="btn-auto-squelch-modal">Auto Squelch</button>
        <span id="auto-squelch-status" style="font-size:0.8rem;color:var(--text-dim);margin-left:0.5rem"></span>
      </div>
    `, `
      <button class="btn" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save-rtl">Save &amp; Apply</button>
    `);

    $('#modal-cancel').onclick = hideModal;

    $('#btn-auto-squelch-modal').onclick = async () => {
      const statusEl = $('#auto-squelch-status');
      const btn = $('#btn-auto-squelch-modal');
      btn.disabled = true;
      statusEl.textContent = 'Measuring noise floor (3–5s)…';
      try {
        const result = await api('/api/audio/auto-squelch', { method: 'POST' });
        statusEl.textContent = `Suggested: ${result.suggested} — applied (squelch=${result.squelch})`;
        const squelchInput = $('#rtl-squelch');
        if (squelchInput) squelchInput.value = result.squelch;
      } catch (err) {
        statusEl.textContent = 'Error: ' + err.message;
      } finally {
        btn.disabled = false;
      }
    };

    $('#modal-save-rtl').onclick = async () => {
      const freq    = $('#rtl-freq').value.trim();
      const mode    = $('#rtl-mode').value;
      const gain    = $('#rtl-gain').value;
      const squelch = $('#rtl-squelch').value;
      if (!freq) return toast('Frequency is required', 'error');
      try {
        await api('/api/audio/settings', {
          method: 'PUT',
          body: JSON.stringify({ freq, mode, gain, squelch }),
        });
        audioState.freq = freq;
        updateAudioFreqLabel(freq);
        hideModal();
        toast('RTL-SDR settings saved', 'success');
        // If currently playing, restart stream with new settings
        if (audioState.playing && audioState.el) {
          audioState.el.pause();
          audioState.el.src = '';
          setTimeout(() => {
            if (audioState.el) {
              audioState.el.src = '/api/audio/stream';
              audioState.el.load();
              audioState.el.play().catch(() => {});
            }
          }, 1500);
        }
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  // ─── Init ───
  function init() {
    bindEvents();
    setupPullToRefresh();
    registerSW();

    // Listen for SW messages (notification click -> navigate to message)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'navigate_to_message' && event.data.messageId) {
          navigateToMessage(event.data.messageId);
        }
        if (event.data && event.data.type === 'push_resubscribe' && event.data.subscription) {
          api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: event.data.subscription }) })
            .catch(() => {});
        }
      });
    }

    // Check URL params for ?msg= (app opened fresh from notification click)
    const urlParams = new URLSearchParams(window.location.search);
    const msgParam = urlParams.get('msg');
    if (msgParam) {
      state.pendingMessageId = parseInt(msgParam, 10);
      // Clean URL without reload
      window.history.replaceState({}, '', '/');
    }

    // Keep CSS variables in sync on resize / orientation change (critical for iOS Safari)
    window.addEventListener('resize', () => { updateAppHeight(); updateTopbarHeight(); });
    window.addEventListener('orientationchange', () => {
      setTimeout(() => { updateAppHeight(); updateTopbarHeight(); }, 100);
    });

    if (state.token) {
      storeTokenForSW(state.token);
      showApp();
    } else {
      $('#login-screen').classList.add('active');
    }
  }

  // Expose toggleFavourite for sidebar buttons
  window.toggleFavourite = toggleFavourite;

  init();
})();
