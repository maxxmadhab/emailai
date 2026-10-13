import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verify() {
  try {
    const info: any = await prisma.$queryRaw`SELECT current_database() as database_name, current_user as user_name, version() as pg_version, NOW() as server_time;`;

    const tables: any = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `;

    const rlsStatus: any = await prisma.$queryRaw`
      SELECT relname as table_name, relrowsecurity as rls_enabled 
      FROM pg_class 
      JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace 
      WHERE pg_namespace.nspname = 'public' AND relkind = 'r'
      ORDER BY relname;
    `;

    console.log('=== SUPABASE CONNECTION VERIFICATION REPORT ===');
    console.log('Database:', info[0].database_name);
    console.log('Connected User:', info[0].user_name);
    console.log('Supabase Server Time:', info[0].server_time);
    console.log('PostgreSQL Version:', info[0].pg_version.split(',')[0]);
    console.log('\n=== TABLES CREATED IN SUPABASE ===');
    tables.forEach((t: any) => console.log(`  ✓ ${t.table_name}`));
    console.log('\n=== ROW LEVEL SECURITY (RLS) STATUS ===');
    rlsStatus.forEach((r: any) => console.log(`  ✓ ${r.table_name}: RLS ${r.rls_enabled ? 'ENABLED' : 'DISABLED'}`));
  } catch (err: any) {
    console.error('Connection failed:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

verify();
