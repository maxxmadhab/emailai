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
  // Test with encoded @ (maxxmad123%40)
  const ok1 = await testUrl(
    'postgresql://postgres:maxxmad123%40@db.mhsgfvxzxgqyirldhcim.supabase.co:5432/postgres',
    'Encoded Password (maxxmad123%40)'
  );

  if (!ok1) {
    // Test with plain maxxmad123 (without trailing @)
    await testUrl(
      'postgresql://postgres:maxxmad123@db.mhsgfvxzxgqyirldhcim.supabase.co:5432/postgres',
      'Plain Password (maxxmad123)'
    );
  }
}

run();
