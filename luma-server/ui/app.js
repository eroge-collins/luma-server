// ===== Luma Server Dashboard - Web App =====

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => document.querySelectorAll(sel)

let currentTab = 'dashboard'
let logs = []
let connectedUsers = []
const MAX_LOGS = 500

// ──────────────────────────── Tab Navigation ────────────────────────────

$$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab
        if (!tab) return
        $$('.nav-item').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        $$('.tab-content').forEach(t => t.classList.remove('active'))
        $(`#tab-${tab}`).classList.add('active')
        currentTab = tab
        if (tab === 'users') refreshUsers()
        if (tab === 'config') loadConfig()
    })
})

// ──────────────────────────── API helpers ────────────────────────────

async function api(path, opts) {
    const res = await fetch(`/api${path}`, opts)
    if (!res.ok) throw new Error(`API error: ${res.status}`)
    return res.json()
}

// ──────────────────────────── Dashboard ────────────────────────────

function updateStats(stats) {
    $('#statUsers').textContent = stats.connectedUsers || 0
    $('#statChannels').textContent = stats.channels || 0
    $('#statMessages').textContent = stats.totalMessages || 0
    $('#statUptime').textContent = formatUptime(stats.uptime || 0)

    const banner = $('#statusBanner')
    if (stats.running) {
        banner.classList.add('status-banner--online')
        $('#statusText').textContent = 'Server Online'
    } else {
        banner.classList.remove('status-banner--online')
        $('#statusText').textContent = 'Server Offline'
    }
}

function formatUptime(seconds) {
    if (!seconds || seconds <= 0) return '--:--'
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
}

// ──────────────────────────── Network Addresses ────────────────────────────

async function loadNetworkAddresses() {
    try {
        const [config, addresses] = await Promise.all([api('/config'), api('/network')])
        const port = config?.port || 3737
        const container = $('#networkList')

        if (!addresses || addresses.length === 0) {
            container.innerHTML = '<div class="network-item"><span class="network-item__label">localhost</span><span class="network-item__address">ws://localhost:' + port + '</span></div>'
            return
        }

        // Show address in status banner
        $('#statusAddress').textContent = `ws://${addresses[0].address}:${port}`

        container.innerHTML = addresses.map(a => `
            <div class="network-item">
                <span class="network-item__label">${esc(a.name)}</span>
                <span class="network-item__address">ws://${a.address}:${port}</span>
            </div>
        `).join('')
    } catch (e) {
        console.error('Failed to load network addresses:', e)
    }
}

// ──────────────────────────── Configuration ────────────────────────────

async function loadConfig() {
    try {
        const config = await api('/config')
        if (!config) return
        $('#cfgName').value = config.name || ''
        $('#cfgPort').value = config.port || 3737
        $('#cfgPassword').value = config.password || ''
        $('#cfgMaxUsers').value = config.maxUsers || 50
    } catch (e) {
        console.error('Failed to load config:', e)
    }
}

$('#saveConfigBtn').addEventListener('click', async () => {
    const config = {
        name: $('#cfgName').value.trim() || 'Luma Server',
        port: parseInt($('#cfgPort').value) || 3737,
        password: $('#cfgPassword').value || '',
        maxUsers: parseInt($('#cfgMaxUsers').value) || 50,
    }
    try {
        await api('/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config),
        })
        const msg = $('#configSavedMsg')
        msg.classList.remove('hidden')
        setTimeout(() => msg.classList.add('hidden'), 2000)
    } catch (e) {
        console.error('Failed to save config:', e)
    }
})

// ──────────────────────────── Users ────────────────────────────

async function refreshUsers() {
    try {
        connectedUsers = await api('/users') || []
        renderUsers()
    } catch (e) {
        console.error('Failed to get users:', e)
    }
}

function renderUsers() {
    const container = $('#usersList')
    const badge = $('#userCountBadge')
    badge.textContent = connectedUsers.length

    if (connectedUsers.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                <p>No users connected</p>
                <span>Users will appear here when they join</span>
            </div>
        `
        return
    }

    container.innerHTML = connectedUsers.map(u => `
        <div class="user-row" data-user-id="${u.id}">
            <div class="user-row__avatar">${(u.username || '?')[0].toUpperCase()}</div>
            <div class="user-row__info">
                <div class="user-row__name">${esc(u.username)}</div>
                <div class="user-row__meta">${esc(u.ip)} &middot; ${formatTime(u.connectedAt)}</div>
            </div>
            <button class="icon-btn" onclick="kickUser('${u.id}')" title="Kick user">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
        </div>
    `).join('')
}

async function kickUser(userId) {
    try {
        await api(`/kick/${userId}`, { method: 'POST' })
        connectedUsers = connectedUsers.filter(u => u.id !== userId)
        renderUsers()
    } catch (e) {
        console.error('Failed to kick user:', e)
    }
}
window.kickUser = kickUser

// ──────────────────────────── Logs ────────────────────────────

function addLog(entry) {
    logs.push(entry)
    if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS)
    if (currentTab === 'logs') renderLogs()
}

function renderLogs() {
    const container = $('#logsContainer')
    if (logs.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                <p>No logs yet</p>
                <span>Server activity will appear here</span>
            </div>
        `
        return
    }
    const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50
    container.innerHTML = logs.map(e => `
        <div class="log-entry">
            <span class="log-entry__time">${formatLogTime(e.time)}</span>
            <span class="log-entry__level log-entry__level--${e.level}">${e.level}</span>
            <span class="log-entry__message">${esc(e.message)}</span>
        </div>
    `).join('')
    if (wasAtBottom) container.scrollTop = container.scrollHeight
}

$('#clearLogsBtn').addEventListener('click', () => { logs = []; renderLogs() })

// ──────────────────────────── SSE (real-time events) ────────────────────────────

function connectSSE() {
    const es = new EventSource('/api/events')

    es.addEventListener('stats', (e) => {
        try { updateStats(JSON.parse(e.data)) } catch {}
    })

    es.addEventListener('log', (e) => {
        try { addLog(JSON.parse(e.data)) } catch {}
    })

    es.addEventListener('user-connected', (e) => {
        if (currentTab === 'users') refreshUsers()
    })

    es.addEventListener('user-disconnected', (e) => {
        try {
            const data = JSON.parse(e.data)
            connectedUsers = connectedUsers.filter(u => u.id !== data.userId)
            if (currentTab === 'users') renderUsers()
        } catch {}
    })

    es.onerror = () => {
        es.close()
        setTimeout(connectSSE, 3000)
    }
}

// ──────────────────────────── Helpers ────────────────────────────

function esc(str) {
    if (!str) return ''
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function formatTime(iso) {
    if (!iso) return ''
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatLogTime(iso) {
    if (!iso) return ''
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ──────────────────────────── Init ────────────────────────────

async function init() {
    // Load initial data
    try {
        const [stats, existingLogs] = await Promise.all([api('/stats'), api('/logs')])
        if (stats) updateStats(stats)
        if (existingLogs && existingLogs.length) {
            logs = existingLogs
            renderLogs()
        }
    } catch {}

    await loadConfig()
    await loadNetworkAddresses()

    // Connect SSE for real-time updates
    connectSSE()

    // Periodic user refresh when on users tab
    setInterval(() => {
        if (currentTab === 'users') refreshUsers()
    }, 5000)
}

init()
