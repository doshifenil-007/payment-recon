import bcrypt from 'bcryptjs';
import { pool } from '../lib/db';
import { runMigrations } from './migrate';

// Demo data only. Change these passwords before you show the project anywhere public.
const MERCHANT_GATEWAY_ID = 'merchant_demo';
const USERS = [
  { email: 'admin@demo.test', password: 'Admin123!', role: 'ADMIN' },
  { email: 'viewer@demo.test', password: 'Viewer123!', role: 'VIEWER' },
] as const;

async function seed() {
  await runMigrations();
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (name, gateway_merchant_id) VALUES ('Demo Store', $1)
     ON CONFLICT (gateway_merchant_id) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [MERCHANT_GATEWAY_ID],
  );
  const merchantId = merchant.rows[0]!.id;

  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, 12);
    await pool.query(
      `INSERT INTO users (merchant_id, email, password_hash, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      [merchantId, u.email, hash, u.role],
    );
  }
  console.log(`Seeded merchant ${MERCHANT_GATEWAY_ID} with users: ${USERS.map((u) => u.email).join(', ')}`);
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
