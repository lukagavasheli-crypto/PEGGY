let notifications = [];
let todos = [];

const projectsListEl = document.getElementById('projects-list');
const notifsListEl = document.getElementById('notifications-list');
const todosListEl = document.getElementById('todos-list');
const markProjectsBtn = document.getElementById('mark-projects-seen');
const markNotifsBtn = document.getElementById('mark-notifs-seen');
const addTodoBtn = document.getElementById('add-todo-btn');
const todoForm = document.getElementById('todo-form');
const todoInput = document.getElementById('todo-input');
const todoPriority = document.getElementById('todo-priority');
const todoSaveBtn = document.getElementById('todo-save');
const lastUpdatedEl = document.getElementById('last-updated');
const figmaStatusEl = document.getElementById('figma-status');
const airtableStatusEl = document.getElementById('airtable-status');
const fileCountEl = document.getElementById('file-count');

if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

function timeAgo(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDate(date) {
  const month = date.toLocaleDateString('en-US', { month: 'long' });
  const day = date.getDate();
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${month} ${day}  ${time}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

const arrowSvg = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 17L17 7M17 7H7M17 7V17"/></svg>`;
const closeSvg = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>`;
const checkSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;

const figmaLogoSvg = `<svg width="20" height="20" viewBox="0 0 38 57" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE"/>
  <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83"/>
  <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262"/>
  <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E"/>
  <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF"/>
</svg>`;

const airtableLogoSvg = `<svg width="20" height="20" viewBox="0 0 200 170" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M90.04 2.97L17.07 30.26c-4.43 1.66-4.55 7.88-.18 9.69l73.42 28.81c6.12 2.4 12.89 2.4 19.01 0l73.42-28.81c4.37-1.72 4.25-7.94-.18-9.69L109.58 2.97a26.03 26.03 0 0 0-19.54 0z" fill="#FCB400"/>
  <path d="M104.02 77.87v80.47c0 3.88 3.98 6.53 7.53 5.01l83.56-33.47c2.35-.94 3.89-3.22 3.89-5.74V43.67c0-3.88-3.98-6.53-7.53-5.01l-83.56 33.47a6.18 6.18 0 0 0-3.89 5.74z" fill="#20B2AA"/>
  <path d="M91.55 80.42L59.49 64.33 7.19 38.12C2.84 35.93-1 39.72-1 44.48v76.58c0 1.9 1.02 3.66 2.67 4.61l85.34 49.04c3.14 1.81 6.96-.72 6.96-4.37V83.62a3.65 3.65 0 0 0-2.42-3.2z" fill="#FC6D26"/>
</svg>`;


// ── Render projects (airtable-assignment source) ──

function renderProjectCard(n) {
  const isSeen = n.status === 'seen';

  // Map Airtable status to display badge
  const statusMatch = n.summary.match(/Status:\s*([^|]+)/i);
  const rawStatus = statusMatch ? statusMatch[1].trim().toLowerCase() : '';

  const statusMap = {
    'creative (r1)':        { cls: 'creative-r1', label: 'Creative (R1)' },
    'creative review':      { cls: 'creative-r1', label: 'Creative (R1)' },
    'creative updates (r2)':{ cls: 'creative-r2', label: 'Creative Updates (R2)' },
    'final updates':        { cls: 'final-updates', label: 'Final Updates' },
    'clear updates':        { cls: 'clear-updates', label: 'Clear Updates' },
  };

  const mapped = statusMap[rawStatus];
  const statusBadge = mapped
    ? `<span class="status-badge ${mapped.cls}">${mapped.label}</span>`
    : '';

  // Parse handoff and due dates from summary
  const handoffMatch = n.summary.match(/Handoff:\s*(\S+)/);
  const dueMatch = n.summary.match(/Due:\s*(\S+)/);

  let handoffHtml = '';
  if (handoffMatch) {
    const d = new Date(handoffMatch[1]);
    if (!isNaN(d)) {
      handoffHtml = `
        <div class="meta-group">
          <span class="meta-label">Handoff date:</span>
          <span class="meta-value">${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
        </div>`;
    }
  }

  let dueBadgeHtml = '';
  if (dueMatch) {
    const d = new Date(dueMatch[1]);
    if (!isNaN(d)) {
      const today = new Date();
      today.setHours(0,0,0,0);
      const dueDay = new Date(d);
      dueDay.setHours(0,0,0,0);
      const isPast = dueDay <= today;
      const dueLabel = isPast ? 'Today' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const dueClass = isPast ? 'due-urgent' : 'due-soon';
      dueBadgeHtml = `
        <div class="due-date-badge ${dueClass}">
          <span class="due-label">Next due date:</span>
          <span class="due-value">${dueLabel}</span>
        </div>`;
    }
  }

  return `
    <div class="project-wrapper ${isSeen ? 'seen' : ''}" data-id="${n.id}">
      <div class="project-card">
        <div class="project-card-top-row">
          <div class="project-card-title">${escapeHtml(n.file_name || n.summary)}</div>
          ${statusBadge}
        </div>
        <div class="project-card-dates">
          ${handoffHtml}
          ${dueBadgeHtml}
        </div>
      </div>
      <div class="project-actions">
        <button class="btn-pill cream" onclick="markSeen(${n.id})">${closeSvg} Clear project</button>
        ${n.source_url ? `<a class="btn-open cream" href="${n.source_url}" target="_blank">${arrowSvg}</a>` : ''}
      </div>
    </div>
  `;
}

// ── Render notifications (figma + airtable mentions) ──

function renderNotificationCard(n) {
  const isSeen = n.status === 'seen';
  const logoSvg = n.source === 'figma' ? figmaLogoSvg : airtableLogoSvg;
  const avatarHtml = `<div class="avatar source-logo">${logoSvg}</div>`;

  const fileNamePill = n.file_name
    ? `<span class="file-name-pill">${escapeHtml(n.file_name)}</span>`
    : '';

  return `
    <div class="notif-wrapper ${isSeen ? 'seen' : ''}" data-id="${n.id}">
      <div class="notification-card">
        <div class="notif-top-row">
          ${avatarHtml}
          <div class="notif-author-block">
            <span class="tagged-by">${escapeHtml(n.tagged_by)}</span>
            <span class="notif-time">${timeAgo(n.timestamp)}</span>
          </div>
          ${fileNamePill}
        </div>
        <div class="summary">${escapeHtml(n.summary)}</div>
      </div>
      <div class="notif-actions">
        <button class="btn-pill dark" onclick="markSeen(${n.id})">${closeSvg} Clear project</button>
        ${n.source_url ? `<a class="btn-open dark" href="${n.source_url}" target="_blank">${arrowSvg}</a>` : ''}
      </div>
    </div>
  `;
}

// ── Render todos ──

function renderTodoCard(t) {
  return `
    <div class="todo-card" data-id="${t.id}">
      <div class="todo-text">${escapeHtml(t.text)}</div>
      <div class="todo-actions">
        <span class="priority-tag ${t.priority}">${t.priority === 'high' ? 'High priority' : 'Low priority'}</span>
        <button class="btn-pill todo-clear" onclick="clearTodo(${t.id})">${closeSvg} Clear task</button>
      </div>
    </div>
  `;
}

// ── Main render ──

function render() {
  try {
  const visibleStatuses = /status:\s*(creative \(r1\)|creative review|creative updates \(r2\)|final updates|clear updates)/i;
  const projects = notifications.filter(n => n.source === 'airtable-assignment' && visibleStatuses.test(n.summary));
  const notifs = notifications.filter(n => n.source !== 'airtable-assignment');

  const unread = notifications.filter(n => n.status === 'new').length;
  document.title = unread > 0 ? `(${unread}) PEGGY` : 'PEGGY';

  if (projects.length === 0) {
    projectsListEl.innerHTML = '<div class="empty-state">No project assignments yet.</div>';
  } else {
    projectsListEl.innerHTML = projects.map(renderProjectCard).join('');
  }

  if (notifs.length === 0) {
    notifsListEl.innerHTML = '<div class="empty-state">No notifications yet.</div>';
  } else {
    notifsListEl.innerHTML = notifs.map(renderNotificationCard).join('');
  }

  if (todos.length === 0) {
    todosListEl.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No tasks yet. Add one!</div>';
  } else {
    todosListEl.innerHTML = todos.map(renderTodoCard).join('');
  }

  lastUpdatedEl.textContent = formatDate(new Date());
  } catch (err) {
    console.error('Render error:', err);
  }
}

// ── API calls ──

async function loadNotifications() {
  try {
    const res = await fetch('/api/notifications');
    notifications = await res.json();
    console.log('Loaded notifications:', notifications.length);
    console.log('Assignments:', notifications.filter(n => n.source === 'airtable-assignment').length);
    render();
  } catch (err) {
    console.error('Failed to load notifications:', err);
  }
}

async function loadTodos() {
  try {
    const res = await fetch('/api/todos');
    todos = await res.json();
    render();
  } catch (err) {
    console.error('Failed to load todos:', err);
  }
}

async function markSeen(id) {
  try {
    await fetch(`/api/notifications/${id}/seen`, { method: 'PATCH' });
    notifications = notifications.filter(n => n.id !== id);
    render();
  } catch (err) {
    console.error('Failed to mark seen:', err);
  }
}

async function markAllSeen(source) {
  try {
    await fetch('/api/notifications/mark-all-seen', { method: 'POST' });
    if (source === 'projects') {
      notifications.filter(n => n.source === 'airtable-assignment').forEach(n => n.status = 'seen');
    } else {
      notifications.filter(n => n.source !== 'airtable-assignment').forEach(n => n.status = 'seen');
    }
    render();
  } catch (err) {
    console.error('Failed to mark all seen:', err);
  }
}

async function addTodo() {
  const text = todoInput.value.trim();
  if (!text) return;
  try {
    const res = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, priority: todoPriority.value }),
    });
    const todo = await res.json();
    todos.unshift(todo);
    todoInput.value = '';
    todoForm.classList.add('hidden');
    render();
  } catch (err) {
    console.error('Failed to add todo:', err);
  }
}

async function clearTodo(id) {
  try {
    await fetch(`/api/todos/${id}`, { method: 'DELETE' });
    todos = todos.filter(t => t.id !== id);
    render();
  } catch (err) {
    console.error('Failed to clear todo:', err);
  }
}

// ── Event listeners ──

markProjectsBtn.addEventListener('click', () => markAllSeen('projects'));
markNotifsBtn.addEventListener('click', () => markAllSeen('notifications'));

addTodoBtn.addEventListener('click', () => {
  todoForm.classList.toggle('hidden');
  if (!todoForm.classList.contains('hidden')) todoInput.focus();
});

todoSaveBtn.addEventListener('click', addTodo);
todoInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addTodo();
});

// ── SSE for real-time updates ──

function connectSSE() {
  const eventSource = new EventSource('/api/events');

  eventSource.onmessage = (event) => {
    try {
      const notification = JSON.parse(event.data);
      notifications.unshift(notification);
      render();

      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`${notification.tagged_by} tagged you`, {
          body: notification.summary.slice(0, 100),
          icon: notification.tagged_by_img || undefined,
        });
      }
    } catch (err) {
      console.error('SSE parse error:', err);
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
    setTimeout(connectSSE, 5000);
  };
}

// ── Status bar ──

async function updateStatus() {
  try {
    const res = await fetch('/api/status');
    const s = await res.json();
    figmaStatusEl.textContent = `Figma: ${s.figmaLastPoll ? timeAgo(s.figmaLastPoll) : 'pending'}`;
    airtableStatusEl.textContent = `Airtable: ${s.airtableLastPoll ? timeAgo(s.airtableLastPoll) : 'pending'}`;
    fileCountEl.textContent = `Files: ${s.figmaFiles} | Tables: ${s.airtableTables}`;
  } catch (err) {
    // ignore
  }
}

setInterval(() => {
  render();
  updateStatus();
}, 30000);

// ── Init ──

loadNotifications();
loadTodos();
connectSSE();
updateStatus();
