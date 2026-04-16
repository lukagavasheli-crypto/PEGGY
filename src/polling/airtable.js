const fetch = require('node-fetch');
const { isAirtableMention, extractSummary, resolveAirtableMentions } = require('../util/mention-detector');
const db = require('../db');

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_USER_EMAIL = process.env.AIRTABLE_USER_EMAIL;
const AIRTABLE_API = 'https://api.airtable.com/v0';

const headers = { Authorization: `Bearer ${AIRTABLE_TOKEN}` };

// Discovered tables: { id, name, collaboratorFields: [{ id, name }] }
let cachedTables = [];
let initialCommentScanDone = false;

// Rate limiter: max 4 req/sec per base
let lastRequestTime = 0;
async function throttle() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 250) {
    await new Promise(resolve => setTimeout(resolve, 250 - elapsed));
  }
  lastRequestTime = Date.now();
}

async function apiFetch(url) {
  await throttle();
  const res = await fetch(url, { headers });
  if (res.status === 429) {
    console.log('[airtable] Rate limited, waiting 30s');
    await new Promise(resolve => setTimeout(resolve, 30000));
    throw new Error('RATE_LIMITED');
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable API ${res.status}: ${text}`);
  }
  return res.json();
}

async function discoverTables() {
  try {
    const data = await apiFetch(`https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables`);
    cachedTables = (data.tables || []).map(t => {
      const collabFields = (t.fields || [])
        .filter(f => f.type === 'singleCollaborator' || f.type === 'multipleCollaborators')
        .map(f => ({ id: f.id, name: f.name }));
      // Also find a "Status" field and "Name/Project" field for context
      const statusField = (t.fields || []).find(f => f.name === 'Status');
      const nameField = (t.fields || []).find(f =>
        ['Project', 'Name', 'Title'].includes(f.name)
      );
      // Find date fields for handoff and due dates
      const allFields = t.fields || [];
      const handoffField = allFields.find(f =>
        /handoff/i.test(f.name)
      );
      const dueField = allFields.find(f =>
        /next due date/i.test(f.name) || (/due/i.test(f.name) && /date/i.test(f.name))
      );
      // Log discovered date fields for debugging
      if (handoffField) console.log(`[airtable] Found handoff field "${handoffField.name}" in ${t.name}`);
      if (dueField) console.log(`[airtable] Found due date field "${dueField.name}" in ${t.name}`);
      return {
        id: t.id,
        name: t.name,
        collaboratorFields: collabFields,
        statusFieldName: statusField ? statusField.name : null,
        nameFieldName: nameField ? nameField.name : null,
        handoffFieldName: handoffField ? handoffField.name : null,
        dueFieldName: dueField ? dueField.name : null,
      };
    });
    console.log(`[airtable] Discovered ${cachedTables.length} tables in base`);
    const totalCollabFields = cachedTables.reduce((sum, t) => sum + t.collaboratorFields.length, 0);
    console.log(`[airtable] Found ${totalCollabFields} collaborator fields across all tables`);
  } catch (err) {
    console.error('[airtable] Error discovering tables:', err.message);
  }
  return cachedTables;
}

// Poll for records assigned to the user
async function pollAssignments(broadcast) {
  if (cachedTables.length === 0) await discoverTables();

  let newCount = 0;

  for (const table of cachedTables) {
    if (table.collaboratorFields.length === 0) continue;

    try {
      // Page through all records (assignment polling needs full scan)
      let allRecords = [];
      let offset = null;
      do {
        const url = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${table.id}?pageSize=100${offset ? `&offset=${offset}` : ''}`;
        const data = await apiFetch(url);
        allRecords = allRecords.concat(data.records || []);
        offset = data.offset || null;
      } while (offset);

      for (const record of allRecords) {
        const fields = record.fields || {};
        const recordName = fields[table.nameFieldName] || fields.Project || fields.Name || fields.Title || fields.name || record.id;
        const status = fields[table.statusFieldName] || fields.Status || null;

        // Check each collaborator field for Luka
        const assignedRoles = [];
        for (const cf of table.collaboratorFields) {
          const value = fields[cf.name];
          if (!value) continue;
          const collabs = Array.isArray(value) ? value : [value];
          const isAssigned = collabs.some(c => c.email && c.email.toLowerCase() === AIRTABLE_USER_EMAIL.toLowerCase());
          if (isAssigned) {
            assignedRoles.push(cf.name);
          }
        }

        if (assignedRoles.length === 0) continue;

        // Find the Project Owner collaborator value
        let projectOwner = '';
        const ownerField = fields['Project Owner'] || fields['project owner'];
        if (ownerField) {
          const owners = Array.isArray(ownerField) ? ownerField : [ownerField];
          projectOwner = owners.map(o => o.name || o.email || '').filter(Boolean).join(', ');
        }

        // Extract date fields
        const handoffDate = table.handoffFieldName ? fields[table.handoffFieldName] : null;
        const dueDate = table.dueFieldName ? fields[table.dueFieldName] : null;

        const roleStr = assignedRoles.join(', ');
        const statusStr = status ? ` | Status: ${status}` : '';
        const handoffStr = handoffDate ? ` | Handoff: ${handoffDate}` : '';
        const dueStr = dueDate ? ` | Due: ${dueDate}` : '';
        const summary = `Assigned as ${roleStr}${statusStr}${handoffStr}${dueStr}`;

        const notification = {
          source: 'airtable-assignment',
          source_id: `airtable-assign-${record.id}`,
          source_url: `https://airtable.com/${AIRTABLE_BASE_ID}/${table.id}/${record.id}`,
          summary,
          tagged_by: projectOwner || roleStr,
          tagged_by_img: null,
          file_name: `${table.name} / ${recordName}`,
          timestamp: new Date().toISOString(),
        };

        const inserted = db.insertNotification(notification);
        if (inserted) {
          newCount++;
          if (broadcast) broadcast(inserted);
        }
      }
    } catch (err) {
      if (err.message === 'RATE_LIMITED') {
        console.log('[airtable] Stopping assignment poll due to rate limit');
        break;
      }
      console.error(`[airtable] Error polling assignments in ${table.name}:`, err.message);
    }
  }

  console.log(`[airtable] Assignment poll complete, ${newCount} new assignments`);
  return newCount;
}

async function pollComments(broadcast) {
  if (cachedTables.length === 0) await discoverTables();

  let newCount = 0;

  for (const table of cachedTables) {
    try {
      let records = [];

      if (!initialCommentScanDone) {
        const url = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${table.id}?pageSize=100`;
        try {
          const data = await apiFetch(url);
          records = data.records || [];
        } catch (err) {
          console.error(`[airtable] Error scanning ${table.name}:`, err.message);
          continue;
        }
        console.log(`[airtable] Initial comment scan: ${records.length} records in ${table.name}`);
      } else {
        const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        const formula = encodeURIComponent(`LAST_MODIFIED_TIME()>'${cutoff}'`);
        const recordsUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${table.id}?filterByFormula=${formula}&pageSize=50`;
        try {
          const data = await apiFetch(recordsUrl);
          records = data.records || [];
        } catch (err) {
          if (err.message.includes('422') || err.message.includes('INVALID')) {
            try {
              const data = await apiFetch(`${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${table.id}?pageSize=20`);
              records = data.records || [];
            } catch (fallbackErr) {
              console.error(`[airtable] Error fetching records from ${table.name}:`, fallbackErr.message);
              continue;
            }
          } else {
            throw err;
          }
        }
      }

      for (const record of records) {
        try {
          const commentsUrl = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${table.id}/${record.id}/comments`;
          const commentsData = await apiFetch(commentsUrl);
          const comments = commentsData.comments || [];
          const hwm = db.getHighWaterMark('airtable', record.id);
          const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

          for (const comment of comments) {
            const commentTime = comment.createdTime || comment.created_time;
            if (commentTime && commentTime < oneWeekAgo) continue;
            if (hwm && commentTime && commentTime <= hwm) continue;
            if (!isAirtableMention(comment, AIRTABLE_USER_EMAIL)) continue;

            const fields = record.fields || {};
            const recordName = fields.Project || fields.Name || fields.Title || fields.name || record.id;

            const resolvedText = resolveAirtableMentions(comment.text, comment.mentioned);
            const notification = {
              source: 'airtable',
              source_id: `airtable-${comment.id}`,
              source_url: `https://airtable.com/${AIRTABLE_BASE_ID}/${table.id}/${record.id}`,
              summary: extractSummary(resolvedText),
              tagged_by: comment.author ? (comment.author.name || comment.author.email || 'Unknown') : 'Unknown',
              tagged_by_img: null,
              file_name: `${table.name} / ${recordName}`,
              timestamp: commentTime || new Date().toISOString(),
            };

            const inserted = db.insertNotification(notification);
            if (inserted) {
              newCount++;
              if (broadcast) broadcast(inserted);
            }
          }

          if (comments.length > 0) {
            const latest = comments.reduce((a, b) => {
              const aTime = a.createdTime || a.created_time || '';
              const bTime = b.createdTime || b.created_time || '';
              return aTime > bTime ? a : b;
            });
            const latestTime = latest.createdTime || latest.created_time;
            if (latestTime) db.setHighWaterMark('airtable', record.id, latestTime);
          }
        } catch (err) {
          if (err.message === 'RATE_LIMITED') {
            console.log('[airtable] Stopping comment poll due to rate limit');
            return newCount;
          }
          continue;
        }
      }
    } catch (err) {
      if (err.message === 'RATE_LIMITED') {
        console.log('[airtable] Stopping comment poll due to rate limit');
        break;
      }
      console.error(`[airtable] Error polling table ${table.name}:`, err.message);
    }
  }

  if (!initialCommentScanDone) {
    initialCommentScanDone = true;
    console.log('[airtable] Initial comment scan complete');
  }
  console.log(`[airtable] Comment poll complete, ${newCount} new notifications`);
  return newCount;
}

function getCachedTableCount() {
  return cachedTables.length;
}

module.exports = { discoverTables, pollComments, pollAssignments, getCachedTableCount };
