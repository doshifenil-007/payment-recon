import bcrypt from 'bcryptjs';
import { pool } from '../lib/db';
import { runMigrations } from './migrate';

// Initial credentials are supplied at runtime and are never stored in source control.
const MERCHANT_GATEWAY_ID = 'merchant_demo';

function getUsers() {
  const adminEmail = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    throw new Error('Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD before seeding.');
  }
  if (adminPassword.length < 12) {
    throw new Error('INITIAL_ADMIN_PASSWORD must be at least 12 characters.');
  }

  const users: { email: string; password: string; role: 'ADMIN' | 'VIEWER' }[] = [
    { email: adminEmail, password: adminPassword, role: 'ADMIN' },
  ];

  const viewerEmail = process.env.INITIAL_VIEWER_EMAIL?.trim().toLowerCase();
  const viewerPassword = process.env.INITIAL_VIEWER_PASSWORD;
  if (Boolean(viewerEmail) !== Boolean(viewerPassword)) {
    throw new Error('Set both INITIAL_VIEWER_EMAIL and INITIAL_VIEWER_PASSWORD, or neither.');
  }
  if (viewerEmail && viewerPassword) {
    if (viewerPassword.length < 12) {
      throw new Error('INITIAL_VIEWER_PASSWORD must be at least 12 characters.');
    }
    users.push({ email: viewerEmail, password: viewerPassword, role: 'VIEWER' });
  }

  return users;
}

async function seed() {
  const users = getUsers();
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
       ON CONFLICT (email) DO UPDATE
       SET merchant_id = EXCLUDED.merchant_id,
           password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role`,
      [merchantId, u.email, hash, u.role],
    );
  }
  console.log(`Seeded merchant ${MERCHANT_GATEWAY_ID} with users: ${users.map((u) => u.email).join(', ')}`);
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
