import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';

const router = Router();

/**
 * GET /api/auth/me
 * Returns current authenticated user details.
 *
 * NOTE ON ASSIGNMENT AUTH MAPPING:
 * The frontend uses Supabase Auth SDK directly with the Google OAuth provider.
 * When the user logs in via Google, Supabase issues an access token (JWT).
 * The frontend attaches this token as `Authorization: Bearer <token>` to all API requests.
 * Express verifies the token using the Supabase JWT secret and upserts the user in the database.
 * Logout is handled client-side via `supabase.auth.signOut()`.
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

export default router;
