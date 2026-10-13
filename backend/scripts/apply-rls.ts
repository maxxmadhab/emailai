import { PrismaClient } from '@prisma/client';

async function applyRls() {
  const prisma = new PrismaClient();
  const tables = [
    'users',
    'senders',
    'campaigns',
    'emails',
    'outbox_events',
    'idempotency_keys',
    'slack_connections',
  ];

  console.log('Enabling RLS and Deny-by-default policies on Supabase Postgres...');

  for (const table of tables) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
      console.log(`[RLS ENABLED] Table "${table}"`);
      await prisma.$executeRawUnsafe(
        `DO $$ BEGIN
           IF NOT EXISTS (
             SELECT 1 FROM pg_policies WHERE tablename = '${table}' AND policyname = 'Deny all anon access to ${table}'
           ) THEN
             CREATE POLICY "Deny all anon access to ${table}" ON "${table}" FOR ALL TO anon USING (false);
           END IF;
         END $$;`
      );
      console.log(`[POLICY CREATED] Deny all anon access to "${table}"`);
    } catch (err: any) {
      console.error(`Error on table ${table}:`, err.message);
    }
  }

  await prisma.$disconnect();
  console.log('RLS policies applied successfully!');
}

applyRls().catch(console.error);
