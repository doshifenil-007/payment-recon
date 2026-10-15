import bcrypt from 'bcryptjs';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env';
import { pool } from '../../lib/db';
import { requireAuth, SESSION_COOKIE } from '../../middleware/auth';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

// Used when the email is unknown, so a failed login takes about as long as a real one.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

type UserRow = { id: string; merchant_id: string; email: string; password_hash: string; role: 'ADMIN' | 'VIEWER' };

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid login request' });
    return;
  }
  const { email, password } = parsed.data;

  const user = (
    await pool.query<UserRow>(
      'SELECT id, merchant_id, email, password_hash, role FROM users WHERE email = $1',
      [email],
    )
  ).rows[0];

  const valid = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !valid) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const token = jwt.sign({ sub: user.id, role: user.role, merchantId: user.merchant_id }, env.JWT_SECRET, {
    expiresIn: '8h',
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // JavaScript on the page cannot read the token
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000,
  });
  res.json({ id: user.id, email: user.email, role: user.role });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});
