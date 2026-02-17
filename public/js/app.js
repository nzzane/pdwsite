/* ─── PDW Monitor Frontend ─── */
(function () {
  'use strict';

  // ─── State ───
  const state = {
    token: localStorage.getItem('pdw_token'),
    user: null,
    ws: null,
    wsReconnectTimer: null,
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
    alarmLevelSetting: null, // null = off, 2-5 = minimum alarm level
  };

  // ─── Call type categories ───
  const FIRE_TYPES = ['STRUCTURE FIRE', 'VEGETATION FIRE', 'RUBBISH FIRE', 'VEHICLE FIRE', 'CHIMNEY FIRE', 'RURAL FIRE'];
  const AMBO_TYPES = ['AMBO', 'CARDIAC', 'BREATHING', 'TRAUMA'];

  // ─── Call type colours ───
  const CALL_TYPE_COLOURS = {
    'STRUCTURE FIRE': '#dc2626',
    'VEGETATION FIRE': '#ea580c',
    'RUBBISH FIRE': '#f59e0b',
    'VEHICLE FIRE': '#dc2626',
    'CHIMNEY FIRE': '#ea580c',
    'MVC': '#7c3aed',
    'MIN': '#2563eb',
    'RESCUE': '#0891b2',
    'HAZMAT': '#ca8a04',
    'AMBO': '#16a34a',
    'CARDIAC': '#dc2626',
    'BREATHING': '#16a34a',
    'TRAUMA': '#9333ea',
    'ALARM': '#64748b',
    'SPECIAL SERVICE': '#0284c7',
    'ASSIST': '#6366f1',
    'TEST': '#9ca3af',
    'PROWLER': '#475569',
    'FLOODING': '#0ea5e9',
    'SLIP': '#78716c',
    'LIFT RESCUE': '#0891b2',
    'WATER RESCUE': '#0284c7',
    'RURAL FIRE': '#ea580c',
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

    // Check keyword alerts
    if (!matched) {
      const content = (msg.content || '').toLowerCase();
      for (const ka of state.keywordAlerts) {
        if (content.includes(ka.keyword.toLowerCase())) {
          matched = true;
          matchReason = 'Keyword: ' + ka.keyword;
          break;
        }
      }
    }

    // Check alarm level alerts
    if (!matched && state.alarmLevelSetting) {
      const alarmLevel = msg.alarm_level || extractAlarmLevel(msg.content);
      if (alarmLevel && alarmLevel >= state.alarmLevelSetting) {
        matched = true;
        const ordinal = alarmLevel === 2 ? '2nd' : alarmLevel === 3 ? '3rd' : `${alarmLevel}th`;
        matchReason = `${ordinal} Alarm`;
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
    const isStatus = isStatusMessage(msg.content);

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

    // Location + time of call
    let metaHtml = '';
    if (msg.location) metaHtml += `<span class="msg-meta-item">&#x1f4cd; ${esc(msg.location)}</span>`;
    // Show formatted time next to location
    metaHtml += `<span class="msg-meta-item">&#x1f552; ${formatTime(msg.received_at)}</span>`;

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

  // ─── Detect CAD status/timing messages that should be greyed out ───
  function isStatusMessage(content) {
    if (!content) return false;
    // "Unit: MALB1 Assigned to Station: Picton"
    if (/\bUnit:\s*\S+\s+Assigned to Station:/i.test(content)) return true;
    // "CHR2 Ref:0115-3-2026/02/18 Disp:06:13Resp:06:14Loc:06:31Dep:07:11Dest:07:45"
    if (/Ref:\S+\s*Disp:\S+\s*Resp:/i.test(content)) return true;
    // "Assigned to Station:" without Unit prefix
    if (/\bAssigned to Station:/i.test(content)) return true;
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

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    state.ws = new WebSocket(`${proto}://${location.host}/ws`);
    const statusDot = $('#connection-status');
    statusDot.className = 'status-dot connecting';
    statusDot.title = 'Connecting...';

    state.ws.onopen = () => {
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
      } catch { /* ignore */ }
    };

    state.ws.onclose = () => {
      statusDot.className = 'status-dot disconnected';
      statusDot.title = 'Disconnected';
      // Reconnect
      if (state.token) {
        state.wsReconnectTimer = setTimeout(connectWs, 3000);
      }
    };

    state.ws.onerror = () => {
      state.ws.close();
    };

    // Keepalive
    const pingInterval = setInterval(() => {
      if (state.ws && state.ws.readyState === 1) {
        state.ws.send(JSON.stringify({ type: 'ping' }));
      } else {
        clearInterval(pingInterval);
      }
    }, 25000);
  }

  function disconnectWs() {
    if (state.wsReconnectTimer) clearTimeout(state.wsReconnectTimer);
    if (state.ws) state.ws.close();
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

    // Add to front of array (newest first)
    state.messages.unshift(msg);
    if (state.messages.length > state.maxLiveMessages) {
      state.messages.pop();
      const list = $('#message-list');
      if (list.lastChild) list.removeChild(list.lastChild);
    }

    // Prepend to top of list (newest at top)
    const list = $('#message-list');
    const card = renderMessageCard(msg);
    list.insertBefore(card, list.firstChild);
  }

  function matchesFilters(msg) {
    const search = $('#filter-search').value.toLowerCase();
    const callType = $('#filter-call-type').value;
    const capcode = $('#filter-capcode').value;
    const location = $('#filter-location').value.toLowerCase();
    const trucks = $('#filter-trucks').value.toLowerCase();
    const groupId = $('#filter-group').value;
    const hideTest = $('#filter-hide-test') && $('#filter-hide-test').checked;

    // Hide test pages by default
    if (hideTest && msg.call_type === 'TEST') return false;

    if (search && !(msg.content || '').toLowerCase().includes(search)) return false;
    if (callType && msg.call_type !== callType) return false;
    if (capcode && normalizeCapcode(msg.capcode) !== normalizeCapcode(capcode)) return false;
    if (location && !(msg.location || '').toLowerCase().includes(location)) return false;
    if (trucks && !(msg.trucks || '').toLowerCase().includes(trucks)) return false;
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
    return true;
  }

  // ─── Load data ───
  async function loadInitialData() {
    try {
      const [groups, favs, aliases, callTypes, filters, keywordAlerts, alarmLevelData] = await Promise.all([
        api('/api/groups'),
        api('/api/favourites'),
        api('/api/aliases'),
        api('/api/messages/call-types'),
        api('/api/filters'),
        api('/api/keyword-alerts'),
        api('/api/alarm-level-alert'),
      ]);

      state.groups = groups;
      state.favourites = favs;
      state.callTypes = callTypes;
      state.filters = filters;
      state.keywordAlerts = keywordAlerts;
      state.alarmLevelSetting = alarmLevelData.min_alarm_level || null;

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
    try {
      const params = new URLSearchParams({ limit: '100' });
      if ($('#filter-hide-test') && $('#filter-hide-test').checked) {
        params.set('exclude_call_type', 'TEST');
      }
      const msgs = await api('/api/messages?' + params.toString());
      const list = $('#message-list');
      list.innerHTML = '';
      // API returns newest first - that's our display order
      state.messages = msgs;
      for (const msg of state.messages) {
        list.appendChild(renderMessageCard(msg));
      }
    } catch (err) {
      toast('Failed to load messages', 'error');
    }
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
          <span class="keyword-text">${esc(ka.keyword)}</span>
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
          if (f.capcode) $('#filter-capcode').value = f.capcode;
          if (f.location) $('#filter-location').value = f.location;
          if (f.trucks) $('#filter-trucks').value = f.trucks;
          if (f.group_id) $('#filter-group').value = f.group_id;
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
  }

  // ─── Apply filters (re-fetch for search, re-filter for live) ───
  async function applyFilters() {
    if (state.currentView === 'search') {
      await doSearch(0);
    }
    // For live view, new messages are filtered in handleNewMessage
    // but we also re-fetch existing messages with the current filters
    if (state.currentView === 'live') {
      try {
        const params = new URLSearchParams();
        params.set('limit', '100');
        const search = $('#filter-search').value;
        const callType = $('#filter-call-type').value;
        const capcode = $('#filter-capcode').value;
        const location = $('#filter-location').value;
        const trucks = $('#filter-trucks').value;
        const groupId = $('#filter-group').value;
        const hideTest = $('#filter-hide-test') && $('#filter-hide-test').checked;
        if (search) params.set('search', search);
        if (callType) params.set('call_type', callType);
        if (capcode) params.set('capcode', capcode);
        if (location) params.set('location', location);
        if (trucks) params.set('trucks', trucks);
        if (groupId) params.set('group_id', groupId);
        if (hideTest) params.set('exclude_call_type', 'TEST');

        const msgs = await api('/api/messages?' + params.toString());
        const list = $('#message-list');
        list.innerHTML = '';
        // Newest first (API returns newest first)
        state.messages = msgs;
        for (const msg of state.messages) {
          list.appendChild(renderMessageCard(msg));
        }
      } catch (err) {
        toast('Filter error: ' + err.message, 'error');
      }
    }
  }

  // ─── Search ───
  async function doSearch(page) {
    state.searchPage = page;
    const params = new URLSearchParams();
    params.set('limit', state.searchLimit.toString());
    params.set('offset', (page * state.searchLimit).toString());
    const search = $('#filter-search').value;
    const callType = $('#filter-call-type').value;
    const capcode = $('#filter-capcode').value;
    const location = $('#filter-location').value;
    const trucks = $('#filter-trucks').value;
    const groupId = $('#filter-group').value;
    if (search) params.set('search', search);
    if (callType) params.set('call_type', callType);
    if (capcode) params.set('capcode', capcode);
    if (location) params.set('location', location);
    if (trucks) params.set('trucks', trucks);
    if (groupId) params.set('group_id', groupId);

    try {
      const msgs = await api('/api/messages?' + params.toString());
      const list = $('#search-results');
      list.innerHTML = '';
      for (const msg of msgs) {
        list.appendChild(renderMessageCard(msg));
      }
      renderPagination(msgs.length);
    } catch (err) {
      toast('Search failed: ' + err.message, 'error');
    }
  }

  function renderPagination(resultCount) {
    const el = $('#search-pagination');
    const hasPrev = state.searchPage > 0;
    const hasNext = resultCount >= state.searchLimit;
    el.innerHTML = `
      <button ${hasPrev ? '' : 'disabled'} id="page-prev">Previous</button>
      <span style="font-size:0.85rem;color:var(--text-dim)">Page ${state.searchPage + 1}</span>
      <button ${hasNext ? '' : 'disabled'} id="page-next">Next</button>
    `;
    if (hasPrev) el.querySelector('#page-prev').onclick = () => doSearch(state.searchPage - 1);
    if (hasNext) el.querySelector('#page-next').onclick = () => doSearch(state.searchPage + 1);
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
        const alias = state.aliases[cc.capcode];
        return `<li><span>${esc(cc.capcode)}${alias ? ' (' + esc(alias.alias) + ')' : ''}</span><span>${cc.count}</span></li>`;
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
        // Refresh aliases in state
        const updatedAliases = await api('/api/aliases');
        state.aliases = {};
        for (const a of updatedAliases) state.aliases[a.capcode] = a;
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
      try {
        await api('/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({ currentPassword: $('#cur-password').value, newPassword: $('#new-pw').value })
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
      if (newPw.length < 4) return toast('Password must be at least 4 characters', 'error');
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
      if ($('#filter-capcode').value) filter.capcode = $('#filter-capcode').value;
      if ($('#filter-location').value) filter.location = $('#filter-location').value;
      if ($('#filter-trucks').value) filter.trucks = $('#filter-trucks').value;
      if ($('#filter-group').value) filter.group_id = $('#filter-group').value;
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
    showModal('Add Keyword Alert', `
      <p style="font-size:0.85rem;color:var(--text-dim);margin-bottom:0.75rem">
        Get an in-app alert (with sound) when a message contains this keyword or address.
        Works in all browsers including Safari.
      </p>
      <div class="form-group"><label>Keyword or Address</label><input type="text" id="keyword-input" placeholder="e.g. 3rd alarm, 123 Main St"></div>
    `, `
      <button class="btn" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save">Add Alert</button>
    `);
    $('#modal-cancel').onclick = hideModal;
    $('#modal-save').onclick = async () => {
      const keyword = $('#keyword-input').value.trim();
      if (!keyword) return toast('Keyword required', 'error');
      try {
        await api('/api/keyword-alerts', { method: 'POST', body: JSON.stringify({ keyword }) });
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

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
      toast('Push notifications enabled! You will receive alerts even when the app is closed.', 'success');
      updateNotificationBell();
    } catch (err) {
      console.error('Push setup failed:', err);
      toast('Push setup failed: ' + err.message + '. In-app alerts with sound still work.', 'error');
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
    disconnectWs();
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

    // Auto-subscribe to push if permission already granted (ensures background notifications work)
    autoSubscribePush();
    updateNotificationBell();

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
          <li>Click the <strong>bell icon</strong> in the top bar to enable notifications</li>
          <li>Allow notifications when prompted by your browser</li>
          <li>Add groups to your <strong>Favourites</strong> in the sidebar (with the bell enabled)</li>
          <li>You'll receive a push notification whenever a page matches your favourited groups</li>
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

    // Home button - reset to Live Feed with no filters, force reload messages
    $('#btn-home').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Clear all filters
      $('#filter-search').value = '';
      $('#filter-call-type').value = '';
      $('#filter-capcode').value = '';
      $('#filter-location').value = '';
      $('#filter-trucks').value = '';
      $('#filter-group').value = '';
      if ($('#filter-hide-test')) $('#filter-hide-test').checked = true;
      // Switch view to live (won't re-fetch if already on live)
      state.currentView = 'live';
      $$('.view').forEach(v => v.classList.remove('active'));
      $('#view-live').classList.add('active');
      $$('.nav-item[data-view]').forEach(n => n.classList.toggle('active', n.dataset.view === 'live'));
      // Close panels
      closeSidebar();
      hideDetail();
      // Un-pause if paused
      state.paused = false;
      $('#btn-pause').textContent = 'Pause';
      // Force reload messages from API
      loadRecentMessages();
    });

    // Detail backdrop click to close
    $('#detail-backdrop').addEventListener('click', hideDetail);

    // Notifications
    $('#btn-notifications').addEventListener('click', enableNotifications);

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
    $('#filter-capcode').addEventListener('input', onFilterChange);
    $('#filter-location').addEventListener('input', onFilterChange);
    $('#filter-trucks').addEventListener('input', onFilterChange);
    $('#filter-group').addEventListener('change', onFilterChange);
    $('#filter-hide-test').addEventListener('change', onFilterChange);
    $('#btn-clear-filters').addEventListener('click', () => {
      $('#filter-search').value = '';
      $('#filter-call-type').value = '';
      $('#filter-capcode').value = '';
      $('#filter-location').value = '';
      $('#filter-trucks').value = '';
      $('#filter-group').value = '';
      $('#filter-hide-test').checked = true;
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
        await api('/api/alarm-level-alert', { method: 'PUT', body: JSON.stringify({ min_alarm_level: val }) });
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

    // Update time-ago labels periodically
    setInterval(() => {
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
      if (!isSecureContext() || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
      if (Notification.permission !== 'granted') {
        bell.classList.remove('notifications-active');
        bell.title = 'Enable notifications';
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration('/');
      if (!reg) return;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        bell.classList.add('notifications-active');
        bell.title = 'Notifications enabled';
      } else {
        bell.classList.remove('notifications-active');
        bell.title = 'Enable notifications';
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

  // ─── Init ───
  function init() {
    bindEvents();
    registerSW();

    // Keep CSS variables in sync on resize / orientation change (critical for iOS Safari)
    window.addEventListener('resize', () => { updateAppHeight(); updateTopbarHeight(); });
    window.addEventListener('orientationchange', () => {
      setTimeout(() => { updateAppHeight(); updateTopbarHeight(); }, 100);
    });

    if (state.token) {
      showApp();
    } else {
      $('#login-screen').classList.add('active');
    }
  }

  // Expose toggleFavourite for sidebar buttons
  window.toggleFavourite = toggleFavourite;

  init();
})();
