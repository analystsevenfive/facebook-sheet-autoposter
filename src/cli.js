export function normalizeAccountName(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function parseRunArgs(argv) {
  const args = {
    dryRun: false,
    all: false,
    popup: false,
    account: null,
    recheck: false,
    row: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--all') {
      args.all = true;
    } else if (arg === '--popup') {
      args.popup = true;
    } else if (arg === '--recheck') {
      args.recheck = true;
    } else if (arg === '--row') {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 2) throw new Error('Invalid value for --row. Use a Sheet row number of 2 or greater.');
      args.row = value;
      index += 1;
    } else if (arg.startsWith('--row=')) {
      const value = Number(arg.slice('--row='.length));
      if (!Number.isInteger(value) || value < 2) throw new Error('Invalid value for --row. Use a Sheet row number of 2 or greater.');
      args.row = value;
    } else if (arg === '--account') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) throw new Error('Missing value for --account.');
      args.account = value;
      index += 1;
    } else if (arg.startsWith('--account=')) {
      const value = arg.slice('--account='.length);
      if (!value) throw new Error('Missing value for --account.');
      args.account = value;
    }
  }

  return args;
}

export function selectAccounts(accounts, accountArg) {
  const requested = normalizeAccountName(accountArg);
  if (!requested || requested === 'all') return accounts;

  const selected = accounts.filter((account) => normalizeAccountName(account.sheetAccount) === requested);
  if (!selected.length) {
    throw new Error(`Account is not mapped in accounts.json: ${accountArg}. Available: ${accounts.map((account) => account.sheetAccount).join(', ')}`);
  }
  return selected;
}
