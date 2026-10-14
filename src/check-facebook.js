import { loadConfig, readAccountConfig } from './config.js';
import { checkAccountLogin } from './facebook.js';
import { parseRunArgs, selectAccounts } from './cli.js';

const config = loadConfig();
const args = parseRunArgs(process.argv.slice(2));
const accounts = selectAccounts(readAccountConfig(config), args.account);

const seen = new Set();
const unique = accounts.filter((account) => {
  if (seen.has(account.profileDir)) return false;
  seen.add(account.profileDir);
  return true;
});

console.log(`Checking ${unique.length} Facebook profile(s) on this machine...`);
let allOk = true;
for (const account of unique) {
  process.stdout.write(`- ${account.expectedDisplayName} (${account.sheetAccount})... `);
  const result = await checkAccountLogin(config, account);
  if (result.ok) {
    console.log('OK');
  } else {
    allOk = false;
    console.log(`NOT READY — ${result.reason}`);
  }
}

if (!allOk) {
  console.log('\nSome accounts need attention. Run: npm run login:facebook -- "<Facebook Account from Sheet>"');
  process.exitCode = 1;
} else {
  console.log('\nAll accounts are logged in and ready.');
}
