import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';
import { getEnv } from '../config/env.js';

const router = Router();

/**
 * GET /api/auth/me
 * Returns current authenticated user details.
 */
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const prisma = getPrisma();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      avatar_url: true,
      created_at: true,
      updated_at: true,
    },
  });

  if (!user) {
    return res.status(200).json({
      data: req.user,
    });
  }

  return res.status(200).json({
    data: user,
  });
});

/**
 * POST /api/auth/demo-token
 * Generates an instantaneous valid Supabase JWT for evaluation/demo matching the Figma persona ("Oliver Brown").
 * Also works if Google OAuth client ID is not configured on a local machine.
 */
router.post('/demo-token', async (req: Request, res: Response) => {
  const email = req.body?.email || 'oliver.brown@domain.io';
  const name = req.body?.name || 'Oliver Brown';
  const id = req.body?.id || 'd3b07384-d113-4670-8ce6-904d90956488';
  const avatarUrl = req.body?.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80';

  const secret = getEnv().SUPABASE_JWT_SECRET;
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    {
      sub: id,
      email,
      aud: 'authenticated',
      role: 'authenticated',
      iat: now,
      exp: now + 7 * 24 * 3600,
      user_metadata: {
        name,
        full_name: name,
        avatar_url: avatarUrl,
      },
    },
    secret,
    { algorithm: 'HS256' }
  );

  try {
    const prisma = getPrisma();
    await prisma.user.upsert({
      where: { id },
      update: { email, name, avatar_url: avatarUrl },
      create: { id, email, name, avatar_url: avatarUrl },
    });
  } catch {
    // If DB is offline, token is still cryptographically valid
  }

  return res.status(200).json({
    data: {
      token,
      user: {
        id,
        email,
        name,
        avatar_url: avatarUrl,
      },
    },
  });
});

export default router;
