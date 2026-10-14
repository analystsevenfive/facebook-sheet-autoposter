import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccountName, parseRunArgs, selectAccounts } from '../src/cli.js';

const accounts = [
  { sheetAccount: 'Thep Arthur' },
  { sheetAccount: 'Sonthep Simmalee' },
  { sheetAccount: 'Maridori' }
];

test('parses run flags and account selector', () => {
  assert.deepEqual(parseRunArgs(['--dry-run', '--all', '--account', 'Thep Arthur']), {
    dryRun: true,
    all: true,
    popup: false,
    account: 'Thep Arthur',
    recheck: false,
    row: null
  });
  assert.equal(parseRunArgs(['--account=Maridori']).account, 'Maridori');
  assert.equal(parseRunArgs(['--popup']).popup, true);
  assert.equal(parseRunArgs(['--recheck']).recheck, true);
  assert.equal(parseRunArgs(['--row', '12']).row, 12);
});

test('account selector defaults to all accounts', () => {
  assert.deepEqual(selectAccounts(accounts, null), accounts);
  assert.deepEqual(selectAccounts(accounts, 'all'), accounts);
});

test('account selector matches sheetAccount case-insensitively', () => {
  assert.deepEqual(selectAccounts(accounts, ' thep arthur '), [accounts[0]]);
  assert.equal(normalizeAccountName(' Thep Arthur '), 'thep arthur');
});

test('account selector rejects unknown account names', () => {
  assert.throws(() => selectAccounts(accounts, 'Unknown'), /Account is not mapped/);
});
