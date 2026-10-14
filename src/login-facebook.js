import readline from 'node:readline/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { loadConfig, readAccountConfig } from './config.js';
import { detectFacebookDisplayName, launchFacebookContext, saveFacebookStorageState } from './facebook.js';

function profileSlug(name) {
  const slug = String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || `account-${Date.now()}`;
}

async function pendingProfileDir(config) {
  const profilesDir = path.join(config.dataDir, 'facebook-profiles');
  const entries = await fs.readdir(profilesDir, { withFileTypes: true }).catch(() => []);
  const pending = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('.login-'))
    .map(async (entry) => {
      const profileDir = path.join(profilesDir, entry.name);
      const stat = await fs.stat(profileDir);
      return { profileDir, modifiedAt: stat.mtimeMs };
    }));
  pending.sort((left, right) => right.modifiedAt - left.modifiedAt);
  return pending[0]?.profileDir || path.join(profilesDir, `.login-${Date.now()}`);
}

async function addDetectedAccount(config, accounts, displayName, temporaryProfileDir) {
  const duplicate = accounts.find((item) => item.sheetAccount.trim().toLowerCase() === displayName.toLowerCase());
  if (duplicate) {
    throw new Error(`Account already exists in accounts.json: ${displayName}. Re-login with: npm run login:facebook -- "${duplicate.sheetAccount}"`);
  }

  const targetProfileDir = path.join(config.dataDir, 'facebook-profiles', profileSlug(displayName));
  await fs.mkdir(path.dirname(targetProfileDir), { recursive: true });
  try {
    await fs.access(targetProfileDir);
    throw new Error(`Chrome profile folder already exists: ${targetProfileDir}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.rename(temporaryProfileDir, targetProfileDir);

  const parsed = JSON.parse(await fs.readFile(config.accountConfigFile, 'utf8'));
  parsed.accounts.push({
    sheetAccount: displayName,
    expectedDisplayName: displayName,
    profileDir: `./data/facebook-profiles/${path.basename(targetProfileDir)}`
  });
  await fs.writeFile(config.accountConfigFile, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  return targetProfileDir;
}

const config = loadConfig();
const accounts = readAccountConfig(config);
const accountArg = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
const isNewAccount = !accountArg;
const account = isNewAccount
  ? {
      sheetAccount: '',
      expectedDisplayName: '',
      profileDir: await pendingProfileDir(config)
    }
  : accounts.find((item) => item.sheetAccount.trim().toLowerCase() === accountArg.trim().toLowerCase());
if (!account) throw new Error(`Account is not mapped in accounts.json: ${accountArg}`);

const context = await launchFacebookContext(config, account, { onScreen: true });
const page = context.pages()[0] || await context.newPage();
let contextClosed = false;
try {
  await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
  console.log(`Chrome profile: ${account.profileDir}`);
  console.log(isNewAccount ? 'Log in to the Facebook account you want to add.' : `Log in as: ${account.expectedDisplayName}`);
  const prompt = readline.createInterface({ input, output });
  await prompt.question('After Facebook login is complete, press Enter here to save the session...');
  prompt.close();

  if (isNewAccount) {
    const displayName = await detectFacebookDisplayName(page);
    const storageState = await context.storageState();
    await context.close();
    contextClosed = true;
    const profileDir = await addDetectedAccount(config, accounts, displayName, account.profileDir);
    await saveFacebookStorageState(config, { profileDir }, storageState);
    console.log(`Facebook account added: ${displayName}`);
    console.log(`Chrome profile: ${profileDir}`);
    console.log('accounts.json updated automatically.');
  } else {
    await saveFacebookStorageState(config, account, context);
    await context.close();
    contextClosed = true;
    console.log('Facebook session saved.');
  }
} finally {
  if (!contextClosed) await context.close().catch(() => {});
}

