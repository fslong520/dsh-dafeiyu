/**
 * Optional read-only smoke test against the real rsrs binary.
 *
 * Run with:
 *   DAFEIYU_INTEGRATION=1 node test/integration.mjs
 *
 * Read-only by construction: it only runs `recall` and `learn status`. It never
 * marks feedback, never stores a memory and never trains.
 */
import assert from 'node:assert/strict';
import { createRsrs, recallArgs, statusArgs } from '../lib/rsrs.js';
import { resolveConfig } from '../lib/config.js';

if (process.env.DAFEIYU_INTEGRATION !== '1') {
	console.log('integration: skipped (set DAFEIYU_INTEGRATION=1 to run)');
	process.exit(0);
}

const config = resolveConfig({}, { env: process.env });
const rsrs = createRsrs({ config });

console.log(`integration: binary=${rsrs.bin} source=${rsrs.source}`);

function report(label, value) {
	console.log(`integration: ${label} -> ${value}`);
}

function assertEnvelope(envelope, expectedCommand) {
	assert.equal(typeof envelope, 'object');
	assert.equal(envelope.command, expectedCommand);
	assert.equal(typeof envelope.summary, 'object');
	assert.ok(Array.isArray(envelope.items));
	assert.ok(Array.isArray(envelope.errors));
}

const failures = [];

// 1. Plain recall: the always-available path.
try {
	const { envelope } = await rsrs.run(recallArgs('dsh plugin memory', { titles: true, limit: 3 }), { timeoutMs: 15000 });
	assertEnvelope(envelope, 'recall');
	const ids = (envelope.items ?? []).map((item) => item.name ?? item.id).filter(Boolean);
	report('recall', `ok items=${ids.length} query_log_id=${envelope.summary?.query_log_id ?? 'absent'}`);
	assert.ok(ids.every((id) => /^[0-9a-f]{8,64}$/i.test(String(id))), 'every id must be 8-64 hex chars');
} catch (error) {
	failures.push(`recall failed: ${error.message}`);
	report('recall', `FAILED ${error.message}`);
}

// 2. `learn status`: only exists on the self-learning build.
const probe = await rsrs.probeLearn();
if (probe.learnAvailable) {
	try {
		const { envelope } = await rsrs.run(['learn', 'status', '--json'], { timeoutMs: 15000 });
		assertEnvelope(envelope, 'learn');
		report('learn status', 'ok');
	} catch (error) {
		failures.push(`learn status failed: ${error.message}`);
		report('learn status', `FAILED ${error.message}`);
	}
} else {
	report('learn status', 'skipped (self-learning build not installed)');
}

// 3. Lexical recall: only valid when the self-learning build is present.
if (probe.learnAvailable) {
	try {
		const { envelope } = await rsrs.run(
			recallArgs('dsh plugin memory', { titles: true, limit: 3, lexical: true }),
			{ timeoutMs: 15000 },
		);
		assertEnvelope(envelope, 'recall');
		report('lexical recall', `ok items=${(envelope.items ?? []).length}`);
	} catch (error) {
		failures.push(`lexical recall failed: ${error.message}`);
		report('lexical recall', `FAILED ${error.message}`);
	}
} else {
	report('lexical recall', 'skipped (--lexical rejected by this build)');
}

// 4. `status --json` is always available and proves the binary is reachable.
try {
	const { envelope } = await rsrs.run(statusArgs(), { timeoutMs: 15000 });
	assert.equal(envelope.command, 'status');
	report('status', `ok data_dir=${envelope.summary?.data_dir ?? 'unknown'}`);
} catch (error) {
	failures.push(`status failed: ${error.message}`);
	report('status', `FAILED ${error.message}`);
}

if (failures.length > 0) {
	console.error(`integration: ${failures.length} failure(s)`);
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}
console.log('integration: all read-only checks passed');
