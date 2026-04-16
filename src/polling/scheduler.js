const figma = require('./figma');
const airtable = require('./airtable');

const POLL_FIGMA_COMMENTS_MS = parseInt(process.env.POLL_FIGMA_COMMENTS_MS || '120000', 10);
const POLL_FIGMA_DISCOVERY_MS = parseInt(process.env.POLL_FIGMA_DISCOVERY_MS || '1800000', 10);
const POLL_AIRTABLE_MS = parseInt(process.env.POLL_AIRTABLE_MS || '180000', 10);
const POLL_AIRTABLE_ASSIGNMENTS_MS = parseInt(process.env.POLL_AIRTABLE_ASSIGNMENTS_MS || '600000', 10); // 10 min

const state = {
  figmaLastPoll: null,
  figmaLastDiscovery: null,
  airtableLastPoll: null,
  airtableLastAssignmentPoll: null,
  figmaErrors: 0,
  airtableErrors: 0,
};

function getStatus() {
  return {
    figmaFiles: figma.getCachedFileCount(),
    airtableTables: airtable.getCachedTableCount(),
    figmaLastPoll: state.figmaLastPoll,
    figmaLastDiscovery: state.figmaLastDiscovery,
    airtableLastPoll: state.airtableLastPoll,
    airtableLastAssignmentPoll: state.airtableLastAssignmentPoll,
    figmaErrors: state.figmaErrors,
    airtableErrors: state.airtableErrors,
  };
}

function start(broadcast) {
  console.log('[scheduler] Starting polling...');
  console.log(`[scheduler] Figma comments: every ${POLL_FIGMA_COMMENTS_MS / 1000}s`);
  console.log(`[scheduler] Figma discovery: every ${POLL_FIGMA_DISCOVERY_MS / 1000}s`);
  console.log(`[scheduler] Airtable comments: every ${POLL_AIRTABLE_MS / 1000}s`);
  console.log(`[scheduler] Airtable assignments: every ${POLL_AIRTABLE_ASSIGNMENTS_MS / 1000}s`);

  // Initial discovery + polls
  figma.discoverFiles().then(() => {
    state.figmaLastDiscovery = new Date().toISOString();
    return figma.pollComments(broadcast);
  }).then(() => {
    state.figmaLastPoll = new Date().toISOString();
  }).catch(err => {
    state.figmaErrors++;
    console.error('[scheduler] Initial Figma poll error:', err.message);
  });

  airtable.discoverTables().then(async () => {
    // Run assignments first (doesn't need per-record comment API calls)
    try {
      await airtable.pollAssignments(broadcast);
      state.airtableLastAssignmentPoll = new Date().toISOString();
    } catch (err) {
      state.airtableErrors++;
      console.error('[scheduler] Initial Airtable assignment poll error:', err.message);
    }
    // Then comments
    try {
      await airtable.pollComments(broadcast);
      state.airtableLastPoll = new Date().toISOString();
    } catch (err) {
      state.airtableErrors++;
      console.error('[scheduler] Initial Airtable comment poll error:', err.message);
    }
  });

  // Recurring polls
  setInterval(async () => {
    try {
      await figma.pollComments(broadcast);
      state.figmaLastPoll = new Date().toISOString();
    } catch (err) {
      state.figmaErrors++;
      console.error('[scheduler] Figma comment poll error:', err.message);
    }
  }, POLL_FIGMA_COMMENTS_MS);

  setInterval(async () => {
    try {
      await figma.discoverFiles();
      state.figmaLastDiscovery = new Date().toISOString();
    } catch (err) {
      state.figmaErrors++;
      console.error('[scheduler] Figma discovery error:', err.message);
    }
  }, POLL_FIGMA_DISCOVERY_MS);

  setInterval(async () => {
    try {
      await airtable.pollComments(broadcast);
      state.airtableLastPoll = new Date().toISOString();
    } catch (err) {
      state.airtableErrors++;
      console.error('[scheduler] Airtable comment poll error:', err.message);
    }
  }, POLL_AIRTABLE_MS);

  setInterval(async () => {
    try {
      await airtable.pollAssignments(broadcast);
      state.airtableLastAssignmentPoll = new Date().toISOString();
    } catch (err) {
      state.airtableErrors++;
      console.error('[scheduler] Airtable assignment poll error:', err.message);
    }
  }, POLL_AIRTABLE_ASSIGNMENTS_MS);
}

module.exports = { start, getStatus };
