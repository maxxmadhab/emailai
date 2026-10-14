import { PrismaClient } from '@prisma/client';

async function testUrl(url: string, label: string) {
  console.log(`[TEST] Testing ${label}...`);
  const prisma = new PrismaClient({
    datasources: { db: { url } },
  });
  try {
    const result = await prisma.$queryRaw<Array<{ current_time: Date }>>`SELECT NOW() as current_time;`;
    console.log(`[SUCCESS] Connected successfully with ${label}! Result:`, result);
    await prisma.$disconnect();
    return true;
  } catch (error: any) {
    console.log(`[FAILED] ${label}:`, error.message);
    await prisma.$disconnect();
    return false;
  }
}

async function run() {
  await testUrl(
    'postgresql://postgres.mhsgfvxzxgqyirldhcim:maxxmad123%40@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres',
    'Pooler Session (ap-southeast-2:5432)'
  );
  await testUrl(
    'postgresql://postgres.mhsgfvxzxgqyirldhcim:maxxmad123%40@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true',
    'Pooler Transaction (ap-southeast-2:6543)'
  );
  await testUrl(
    'postgresql://postgres.mhsgfvxzxgqyirldhcim:maxxmad123@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres',
    'Pooler Session with plain password (ap-southeast-2:5432)'
  );
}

run();
