#!/usr/bin/env node
import { getDatabaseService } from '../src/db/index.js';
import { IdentityRetirementService } from '../src/auth/identityRetirementService.js';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');
  const showHelp = args.includes('--help') || args.includes('-h');

  if (showHelp) {
    console.log(`
DORMEX Governance-Safe Identity Retirement Tool (Stage 6)
========================================================
Usage:
  npx tsx scripts/retire-identities.ts [options] [identifiers...]

Options:
  --execute    Actually execute the deactivation, credential scrambling, session revocation, and audit logging.
               Without this flag, the tool runs in DRY RUN mode by default.
  --all-demo   Assess/retire all synthetic demo accounts (DEMO-001 through DEMO-030).
  --help, -h   Show this help message.

Examples:
  npx tsx scripts/retire-identities.ts --dry-run DEMO-001 ADM002
  npx tsx scripts/retire-identities.ts --execute --all-demo
`);
    process.exit(0);
  }

  const db = getDatabaseService();
  const service = new IdentityRetirementService(db);

  let targetIds = args.filter((a) => !a.startsWith('--') && !a.startsWith('-'));

  if (args.includes('--all-demo')) {
    const demoIds = Array.from({ length: 30 }, (_, i) => `DEMO-${String(i + 1).padStart(3, '0')}`);
    targetIds = Array.from(new Set([...targetIds, ...demoIds]));
  }

  // Safety Gate: In live execution mode (--execute), targets must be explicitly provided
  if (!dryRun && targetIds.length === 0) {
    console.error('ERROR: Explicit target identifiers or --all-demo must be provided when executing with --execute.');
    console.error('Refusing to retire default synthetic candidate list live.');
    await db.close();
    process.exit(1);
  }

  if (targetIds.length === 0) {
    console.log('No identifiers specified. Assessing standard synthetic / candidate identities...');
    targetIds = ['ADM001', 'ADM002', 'ADM003', 'WRD001', 'PRC001', 'CW001', 'SUPERADMIN'];
  }

  console.log(`\n======================================================`);
  console.log(`  DORMEX IDENTITY RETIREMENT ENGINE (STAGE 6)`);
  console.log(`  Mode: ${dryRun ? '🔍 DRY RUN (NO WRITES)' : '⚡ LIVE EXECUTION'}`);
  console.log(`  Target Count: ${targetIds.length}`);
  console.log(`======================================================\n`);

  const summary = await service.retireBatch(targetIds, 'usr_admin', { dryRun });

  console.table(
    summary.results.map((r) => ({
      'User ID': r.userId,
      'College ID': r.collegeId,
      'Action': r.actionTaken,
      'Success': r.success ? 'YES' : 'NO',
      'Details': r.reasons[0]?.slice(0, 80) || '',
    }))
  );

  console.log(`\nSummary:`);
  console.log(`  Total Evaluated: ${summary.totalEvaluated}`);
  console.log(`  Eligible:        ${summary.eligibleCount}`);
  console.log(`  Blocked:         ${summary.blockedCount}`);
  console.log(`  Already Retired: ${summary.alreadyRetiredCount}`);
  console.log(`  Retired (Live):  ${summary.retiredCount}`);

  if (dryRun) {
    console.log(`\n💡 To execute retirement live on eligible identities, re-run with --execute.`);
  }

  await db.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error during identity retirement:', err);
  process.exit(1);
});
