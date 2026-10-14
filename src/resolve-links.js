import { loadConfig, readAccountConfig } from './config.js';
import { normalizeAccountName, parseRunArgs, selectAccounts } from './cli.js';
import { createFacebookLookupSession, resolvePostedUrl } from './facebook.js';
import { getGoogleClients } from './google.js';
import { needsLinkResolution } from './permalink.js';
import { acquireLock } from './run-lock.js';
import { readTable, updateRow } from './sheet.js';

function log(event, details = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...details }));
}

const config = loadConfig();
const args = parseRunArgs(process.argv.slice(2));
const releaseLock = await acquireLock(config.dataDir, 'resolve-links.lock');
const sessions = new Map();
let hadFailure = false;

async function openSession(account, replace = false) {
  if (replace && sessions.has(account.profileDir)) {
    const previous = sessions.get(account.profileDir);
    await previous.then((session) => session.close()).catch(() => {});
    sessions.delete(account.profileDir);
  }
  if (!sessions.has(account.profileDir)) {
    sessions.set(account.profileDir, createFacebookLookupSession({ config, account }));
  }
  return sessions.get(account.profileDir);
}

function browserWasClosed(error) {
  return /target page, context or browser has been closed|browser has been closed/i.test(String(error?.message || error || ''));
}

try {
  const accounts = selectAccounts(readAccountConfig(config), args.account);
  const accountNames = new Set(accounts.map((account) => normalizeAccountName(account.sheetAccount)));
  const { sheets } = await getGoogleClients(config);
  const table = await readTable(sheets, config);
  const rows = table.rows.filter((row) =>
    (!args.row || row.__rowNumber === args.row) &&
    accountNames.has(normalizeAccountName(row['Facebook Account'])) &&
    needsLinkResolution(row)
  );

  log('permalink-repair-start', { account: args.account || 'all', count: rows.length });
  const requiredAccounts = accounts.filter((account) => rows.some((row) =>
    normalizeAccountName(row['Facebook Account']) === normalizeAccountName(account.sheetAccount)
  ));
  for (const account of requiredAccounts) {
    try {
      await openSession(account);
    } catch (error) {
      sessions.delete(account.profileDir);
      throw new Error(`Cannot resolve links for ${account.sheetAccount}: ${error.message}`);
    }
  }

  for (const row of rows) {
    const account = accounts.find((item) => normalizeAccountName(item.sheetAccount) === normalizeAccountName(row['Facebook Account']));
    try {
      let result;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const session = await openSession(account, attempt > 0);
        result = await resolvePostedUrl({ config, account, row, session });
        if (!browserWasClosed(result.error) || attempt > 0) break;
        log('facebook-session-reopening', { account: account.sheetAccount, row: row.__rowNumber });
      }
      if (result.ok && result.status === 'published') {
        const updates = { 'status post': 'เผยแพร่แล้ว' };
        if (result.url) updates['Posted URL'] = result.url;
        await updateRow(sheets, config, table.headers, row.__rowNumber, updates);
        log('permalink-repaired', { row: row.__rowNumber, postId: row['Post ID'], url: result.url });
      } else if (result.ok && result.status === 'pending') {
        await updateRow(sheets, config, table.headers, row.__rowNumber, {
          'Posted URL': result.url,
          'status post': 'รออนุมัติจากแอดมิน'
        });
        log('post-awaiting-approval', { row: row.__rowNumber, postId: row['Post ID'] });
      } else if (result.ok && result.status === 'removed') {
        await updateRow(sheets, config, table.headers, row.__rowNumber, {
          'Posted URL': result.url,
          'status post': 'โดนลบออกแล้ว'
        });
        log('post-removed', { row: row.__rowNumber, postId: row['Post ID'] });
      } else if (!result.ok) {
        hadFailure = true;
        log('permalink-repair-failed', { row: row.__rowNumber, postId: row['Post ID'], message: result.error?.message });
      } else {
        log('post-not-found-in-my-posted-content', { row: row.__rowNumber, postId: row['Post ID'] });
      }
    } catch (error) {
      hadFailure = true;
      log('permalink-repair-failed', { row: row.__rowNumber, postId: row['Post ID'], message: error.message });
    }
  }
  log('permalink-repair-complete', { checked: rows.length });
} catch (error) {
  hadFailure = true;
  log('permalink-repair-failed', { message: error.message, stack: error.stack });
} finally {
  await Promise.allSettled([...sessions.values()].map(async (sessionPromise) => (await sessionPromise).close()));
  await releaseLock();
}

if (hadFailure) process.exitCode = 1;
