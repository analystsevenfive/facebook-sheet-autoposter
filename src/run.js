import { loadConfig, readAccountConfig } from './config.js';
import { getGoogleClients } from './google.js';
import { eligibilityReason, selectOldestEligible } from './eligibility.js';
import { formatDurationCell, readRow, readTable, updateRow } from './sheet.js';
import { ensureMedia } from './media.js';
import { createFacebookSession, prepareFacebookPost } from './facebook.js';
import { displayTimestamp, sheetTimestamp } from './time.js';
import { normalizeAccountName, parseRunArgs, selectAccounts } from './cli.js';
import { acquireLock } from './run-lock.js';

const MAX_ROWS_PER_RUN = 2000; // safety cap for --all, not a realistic daily volume
const PENDING_PERMALINK = 'Posted — permalink lookup pending';

function log(event, details = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...details }));
}

function pendingContentUrl(groupUrl) {
  const groupId = String(groupUrl || '').match(/\/groups\/([^/?#]+)/)?.[1];
  return groupId ? `https://www.facebook.com/groups/${encodeURIComponent(groupId)}/my_pending_content` : '';
}

function replaceRow(rows, row) {
  return rows.map((candidate) => candidate.__rowNumber === row.__rowNumber ? row : candidate);
}

async function runPool(items, concurrency, worker) {
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  let index = 0;
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
    }
  }));
}

async function prefetchMissingMedia({ sheets, config, headers, rows, drive, attempted, mediaCache }) {
  const candidates = rows.filter((row) =>
    !attempted.has(row.__rowNumber) &&
    String(row['Local Media Path'] || '').trim() === '' &&
    String(row['Media URL 1'] || '').trim() !== '' &&
    String(row['Posted URL'] || '').trim() === ''
  ).slice(0, config.mediaPrefetchLookahead);
  candidates.forEach((row) => attempted.add(row.__rowNumber));
  await runPool(candidates, config.mediaPrefetchConcurrency, async (row) => {
    try {
      await ensureMedia({
        row,
        drive,
        mediaDir: config.mediaDir,
        mediaCache,
        largeFileBytes: config.largeMediaThresholdBytes,
        onLocalPath: async (localPath) => {
          await updateRow(sheets, config, headers, row.__rowNumber, { 'Local Media Path': localPath });
        }
      });
      log('media-prefetched', { row: row.__rowNumber, postId: row['Post ID'] });
    } catch (error) {
      log('media-prefetch-failed', { row: row.__rowNumber, postId: row['Post ID'], message: error.message });
    }
  });
}

async function writeTerminalState({ sheets, config, headers, row, startMs, updates }) {
  const elapsedDays = (Date.now() - startMs) / 86400000;
  await updateRow(sheets, config, headers, row.__rowNumber, { ...updates, 'time use': elapsedDays });
  await formatDurationCell(sheets, config, headers, row.__rowNumber);
}

// Processes the already-selected row end to end: re-verify, prepare media, post (if live),
// and record the outcome back to the Sheet. Returns 'posted' | 'dry-run-complete' | 'row-changed' | 'failed'.
async function processRow({ config, live, accounts, knownAccounts, sheets, drive, headers, table, selected: initialSelected, excludedPostIds, pendingPermalinks, getFacebookSession, mediaCache }) {
  if (excludedPostIds) excludedPostIds.add(String(initialSelected['Post ID']));
  const startMs = Date.now();
  let selected = initialSelected;
  let prepared = null;
  try {
    const current = await readRow(sheets, config, headers, selected.__rowNumber);
    const currentRows = replaceRow(table.rows, current);
    const reason = eligibilityReason(current, currentRows, new Date(), config.timezone, knownAccounts);
    if (reason || String(current['Post ID']) !== String(selected['Post ID'])) {
      log('row-changed-before-processing', { row: selected.__rowNumber, postId: selected['Post ID'], reason: reason || 'Post ID changed' });
      return 'row-changed';
    }
    selected = current;
    log('selected', {
      mode: live ? 'live' : 'dry-run', row: selected.__rowNumber, postId: selected['Post ID'],
      scheduledTime: selected['Scheduled Time'], account: selected['Facebook Account'], group: selected['Facebook Group URL']
    });
    if (!live) {
      log('dry-run-complete', { note: 'No media, browser, Facebook, or Sheet writes were performed.' });
      return 'dry-run-complete';
    }

    const attempts = Number(selected['Attempt Count'] || 0);
    const mediaPaths = await ensureMedia({
      row: selected,
      drive,
      mediaDir: config.mediaDir,
      mediaCache,
      largeFileBytes: config.largeMediaThresholdBytes,
      onLocalPath: async (localPath) => {
        await updateRow(sheets, config, headers, selected.__rowNumber, { 'Local Media Path': localPath });
        selected['Local Media Path'] = localPath;
      }
    });

    const account = accounts.find((item) => item.sheetAccount.trim().toLowerCase() === String(selected['Facebook Account']).trim().toLowerCase());
    if (!account) throw new Error(`No Facebook profile mapping for Sheet account: ${selected['Facebook Account']}`);

    const session = await getFacebookSession(account);
    prepared = await prepareFacebookPost({ config, account, row: selected, mediaPaths, session });
    await updateRow(sheets, config, headers, selected.__rowNumber, { 'Posting Status': 'Posting' });
    const result = await prepared.submit();
    const postedAt = sheetTimestamp(new Date(), config.timezone);
    const pendingLookup = result.status === 'Posted';
    await writeTerminalState({
      sheets, config, headers, row: selected, startMs,
      updates: {
        'Posting Status': result.status,
        'Attempt Count': attempts + 1,
        'Last Attempt At': '',
        'Posted At': postedAt,
        'Posted URL': pendingLookup ? PENDING_PERMALINK : pendingContentUrl(selected['Facebook Group URL']),
        'status post': pendingLookup ? '' : 'รออนุมัติจากแอดมิน',
        'Error / Notes': ''
      }
    });
    if (pendingLookup && pendingPermalinks) {
      pendingPermalinks.push({
        rowNumber: selected.__rowNumber,
        postId: selected['Post ID'],
        groupUrl: selected['Facebook Group URL'],
        caption: selected.Caption,
        accountName: selected['Facebook Account']
      });
    }
    log('published', { row: selected.__rowNumber, postId: selected['Post ID'], status: result.status });
    return 'posted';
  } catch (error) {
    log('run-failed', { message: error.message, stack: error.stack });
    if (selected && headers) {
      const attempts = Number(selected['Attempt Count'] || 0);
      const submissionStarted = Boolean(error.submissionStarted);
      const now = sheetTimestamp(new Date(), config.timezone);
      const updates = submissionStarted ? {
        'Posting Status': 'Submitted for review',
        'Attempt Count': attempts + 1,
        'Last Attempt At': '',
        'Posted At': now,
        'Posted URL': 'Submission started — outcome/URL requires manual review',
        'status post': 'ตรวจสอบผลการเผยแพร่',
        'Error / Notes': `Manual review required after submission started: ${error.message}`
      } : {
        'Posting Status': 'Failed',
        'Attempt Count': attempts + 1,
        'Last Attempt At': now,
        'Error / Notes': error.message
      };
      await writeTerminalState({ sheets, config, headers, row: selected, startMs, updates }).catch((sheetError) => {
        log('sheet-failure-write-failed', { message: sheetError.message });
      });
    }
    return 'failed';
  } finally {
    if (prepared) await prepared.close().catch(() => {});
  }
}

async function main() {
  const config = loadConfig();
  const args = parseRunArgs(process.argv.slice(2));
  const commandDryRun = args.dryRun;
  const processAll = args.all;
  const live = config.publishEnabled && !commandDryRun;
  const releaseLock = await acquireLock(config.dataDir);
  const facebookSessions = new Map();
  const getFacebookSession = async (account) => {
    const key = account.profileDir;
    if (!facebookSessions.has(key)) {
      facebookSessions.set(key, createFacebookSession({ config, account }));
    }
    try {
      return await facebookSessions.get(key);
    } catch (error) {
      facebookSessions.delete(key);
      throw error;
    }
  };
  let hadFailure = false;
  try {
    const accounts = readAccountConfig(config);
    const activeAccounts = selectAccounts(accounts, args.account);
    const knownAccounts = new Set(activeAccounts.map((item) => normalizeAccountName(item.sheetAccount)));
    log('account-scope', {
      account: args.account || 'all',
      activeAccounts: activeAccounts.map((item) => item.sheetAccount)
    });
    const { sheets, drive } = await getGoogleClients(config);
    // Dry-run never writes to the Sheet, so re-selecting would return the same row forever;
    // track what --all has already shown so each pass moves on to the next one.
    const excludedPostIds = live ? null : new Set();
    const attemptedMediaPrefetchRows = new Set();
    const mediaCache = new Map();
    const pendingPermalinks = [];
    let processedCount = 0;
    const table = await readTable(sheets, config);
    for (const row of table.rows) {
      const mediaUrl = String(row['Media URL 1'] || '').trim();
      const localPath = String(row['Local Media Path'] || '').trim();
      if (mediaUrl && localPath && !mediaCache.has(mediaUrl)) mediaCache.set(mediaUrl, Promise.resolve(localPath));
    }
    let headers = table.headers;
    let remainingRows = table.rows;

    for (let iteration = 0; iteration < MAX_ROWS_PER_RUN; iteration += 1) {
      const candidateRows = excludedPostIds
        ? remainingRows.filter((row) => !excludedPostIds.has(String(row['Post ID'])))
        : remainingRows;
      const selected = selectOldestEligible(candidateRows, new Date(), config.timezone, knownAccounts);
      if (!selected) {
        log('no-eligible-row', { mode: live ? 'live' : 'dry-run', localTime: displayTimestamp(new Date(), config.timezone) });
        break;
      }

      const currentTable = { headers, rows: remainingRows };
      const outcome = await processRow({ config, live, accounts: activeAccounts, knownAccounts, sheets, drive, headers, table: currentTable, selected, excludedPostIds, pendingPermalinks, getFacebookSession, mediaCache });
      remainingRows = remainingRows.filter((row) => row.__rowNumber !== selected.__rowNumber);
      if (outcome === 'posted') processedCount += 1;
      if (outcome === 'failed') hadFailure = true;
      if (live && processAll) {
        await prefetchMissingMedia({ sheets, config, headers, rows: remainingRows, drive, attempted: attemptedMediaPrefetchRows, mediaCache }).catch((error) => {
          log('media-prefetch-run-failed', { message: error.message });
        });
      }
      if (!processAll) break;
    }
    if (processAll) log('batch-complete', { processed: processedCount });

    if (live && pendingPermalinks.length) {
      log('permalink-lookup-deferred', { count: pendingPermalinks.length, command: 'npm run resolve:links' });
    }
  } catch (error) {
    log('run-failed', { message: error.message, stack: error.stack });
    hadFailure = true;
  } finally {
    await Promise.allSettled([...facebookSessions.values()].map(async (sessionPromise) => {
      const session = await sessionPromise;
      await session.close();
    }));
    await releaseLock();
  }
  if (hadFailure) process.exitCode = 1;
}

await main();
