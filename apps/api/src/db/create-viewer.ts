import bcrypt from 'bcryptjs';
import { pool } from '../lib/db';

async function createViewer() {
  const email = process.env.INITIAL_VIEWER_EMAIL?.trim().toLowerCase();
  const password = process.env.INITIAL_VIEWER_PASSWORD;

  if (!email || !password) {
    throw new Error('Set INITIAL_VIEWER_EMAIL and INITIAL_VIEWER_PASSWORD before creating a viewer.');
  }
  if (password.length < 12) {
    throw new Error('INITIAL_VIEWER_PASSWORD must be at least 12 characters.');
  }

  const merchant = await pool.query<{ id: string }>(
    'SELECT id FROM merchants WHERE gateway_merchant_id = $1',
    ['merchant_demo'],
  );
  if (!merchant.rowCount) {
    throw new Error('Demo merchant merchant_demo was not found. Run database migrations and seed the merchant first.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query<{ id: string; email: string; role: string }>(
    `INSERT INTO users (merchant_id, email, password_hash, role)
     VALUES ($1, $2, $3, 'VIEWER')
     ON CONFLICT (email) DO UPDATE
     SET merchant_id = EXCLUDED.merchant_id,
         password_hash = EXCLUDED.password_hash
     WHERE users.role = 'VIEWER'
     RETURNING id, email, role`,
    [merchant.rows[0]!.id, email, passwordHash],
  );

  if (!result.rowCount) {
    throw new Error(`Cannot create viewer: ${email} already belongs to a non-viewer account.`);
  }

  console.log(`Viewer ready: ${result.rows[0]!.email} (${result.rows[0]!.id})`);
}

createViewer()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await pool.end();
    process.exitCode = 1;
  });
