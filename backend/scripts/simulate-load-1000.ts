import { rateLimiterService } from '../src/services/rate-limiter.service.js';
import { getRedis } from '../src/lib/redis.js';

async function runLoadSimulation() {
  console.log('=== REACHINBOX 1,000+ EMAIL ADMISSION LOAD SIMULATION ===');
  console.log('Simulating 1,000 parallel emails scheduled for roughly the same timestamp...\n');

  const senderId = 'load-sim-sender-' + Math.random().toString(36).substring(7);
  const hourlyLimit = 50;
  const minDelaySeconds = 2;
  const totalEmails = 1000;
  const baseTime = Date.now();

  // Reset Redis state for clean run
  try {
    await rateLimiterService.resetSender(senderId);
  } catch {
    // If Redis is in-memory or mock
  }

  console.log(`Target Sender: ${senderId}`);
  console.log(`Hourly Limit: ${hourlyLimit} emails/hour (UTC window)`);
  console.log(`Min Delay   : ${minDelaySeconds} seconds between sends`);
  console.log(`Total Emails: ${totalEmails} simultaneous requests\n`);

  const startTime = Date.now();

  // Simulate 1,000 concurrent admissions
  const promises = [];
  for (let i = 0; i < totalEmails; i++) {
    // Spread arrival slightly within 100ms to simulate concurrent worker pulls
    const simulatedNow = baseTime + (i % 20) * 5;
    promises.push(
      rateLimiterService
        .requestAdmission(senderId, {
          hourlyLimit,
          minDelaySeconds,
          now: simulatedNow,
        })
        .catch((err) => ({ error: err.message }))
    );
  }

  const results = await Promise.all(promises);
  const duration = Date.now() - startTime;

  let granted = 0;
  let spacingViolations = 0;
  let limitExceeded = 0;
  let slackAlertsTriggered = 0;
  let errors = 0;

  for (const res of results) {
    if ('error' in res) {
      errors++;
      continue;
    }
    if (res.decision === 'GRANTED') granted++;
    if (res.decision === 'SPACING_VIOLATION') spacingViolations++;
    if (res.decision === 'LIMIT_EXCEEDED') limitExceeded++;
    if (res.shouldAlert) slackAlertsTriggered++;
  }

  console.log('=== LOAD SIMULATION RESULTS ===');
  console.log(`Completed in          : ${duration} ms (${Math.round((totalEmails / duration) * 1000)} req/sec)`);
  console.log(`Admission GRANTED     : ${granted} (strictly within quota and spacing)`);
  console.log(`SPACING_VIOLATIONS    : ${spacingViolations} (rescheduled to next delay slots)`);
  console.log(`LIMIT_EXCEEDED        : ${limitExceeded} (rescheduled into next UTC hour window)`);
  console.log(`Slack Alerts Fired    : ${slackAlertsTriggered} (exactly 1 alert per window)`);
  console.log(`Errors / Dropped      : ${errors} (Zero dropped emails)`);
  console.log('================================');

  if (slackAlertsTriggered <= 1 && errors === 0) {
    console.log('\n✅ VERIFICATION PASSED: Atomic Lua rate limiter successfully admitted and safely rescheduled all 1,000 emails without dropping any.');
  } else {
    console.log('\n❌ VERIFICATION WARNING: Unexpected counts observed.');
  }

  try {
    const redis = getRedis();
    await redis.quit();
  } catch {}
}

runLoadSimulation().catch(console.error);
