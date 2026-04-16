const fetch = require('node-fetch');
const { isFigmaMention, extractSummary } = require('../util/mention-detector');
const db = require('../db');

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FIGMA_USER_ID = process.env.FIGMA_USER_ID;
const FIGMA_API = 'https://api.figma.com/v1';

const headers = { 'X-Figma-Token': FIGMA_TOKEN };

// Cache of discovered files: { key, name, last_modified }
let cachedFiles = [];

async function apiFetch(url) {
  const res = await fetch(url, { headers });
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') || '30', 10);
    console.log(`[figma] Rate limited, retry after ${retryAfter}s`);
    throw new Error(`RATE_LIMITED:${retryAfter}`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Figma API ${res.status}: ${text}`);
  }
  return res.json();
}

async function discoverFiles() {
  const teamIds = (process.env.FIGMA_TEAM_IDS || '').split(',').filter(Boolean);
  const files = [];

  for (const teamId of teamIds) {
    try {
      const projectsData = await apiFetch(`${FIGMA_API}/teams/${teamId}/projects`);
      for (const project of projectsData.projects || []) {
        try {
          const filesData = await apiFetch(`${FIGMA_API}/projects/${project.id}/files`);
          for (const file of filesData.files || []) {
            files.push({
              key: file.key,
              name: file.name,
              lastModified: file.last_modified,
              projectName: project.name,
            });
          }
        } catch (err) {
          console.error(`[figma] Error fetching files for project ${project.name}:`, err.message);
        }
      }
    } catch (err) {
      console.error(`[figma] Error fetching projects for team ${teamId}:`, err.message);
    }
  }

  cachedFiles = files;
  console.log(`[figma] Discovered ${files.length} files across ${teamIds.length} teams`);
  return files;
}

async function pollComments(broadcast) {
  if (cachedFiles.length === 0) {
    console.log('[figma] No files cached, running discovery first');
    await discoverFiles();
  }

  let newCount = 0;

  for (const file of cachedFiles) {
    try {
      const data = await apiFetch(`${FIGMA_API}/files/${file.key}/comments`);
      const comments = data.comments || [];
      const hwm = db.getHighWaterMark('figma', file.key);

      for (const comment of comments) {
        // Skip comments older than high water mark or older than 7 days
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        if (comment.created_at < oneWeekAgo) continue;
        if (hwm && comment.created_at <= hwm) continue;

        if (!isFigmaMention(comment, FIGMA_USER_ID)) continue;

        const notification = {
          source: 'figma',
          source_id: `figma-${comment.id}`,
          source_url: `https://www.figma.com/design/${file.key}`,
          summary: extractSummary(comment.message),
          tagged_by: comment.user ? comment.user.handle : 'Unknown',
          tagged_by_img: comment.user ? comment.user.img_url : null,
          file_name: file.name,
          timestamp: comment.created_at,
        };

        const inserted = db.insertNotification(notification);
        if (inserted) {
          newCount++;
          if (broadcast) broadcast(inserted);
        }
      }

      // Update high water mark to latest comment time
      if (comments.length > 0) {
        const latest = comments.reduce((a, b) => a.created_at > b.created_at ? a : b);
        db.setHighWaterMark('figma', file.key, latest.created_at);
      }
    } catch (err) {
      if (err.message.startsWith('RATE_LIMITED')) {
        console.log('[figma] Stopping poll cycle due to rate limit');
        break;
      }
      console.error(`[figma] Error polling ${file.name}:`, err.message);
    }
  }

  console.log(`[figma] Poll complete, ${newCount} new notifications`);
  return newCount;
}

function getCachedFileCount() {
  return cachedFiles.length;
}

module.exports = { discoverFiles, pollComments, getCachedFileCount };
