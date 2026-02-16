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
    searchPage: 0,
    searchLimit: 50,
  };

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

  // ─── Render a message card ───
  function renderMessageCard(msg) {
    const colour = msg.call_type ? (CALL_TYPE_COLOURS[msg.call_type] || '#6b7280') : (msg.alias_colour || '#6b7280');
    const alias = msg.alias || state.aliases[msg.capcode];
    const aliasName = alias ? (typeof alias === 'string' ? alias : alias.alias) : null;
    const aliasColour = alias && typeof alias === 'object' ? alias.colour : colour;

    const card = document.createElement('div');
    card.className = 'msg-card highlight';
    card.style.borderLeftColor = colour;
    card.dataset.id = msg.id;

    let headerHtml = `<span class="msg-capcode">${esc(msg.capcode)}</span>`;
    if (aliasName) headerHtml += `<span class="msg-alias" style="color:${esc(aliasColour)}">${esc(aliasName)}</span>`;
    if (msg.call_type) headerHtml += `<span class="msg-badge" style="background:${colour}">${esc(msg.call_type)}</span>`;
    headerHtml += `<span class="msg-protocol">${esc(msg.protocol)}${msg.bitrate ? '/' + msg.bitrate : ''}</span>`;
    headerHtml += `<span class="msg-time" title="${esc(formatDateTime(msg.received_at))}">${timeAgo(msg.received_at)}</span>`;

    let metaHtml = '';
    if (msg.location) metaHtml += `<span class="msg-meta-item">&#x1f4cd; ${esc(msg.location)}</span>`;
    if (msg.trucks) metaHtml += `<span class="msg-meta-item">&#x1f692; ${esc(msg.trucks)}</span>`;

    card.innerHTML = `
      <div class="msg-header">${headerHtml}</div>
      <div class="msg-content">${esc(msg.content)}</div>
      ${metaHtml ? `<div class="msg-meta">${metaHtml}</div>` : ''}
    `;

    card.addEventListener('click', () => showDetail(msg));
    return card;
  }

  // ─── Message detail panel ───
  function showDetail(msg) {
    const panel = $('#detail-panel');
    const content = $('#detail-content');
    const alias = state.aliases[msg.capcode];
    const aliasName = alias ? alias.alias : msg.alias || null;

    content.innerHTML = `
      <div class="detail-row"><div class="detail-label">Capcode</div><div class="detail-value mono">${esc(msg.capcode)}</div></div>
      ${aliasName ? `<div class="detail-row"><div class="detail-label">Alias</div><div class="detail-value">${esc(aliasName)}</div></div>` : ''}
      <div class="detail-row"><div class="detail-label">Content</div><div class="detail-value">${esc(msg.content)}</div></div>
      ${msg.call_type ? `<div class="detail-row"><div class="detail-label">Call Type</div><div class="detail-value"><span class="msg-badge" style="background:${CALL_TYPE_COLOURS[msg.call_type] || '#6b7280'}">${esc(msg.call_type)}</span></div></div>` : ''}
      ${msg.location ? `<div class="detail-row"><div class="detail-label">Location</div><div class="detail-value">${esc(msg.location)}</div></div>` : ''}
      ${msg.trucks ? `<div class="detail-row"><div class="detail-label">Trucks/Units</div><div class="detail-value">${esc(msg.trucks)}</div></div>` : ''}
      <div class="detail-row"><div class="detail-label">Protocol</div><div class="detail-value">${esc(msg.protocol)}${msg.bitrate ? ' / ' + msg.bitrate + ' baud' : ''}</div></div>
      <div class="detail-row"><div class="detail-label">Received</div><div class="detail-value">${esc(formatDateTime(msg.received_at))}</div></div>
      ${msg.raw ? `<div class="detail-row"><div class="detail-label">Raw</div><div class="detail-value mono" style="font-size:0.75rem;word-break:break-all">${esc(msg.raw)}</div></div>` : ''}
    `;

    panel.classList.remove('hidden');
    requestAnimationFrame(() => panel.classList.add('visible'));
  }

  function hideDetail() {
    const panel = $('#detail-panel');
    panel.classList.remove('visible');
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
    if (state.paused) return;

    // Check if message passes current filters
    if (!matchesFilters(msg)) return;

    state.messages.push(msg);
    if (state.messages.length > state.maxLiveMessages) {
      state.messages.shift();
      const list = $('#message-list');
      if (list.firstChild) list.removeChild(list.firstChild);
    }

    const list = $('#message-list');
    const card = renderMessageCard(msg);
    list.appendChild(card);

    if (state.autoScroll) {
      list.scrollTop = list.scrollHeight;
    }
  }

  function matchesFilters(msg) {
    const search = $('#filter-search').value.toLowerCase();
    const callType = $('#filter-call-type').value;
    const capcode = $('#filter-capcode').value;
    const location = $('#filter-location').value.toLowerCase();
    const trucks = $('#filter-trucks').value.toLowerCase();
    const groupId = $('#filter-group').value;

    if (search && !(msg.content || '').toLowerCase().includes(search)) return false;
    if (callType && msg.call_type !== callType) return false;
    if (capcode && msg.capcode !== capcode) return false;
    if (location && !(msg.location || '').toLowerCase().includes(location)) return false;
    if (trucks && !(msg.trucks || '').toLowerCase().includes(trucks)) return false;
    if (groupId) {
      const group = state.groups.find(g => g.id === parseInt(groupId, 10));
      if (group && group.members) {
        const caps = group.members.map(m => m.capcode);
        if (!caps.includes(msg.capcode)) return false;
      }
    }
    return true;
  }

  // ─── Load data ───
  async function loadInitialData() {
    try {
      const [groups, favs, aliases, callTypes, filters] = await Promise.all([
        api('/api/groups'),
        api('/api/favourites'),
        api('/api/aliases'),
        api('/api/messages/call-types'),
        api('/api/filters'),
      ]);

      state.groups = groups;
      state.favourites = favs;
      state.callTypes = callTypes;
      state.filters = filters;

      // Build alias map
      state.aliases = {};
      for (const a of aliases) {
        state.aliases[a.capcode] = a;
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
      const msgs = await api('/api/messages?limit=100');
      const list = $('#message-list');
      list.innerHTML = '';
      state.messages = msgs.reverse();
      for (const msg of state.messages) {
        list.appendChild(renderMessageCard(msg));
      }
      list.scrollTop = list.scrollHeight;
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

    // Groups
    const groupsEl = $('#sidebar-groups');
    if (state.groups.length === 0) {
      groupsEl.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted);padding:0.25rem 0.625rem">No groups yet</span>';
    } else {
      groupsEl.innerHTML = state.groups.map(g => `
        <a href="#" class="nav-item" data-view="live" data-group-filter="${g.id}">
          <span class="colour-dot" style="background:${esc(g.colour)}"></span>
          ${esc(g.name)}
          <span class="nav-badge">${g.member_count || 0}</span>
        </a>
      `).join('');
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
    groupsEl.querySelectorAll('[data-group-filter]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        $('#filter-group').value = el.dataset.groupFilter;
        switchView('live');
        applyFilters();
        closeSidebar();
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
        if (search) params.set('search', search);
        if (callType) params.set('call_type', callType);
        if (capcode) params.set('capcode', capcode);
        if (location) params.set('location', location);
        if (trucks) params.set('trucks', trucks);
        if (groupId) params.set('group_id', groupId);

        const msgs = await api('/api/messages?' + params.toString());
        const list = $('#message-list');
        list.innerHTML = '';
        state.messages = msgs.reverse();
        for (const msg of state.messages) {
          list.appendChild(renderMessageCard(msg));
        }
        list.scrollTop = list.scrollHeight;
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
            <thead><tr><th>Name</th><th>Colour</th><th>Members</th><th>Actions</th></tr></thead>
            <tbody>
              ${groups.map(g => `
                <tr>
                  <td>${esc(g.name)}</td>
                  <td><span class="colour-dot" style="background:${esc(g.colour)}"></span>${esc(g.colour)}</td>
                  <td>${g.member_count || 0}</td>
                  <td class="admin-actions">
                    <button class="btn btn-sm" data-edit-group="${g.id}">Edit</button>
                    <button class="btn btn-sm btn-danger" data-delete-group="${g.id}">Delete</button>
                  </td>
                </tr>
              `).join('')}
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
      } catch (err) {
        el.innerHTML = `<p>Error: ${esc(err.message)}</p>`;
      }
    } else if (tab === 'aliases') {
      try {
        const aliases = await api('/api/aliases');
        el.innerHTML = `
          <div style="margin-bottom:0.75rem"><button class="btn btn-primary btn-sm" id="btn-add-alias">Add Alias</button></div>
          <table class="admin-table">
            <thead><tr><th>Capcode</th><th>Alias</th><th>Colour</th><th>Call Type</th><th>Location</th><th>Actions</th></tr></thead>
            <tbody>
              ${aliases.map(a => `
                <tr>
                  <td class="mono">${esc(a.capcode)}</td>
                  <td>${esc(a.alias)}</td>
                  <td><span class="colour-dot" style="background:${esc(a.colour)}"></span></td>
                  <td>${esc(a.call_type || '')}</td>
                  <td>${esc(a.location || '')}</td>
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
            <thead><tr><th>Username</th><th>Role</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>
              ${users.map(u => `
                <tr>
                  <td>${esc(u.username)}</td>
                  <td>${esc(u.role)}</td>
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
    if (editId) {
      group = await api(`/api/groups/${editId}`);
      members = group.members || [];
    }
    showModal(editId ? 'Edit Group' : 'Add Group', `
      <div class="form-group"><label>Name</label><input type="text" id="group-name" value="${esc(group ? group.name : '')}"></div>
      <div class="form-group"><label>Description</label><textarea id="group-desc">${esc(group ? group.description : '')}</textarea></div>
      <div class="form-group"><label>Colour</label><input type="color" id="group-colour" value="${group ? group.colour : '#3b82f6'}" style="width:60px;height:32px;padding:2px"></div>
      <div class="form-group"><label>Capcodes (one per line)</label><textarea id="group-capcodes" rows="6" placeholder="1234567\n7654321">${members.map(m => m.capcode).join('\n')}</textarea></div>
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
      if (!name) return toast('Name required', 'error');
      try {
        if (editId) {
          await api(`/api/groups/${editId}`, { method: 'PUT', body: JSON.stringify({ name, description, colour, capcodes }) });
        } else {
          await api('/api/groups', { method: 'POST', body: JSON.stringify({ name, description, colour, capcodes }) });
        }
        hideModal();
        loadAdminTab('groups');
        renderFilterOptions();
        toast('Group saved', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  async function showAliasModal(editCapcode) {
    let alias = null;
    if (editCapcode) {
      const aliases = await api('/api/aliases');
      alias = aliases.find(a => a.capcode === editCapcode);
    }
    showModal(editCapcode ? 'Edit Alias' : 'Add Alias', `
      <div class="form-group"><label>Capcode</label><input type="text" id="alias-capcode" value="${esc(alias ? alias.capcode : '')}" ${editCapcode ? 'readonly' : ''}></div>
      <div class="form-group"><label>Alias Name</label><input type="text" id="alias-name" value="${esc(alias ? alias.alias : '')}"></div>
      <div class="form-group"><label>Colour</label><input type="color" id="alias-colour" value="${alias ? alias.colour : '#6b7280'}" style="width:60px;height:32px;padding:2px"></div>
      <div class="form-group"><label>Default Call Type</label><input type="text" id="alias-calltype" value="${esc(alias ? alias.call_type || '' : '')}" placeholder="e.g. AMBO, MIN"></div>
      <div class="form-group"><label>Default Location</label><input type="text" id="alias-location" value="${esc(alias ? alias.location || '' : '')}" placeholder="e.g. Wellington"></div>
    `, `
      <button class="btn" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save">Save</button>
    `);
    $('#modal-cancel').onclick = hideModal;
    $('#modal-save').onclick = async () => {
      const capcode = $('#alias-capcode').value.trim();
      const name = $('#alias-name').value.trim();
      if (!capcode || !name) return toast('Capcode and alias required', 'error');
      try {
        await api('/api/aliases', {
          method: 'POST',
          body: JSON.stringify({
            capcode,
            alias: name,
            colour: $('#alias-colour').value,
            call_type: $('#alias-calltype').value.trim() || null,
            location: $('#alias-location').value.trim() || null,
          })
        });
        hideModal();
        loadAdminTab('aliases');
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
    `, `
      <button class="btn" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save">Create</button>
    `);
    $('#modal-cancel').onclick = hideModal;
    $('#modal-save').onclick = async () => {
      const username = $('#new-username').value.trim();
      const password = $('#new-password').value;
      const role = $('#new-role').value;
      if (!username || !password) return toast('Username and password required', 'error');
      try {
        await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password, role }) });
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

  // ─── Push notifications ───
  async function enableNotifications() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      toast('Push notifications not supported in this browser', 'error');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      toast('Notification permission denied', 'error');
      return;
    }
    try {
      const { publicKey } = await api('/api/push/vapid-key');
      if (!publicKey) {
        toast('Push not configured on server (no VAPID keys)', 'error');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
      toast('Notifications enabled', 'success');
    } catch (err) {
      toast('Failed to enable notifications: ' + err.message, 'error');
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

    connectWs();
    await loadInitialData();
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

    // Notifications
    $('#btn-notifications').addEventListener('click', enableNotifications);

    // Filters
    $('#filter-search').addEventListener('input', onFilterChange);
    $('#filter-call-type').addEventListener('change', onFilterChange);
    $('#filter-capcode').addEventListener('input', onFilterChange);
    $('#filter-location').addEventListener('input', onFilterChange);
    $('#filter-trucks').addEventListener('input', onFilterChange);
    $('#filter-group').addEventListener('change', onFilterChange);
    $('#btn-clear-filters').addEventListener('click', () => {
      $('#filter-search').value = '';
      $('#filter-call-type').value = '';
      $('#filter-capcode').value = '';
      $('#filter-location').value = '';
      $('#filter-trucks').value = '';
      $('#filter-group').value = '';
      applyFilters();
    });
    $('#btn-save-filter').addEventListener('click', showSaveFilterModal);

    // Live controls
    $('#toggle-autoscroll').addEventListener('change', (e) => { state.autoScroll = e.target.checked; });
    $('#btn-pause').addEventListener('click', () => {
      state.paused = !state.paused;
      $('#btn-pause').textContent = state.paused ? 'Resume' : 'Pause';
    });

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
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/sw.js');
      } catch (err) {
        console.warn('SW registration failed:', err);
      }
    }
  }

  // ─── Init ───
  function init() {
    bindEvents();
    registerSW();

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
