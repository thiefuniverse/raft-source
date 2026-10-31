import path from 'node:path';
import { createRequire } from 'node:module';

const appRoot = process.argv[2];
if (!appRoot) throw new Error('Pass the deployed application directory');
const { Client } = createRequire(path.join(appRoot, 'packages/server/package.json'))('pg');
for (const name of ['DATABASE_URL', 'RISINGWAVE_DATABASE_URL']) {
  if (!process.env[name]) throw new Error(`${name} is required`);
  for (let attempt = 1; attempt <= 40; attempt++) {
    const client = new Client({ connectionString: process.env[name], connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      await client.query('SELECT 1');
      console.log(`${name}: ready`);
      break;
    } catch {
      if (attempt === 40) throw new Error(`${name} did not become ready`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    } finally {
      await client.end();
    }
  }
}
