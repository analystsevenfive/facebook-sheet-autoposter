import fs from 'node:fs/promises';
import path from 'node:path';

function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export async function acquireLock(dataDir, lockName = 'run.lock') {
  await fs.mkdir(dataDir, { recursive: true });
  const lockPath = path.join(dataDir, lockName);
  let handle;
  try {
    handle = await fs.open(lockPath, 'wx');
    await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
  } catch (error) {
    if (error.code === 'EEXIST') {
      const contents = await fs.readFile(lockPath, 'utf8').catch(() => '');
      const lockPid = Number.parseInt(contents.split(/\r?\n/, 1)[0], 10);
      if (processIsRunning(lockPid)) throw new Error(`Another run is active (${lockPath}).`);
      await fs.unlink(lockPath).catch(() => {});
      return acquireLock(dataDir, lockName);
    }
    throw error;
  }
  return async () => {
    await handle.close().catch(() => {});
    await fs.unlink(lockPath).catch(() => {});
  };
}
