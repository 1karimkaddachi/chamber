import path from 'node:path';
import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.error('TEST_DATABASE_URL is not set. Add it to .env (see .env.example).');
  process.exit(1);
}

const prismaCli = path.resolve('node_modules/prisma/build/index.js');
const result = spawnSync(
  process.execPath,
  [prismaCli, 'migrate', 'deploy', '--schema', 'packages/db/prisma/schema.prisma'],
  {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
