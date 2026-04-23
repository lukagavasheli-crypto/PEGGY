const FIGMA_USER_ID = process.env.FIGMA_USER_ID || '';
const FIGMA_USER_HANDLE = process.env.FIGMA_USER_HANDLE || 'Luka Gavasheli';
const AIRTABLE_USER_EMAIL = process.env.AIRTABLE_USER_EMAIL || 'luka.gavasheli@ro.co';
const AIRTABLE_USER_ID = process.env.AIRTABLE_USER_ID || '';

// Matches @Luka Gavasheli, @luka.gavasheli, or the raw name in text
const namePattern = FIGMA_USER_HANDLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameRegex = new RegExp(`@?${namePattern}`, 'i');

function isFigmaMention(comment, selfUserId) {
  // Skip comments authored by Luka himself
  if (comment.user && comment.user.id === selfUserId) return false;

  const message = comment.message || '';
  if (nameRegex.test(message)) return true;
  if (FIGMA_USER_ID && message.includes(FIGMA_USER_ID)) return true;

  return false;
}

function isAirtableMention(comment, selfEmail) {
  // Skip comments authored by Luka himself
  const authorEmail = comment.author && comment.author.email;
  if (authorEmail && authorEmail.toLowerCase() === selfEmail.toLowerCase()) return false;

  const text = comment.text || '';

  // Check for @[usrXXX] user ID in text (primary Airtable mention format)
  if (AIRTABLE_USER_ID && text.includes(`@[${AIRTABLE_USER_ID}]`)) return true;

  // Check mentioned object for email/name match
  if (comment.mentioned) {
    const mentionedUsers = Object.values(comment.mentioned);
    if (mentionedUsers.some(u => u.email && u.email.toLowerCase() === selfEmail.toLowerCase())) return true;
    if (mentionedUsers.some(u => u.displayName && nameRegex.test(u.displayName))) return true;
    // Also check by Airtable user ID key
    if (AIRTABLE_USER_ID && comment.mentioned[AIRTABLE_USER_ID]) return true;
  }

  // Fallback: plain-text name match (e.g. "Luka and Brian...")
  if (nameRegex.test(text)) return true;

  return false;
}

function extractSummary(text, maxLen = 200) {
  if (!text) return '(no text)';
  // Replace @[usrXXX] references with display names if possible
  let cleaned = text.replace(/\n+/g, ' ').trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + '...' : cleaned;
}

function resolveAirtableMentions(text, mentioned) {
  if (!mentioned) return text;
  let resolved = text;
  for (const [userId, info] of Object.entries(mentioned)) {
    const displayName = info.displayName || info.email || userId;
    resolved = resolved.replace(new RegExp(`@\\[${userId}\\]`, 'g'), `@${displayName}`);
  }
  return resolved;
}

module.exports = { isFigmaMention, isAirtableMention, extractSummary, resolveAirtableMentions };
