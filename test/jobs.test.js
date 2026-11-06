/** Scheduler: timing math, daily training, weekly encoder wiring, start/stop. */
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { resolveConfig } from '../lib/config.js';
import {
	CATCHUP_MS,
	DAILY_INTERVAL_MS,
	MAINTENANCE_INTERVAL_MS,
	createJobs,
	msUntilNext,
	msUntilNextWeekly,
	summarizeAudit,
	summarizeLearn,
	summarizeReview,
} from '../lib/jobs.js';
import { ENCODER_SCRIPT_REL } from '../lib/granite.js';
import { createState } from '../lib/state.js';
import { createFakeRsrs } from './fake-rsrs.js';

const dirs = [];
function tempDir() {
	const dir = mkdtempSync(path.join(tmpdir(), 'dafeiyu-jobs-'));
	dirs.push(dir);
	return dir;
}
after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const T0 = 1_700_000_000_000;

test('msUntilNext targets the next local hour:minute', () => {
	const now = new Date(2026, 0, 5, 12, 0, 0, 0).getTime();
	const delay = msUntilNext(3, 30, now);
	assert.equal(delay, 15.5 * 3600 * 1000);

	const sameDay = new Date(2026, 0, 5, 1, 0, 0, 0).getTime();
	assert.equal(msUntilNext(3, 30, sameDay), 2.5 * 3600 * 1000);
});

test('msUntilNextWeekly targets Sunday 02:00', () => {
	// Monday 2026-01-05 10:00 -> next Sunday 2026-01-11 02:00
	const monday = new Date(2026, 0, 5, 10, 0, 0, 0).getTime();
	const delay = msUntilNextWeekly(monday);
	const target = new Date(monday + delay);
	assert.equal(target.getDay(), 0);
	assert.equal(target.getHours(), 2);
	assert.equal(target.getMinutes(), 0);
	assert.ok(delay > 0);
});

test('summarizeLearn keeps counts and drops long text', () => {
	assert.deepEqual(
		summarizeLearn({ summary: { trained: 5, ok: true, note: 'x'.repeat(200) } }),
		{ trained: 5, ok: true },
	);
	assert.deepEqual(summarizeLearn({}), {});
	assert.deepEqual(summarizeLearn(undefined), {});
});

function setup({ learnAvailable = true, jobs = {}, config: extra = {} } = {}) {
	const stateDir = tempDir();
	const state = createState({ stateDir, now: () => T0 });
	const config = resolveConfig({ stateDir, jobs, ...extra }, { env: { HOME: '/home/tester' } });
	const rsrs = createFakeRsrs({ learnAvailable });
	return { state, config, rsrs, stateDir };
}

test('the daily job skips when the self-learning build is absent', async () => {
	const { state, config, rsrs } = setup({ learnAvailable: false });
	const jobs = createJobs({ config, rsrs, state, now: () => T0 });
	const result = await jobs.runDailyLearn();
	assert.deepEqual(result, { ran: false, reason: 'learn-unavailable' });
	assert.equal(rsrs.calls.length, 0);
});

test('the daily job trains and records counts only', async () => {
	const { state, config, rsrs } = setup();
	const jobs = createJobs({ config, rsrs, state, now: () => T0 });
	const result = await jobs.runDailyLearn();
	assert.equal(result.ran, true);
	assert.equal(result.status, 'ok');
	assert.deepEqual(result.counts, { trained: 3 });
	assert.deepEqual(rsrs.argsFor('learn')[0], ['learn', 'train', '--from-labels', '--json', '--limit', '5000', '--epochs', '1']);

	const record = state.readJobs().daily;
	assert.equal(record.status, 'ok');
	assert.deepEqual(record.counts, { trained: 3 });
	// No memory text is ever written to the job record.
	assert.equal(JSON.stringify(record).includes('trained'), true);
});

test('the daily job is not due twice inside 24h unless forced', async () => {
	const { state, config, rsrs } = setup();
	let stamp = T0;
	const jobs = createJobs({ config, rsrs, state, now: () => stamp });
	await jobs.runDailyLearn();
	assert.equal(rsrs.argsFor('learn').length, 1);

	stamp += 1000;
	const again = await jobs.runDailyLearn();
	assert.deepEqual(again, { ran: false, reason: 'not-due' });
	assert.equal(rsrs.argsFor('learn').length, 1);

	stamp += DAILY_INTERVAL_MS;
	const later = await jobs.runDailyLearn();
	assert.equal(later.ran, true);
	assert.equal(rsrs.argsFor('learn').length, 2);
});

test('the daily job records a failure without throwing', async () => {
	const { state, config } = setup();
	const rsrs = createFakeRsrs({ learnAvailable: true, failOn: ['learn'] });
	const jobs = createJobs({ config, rsrs, state, now: () => T0, logger: { warn() {} } });
	const result = await jobs.runDailyLearn();
	assert.equal(result.ran, false);
	assert.equal(result.status, 'error');
	assert.match(result.error, /fake failure/);
	assert.equal(state.readJobs().daily.status, 'error');
});

test('the weekly encoder is skipped when Granite is not installed', async () => {
	const { state, config, rsrs } = setup();
	const jobs = createJobs({ config, rsrs, state, now: () => T0 });
	const result = await jobs.runWeeklyEncoder();
	assert.equal(result.ran, false);
	assert.match(result.reason, /granite model incomplete/);
});

test('the weekly encoder runs the respire script with the documented env', async () => {
	const repo = tempDir();
	const model = tempDir();
	const anchor = tempDir();
	mkdirSync(path.join(model, '1_Pooling'), { recursive: true });
	writeFileSync(path.join(model, 'model.safetensors'), 'x');
	writeFileSync(path.join(model, 'config.json'), '{}');

	const script = path.join(repo, ENCODER_SCRIPT_REL);
	mkdirSync(path.dirname(script), { recursive: true });
	const capture = path.join(repo, 'env.txt');
	writeFileSync(script, `#!/usr/bin/env bash\nprintf '%s\\n' "$RSRS_ENCODER_STATE|$RSRS_ENCODER_BASE|$RSRS_DATA_DIR" > ${capture}\nexit 0\n`);
	chmodSync(script, 0o755);

	const stateDir = tempDir();
	const state = createState({ stateDir, now: () => T0 });
	const config = resolveConfig(
		{
			stateDir,
			dataDir: '/tmp/rsrs-data',
			jobs: { graniteModelDir: model, respireRepo: repo, anchorDir: anchor },
		},
		{ env: { HOME: '/home/tester' } },
	);
	const rsrs = createFakeRsrs({ learnAvailable: true });
	const jobs = createJobs({ config, rsrs, state, now: () => T0 });

	const result = await jobs.runWeeklyEncoder();
	assert.equal(result.ran, true);
	assert.equal(result.status, 'ok');
	assert.equal(result.exitCode, 0);

	assert.equal(existsSync(capture), true);
	assert.equal(readFileSync(capture, 'utf8').trim(), `${anchor}|${model}|/tmp/rsrs-data`);

	const log = readFileSync(state.files.encoderLog, 'utf8');
	assert.match(log, /start/);
	assert.match(log, /exit 0/);
	assert.equal(state.readJobs().weekly.status, 'ok');
});

test('start/stop manage unref\'d timers and catch up on a stale last run', () => {
	const { state, config, rsrs } = setup({ jobs: { enabled: true } });
	const scheduled = [];
	const timers = {
		setTimeout: (fn, ms) => {
			const handle = { fn, ms, unref() { this.unrefCalled = true; }, cleared: false };
			scheduled.push(handle);
			return handle;
		},
		clearTimeout: (handle) => {
			handle.cleared = true;
		},
	};
	const jobs = createJobs({ config, rsrs, state, now: () => T0, timers });

	assert.equal(jobs.start(), true);
	assert.equal(jobs.start(), false);
	// daily + weekly + nightly maintenance (maintenance enabled by default).
	assert.equal(scheduled.length, 3);
	// No prior run: the daily timer catches up within a minute.
	assert.equal(scheduled[0].ms, CATCHUP_MS);
	assert.equal(scheduled[0].unrefCalled, true);
	// The maintenance timer targets 04:00 local, not the catch-up window.
	assert.equal(scheduled[2].ms, msUntilNext(4, 0, T0));
	assert.equal(scheduled[2].unrefCalled, true);

	assert.doesNotThrow(() => jobs.stop());
	assert.equal(scheduled.every((handle) => handle.cleared), true);
	assert.equal(jobs.started, false);
});

test('jobs are not scheduled when disabled', () => {
	const { state, config, rsrs } = setup({ jobs: { enabled: false } });
	const scheduled = [];
	const timers = { setTimeout: (fn, ms) => { scheduled.push(ms); return { unref() {} }; }, clearTimeout: () => {} };
	const jobs = createJobs({ config, rsrs, state, now: () => T0, timers });
	assert.equal(jobs.start(), false);
	assert.deepEqual(scheduled, []);
});

/* ---------------- nightly read-only maintenance ---------------- */

test('summarizeAudit keeps whitelisted counters and drops details', () => {
	const counts = summarizeAudit({
		status: 'ok',
		summary: { status: 'ok', total_active: 12, orphans: 1, hot_untyped: [{ id: 'deadbeef', title: 'Secret title' }] },
		details: [{ id: 'deadbeef', title: 'Secret title' }],
	});
	assert.deepEqual(counts, { status: 'ok', total_active: 12, orphans: 1 });
	// Non-whitelisted keys never survive, no matter where they sit.
	assert.equal('hot_untyped' in counts, false);
	assert.equal('details' in counts, false);
	// A failed audit envelope still yields its verdict.
	assert.equal(summarizeAudit({ status: 'fail', errors: [{ message: 'x' }] }).status, 'fail');
	assert.deepEqual(summarizeAudit(undefined), {});
});

test('summarizeReview counts items and never copies titles', () => {
	const counts = summarizeReview({
		status: 'ok',
		summary: { status: 'ok', due: 2, title: 'Must not leak', content: 'Must not leak either' },
		items: [{ id: 'a' }, { id: 'b' }],
		details: [{ id: 'a' }],
	});
	assert.equal(counts.status, 'ok');
	assert.equal(counts.items, 2);
	assert.equal(counts.due, 2);
	assert.equal('title' in counts, false);
	assert.equal('content' in counts, false);
	// Envelope-level status is picked up when the summary lacks one.
	assert.equal(summarizeReview({ status: 'warn', items: [] }).status, 'warn');
});

test('maintenance runs audit and review, records counts only', async () => {
	const { state, config, rsrs } = setup();
	const jobs = createJobs({ config, rsrs, state, now: () => T0, logger: { warn() {} } });
	const result = await jobs.runMaintenance();
	assert.equal(result.ran, true);
	assert.equal(result.status, 'ok');
	assert.equal(result.audit.status, 'ok');
	assert.equal(result.review.status, 'ok');
	assert.deepEqual(rsrs.argsFor('audit')[0], ['audit', '--json']);
	assert.deepEqual(rsrs.argsFor('review')[0], ['review', '--due', '--json', '--limit', '20']);

	const record = state.readJobs().maintenance;
	assert.equal(record.status, 'ok');
	assert.equal(record.audit.counts.total_active, 12);
	assert.equal(record.review.counts.items, 2);
	// No ids or titles from the review items reach the record.
	assert.equal(JSON.stringify(record).includes('aaaa1111'), false);
	assert.equal(MAINTENANCE_INTERVAL_MS, 24 * 60 * 60 * 1000);
});

test('maintenance is not due twice inside 24h unless forced', async () => {
	const { state, config, rsrs } = setup();
	let stamp = T0;
	const jobs = createJobs({ config, rsrs, state, now: () => stamp, logger: { warn() {} } });
	await jobs.runMaintenance();
	assert.equal(rsrs.argsFor('audit').length, 1);

	stamp += 1000;
	const again = await jobs.runMaintenance();
	assert.deepEqual(again, { ran: false, reason: 'not-due' });
	assert.equal(rsrs.argsFor('audit').length, 1);

	stamp += MAINTENANCE_INTERVAL_MS;
	const later = await jobs.runMaintenance();
	assert.equal(later.ran, true);
	assert.equal(rsrs.argsFor('audit').length, 2);
});

test('maintenance respects its own switch and never throws on CLI failures', async () => {
	const off = setup({ jobs: { maintenanceEnabled: false } });
	const offJobs = createJobs({ config: off.config, rsrs: off.rsrs, state: off.state, now: () => T0 });
	assert.deepEqual(await offJobs.runMaintenance(), { ran: false, reason: 'disabled' });
	assert.equal(off.rsrs.calls.length, 0);

	// A broken audit records an error but still runs the review.
	const broken = setup();
	const rsrs = createFakeRsrs({ learnAvailable: true, failOn: ['audit'] });
	const jobs = createJobs({ config: broken.config, rsrs, state: broken.state, now: () => T0, logger: { warn() {} } });
	const result = await jobs.runMaintenance();
	assert.equal(result.ran, true);
	assert.equal(result.status, 'error');
	assert.equal(result.audit.status, 'error');
	assert.equal(result.review.status, 'ok');
	assert.equal(rsrs.argsFor('review').length, 1);
	assert.equal(broken.state.readJobs().maintenance.status, 'error');
});
