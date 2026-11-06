/** CLI adapter: argument builders, discovery, envelope parsing, exit and timeout. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
	RsrsError,
	assertId,
	attachArgs,
	auditArgs,
	chainArgs,
	createRsrs,
	discoverBinary,
	findOnPath,
	isExecutable,
	isValidId,
	learnLexicalArgs,
	learnResetArgs,
	learnStatusArgs,
	learnTrainArgs,
	parseEnvelope,
	queryLogArgs,
	queryLogMarkArgs,
	recallArgs,
	rememberArgs,
	reviewDueArgs,
	runProcess,
	showArgs,
	statusArgs,
	truncate,
	updateArgs,
} from '../lib/rsrs.js';

const dirs = [];
function tempDir() {
	const dir = mkdtempSync(path.join(tmpdir(), 'dafeiyu-rsrs-'));
	dirs.push(dir);
	return dir;
}
after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

test('recall args keep the documented order and flags', () => {
	assert.deepEqual(recallArgs('q'), ['recall', 'q', '--json']);
	assert.deepEqual(
		recallArgs('q', { titles: true, brief: true, limit: 5, project: 'p', intent: 'fact', type: 'hypothesis', lexical: true }),
		['recall', 'q', '--json', '--titles', '--brief', '--limit', '5', '--project', 'p', '--intent', 'fact', '--type', 'hypothesis', '--lexical'],
	);
});

test('remember args serialize source refs as JSON and validate ids', () => {
	const args = rememberArgs('body', {
		title: 'T',
		importance: 'important',
		type: 'fact',
		parent: 'abcdef12',
		tags: 'a,b',
		project: 'p',
		sourceRefs: [{ kind: 'file', ref: 'x.js' }],
		validUntil: '2026-01-01T00:00:00Z',
		reviewAt: '2026-01-02T00:00:00Z',
		supersedes: 'deadbeef',
		seeAlso: ['11112222', '33334444'],
		force: true,
	});
	assert.equal(args[0], 'remember');
	assert.equal(args[1], 'body');
	assert.equal(args[2], '--json');
	assert.ok(args.includes('--title') && args.includes('T'));
	assert.ok(args.includes('--importance') && args.includes('important'));
	assert.ok(args.includes('--parent') && args.includes('abcdef12'));
	assert.ok(args.includes('--source-refs'));
	assert.equal(args[args.indexOf('--source-refs') + 1], '[{"kind":"file","ref":"x.js"}]');
	assert.ok(args.includes('--see-also'));
	assert.equal(args[args.indexOf('--see-also') + 1], '11112222,33334444');
	assert.ok(args.includes('--force'));

	assert.throws(() => rememberArgs('body', { parent: 'not-an-id' }), /invalid parent/);
});

test('simple command builders', () => {
	assert.deepEqual(statusArgs(), ['status', '--json']);
	assert.deepEqual(learnStatusArgs(), ['learn', 'status', '--json']);
	assert.deepEqual(learnTrainArgs({ limit: 10, epochs: 2 }), ['learn', 'train', '--from-labels', '--json', '--limit', '10', '--epochs', '2']);
	assert.deepEqual(learnResetArgs(), ['learn', 'reset', '--json']);
	assert.deepEqual(learnLexicalArgs(true), ['learn', 'lexical', '--json']);
	assert.deepEqual(learnLexicalArgs(false), ['learn', 'lexical', '--off', '--json']);
	assert.deepEqual(showArgs('abcdef12'), ['show', 'abcdef12', '--json']);
	assert.deepEqual(chainArgs('abcdef12', 2), ['chain', 'abcdef12', '--depth', '2', '--json']);
	assert.deepEqual(queryLogArgs(3), ['query-log', '--limit', '3', '--json']);
	assert.deepEqual(
		queryLogMarkArgs(['abcdef12'], 'good', { queryLogId: 'uuid', source: 'model' }),
		['query-log', '--json', 'mark', 'abcdef12', '--good', '--query-log-id', 'uuid', '--source', 'model'],
	);
	assert.deepEqual(queryLogMarkArgs(['abcdef12'], 'bad'), ['query-log', '--json', 'mark', 'abcdef12', '--bad']);
	assert.throws(() => queryLogMarkArgs([], 'good'), /at least one id/);
});

test('ids are validated as 8-64 hex characters', () => {
	assert.equal(isValidId('056f02cc'), true);
	assert.equal(isValidId('056f02cc-488c-46ab-8b5c-da68ec124875'), true);
	assert.equal(isValidId('056f02cc488c46ab8b5cda68ec124875'), true);
	assert.equal(isValidId('abc'), false);
	assert.equal(isValidId('zzzzzzzz'), false);
	assert.equal(isValidId('$(rm -rf /)'), false);
	assert.equal(isValidId(undefined), false);
	assert.equal(assertId(' 056f02cc '), '056f02cc');
	assert.throws(() => assertId('nope'), /invalid id/);
});

test('binary discovery follows the documented order', () => {
	const home = '/home/tester';
	const all = () => true;
	assert.deepEqual(discoverBinary({ config: { rsrsBin: '/custom/rsrs' }, env: {}, home, check: all }), { bin: '/custom/rsrs', source: 'config' });
	assert.deepEqual(
		discoverBinary({ config: {}, env: { RSRS_BIN: '/env/rsrs' }, home, check: all }),
		{ bin: '/env/rsrs', source: 'env' },
	);
	const managedOnly = (file) => file === path.join(home, '.local', 'bin', 'rsrs-dafeiyu');
	assert.deepEqual(discoverBinary({ config: {}, env: {}, home, check: managedOnly }), {
		bin: path.join(home, '.local', 'bin', 'rsrs-dafeiyu'),
		source: 'managed',
	});
	const homeOnly = (file) => file === path.join(home, '.rsrs', 'bin', 'rsrs');
	assert.deepEqual(discoverBinary({ config: {}, env: {}, home, check: homeOnly }), {
		bin: path.join(home, '.rsrs', 'bin', 'rsrs'),
		source: 'home',
	});
	const none = () => false;
	assert.deepEqual(discoverBinary({ config: {}, env: {}, home, check: none }), { bin: 'rsrs', source: 'unresolved' });
});

test('findOnPath locates an executable on PATH', () => {
	const dir = tempDir();
	const bin = path.join(dir, 'rsrs');
	writeFileSync(bin, '#!/bin/sh\nexit 0\n');
	chmodSync(bin, 0o755);
	assert.equal(isExecutable(bin), true);
	assert.equal(findOnPath('rsrs', { PATH: dir }), bin);
	assert.equal(findOnPath('missing', { PATH: dir }), undefined);
});

test('parseEnvelope rejects empty, invalid and non-object output', () => {
	assert.deepEqual(parseEnvelope('{"command":"status","status":"ok"}'), { command: 'status', status: 'ok' });
	assert.throws(() => parseEnvelope(''), (error) => error instanceof RsrsError && error.code === 'EMPTY_OUTPUT');
	assert.throws(() => parseEnvelope('not json'), (error) => error instanceof RsrsError && error.code === 'INVALID_JSON');
	assert.throws(() => parseEnvelope('[]'), (error) => error instanceof RsrsError && error.code === 'INVALID_ENVELOPE');
});

test('truncate bounds captured stderr', () => {
	assert.equal(truncate('abc', 10), 'abc');
	assert.equal(truncate('x'.repeat(50), 10).length, 11);
	assert.equal(truncate(undefined), '');
});

test('runProcess captures a nonzero exit without throwing', async () => {
	const result = await runProcess({ bin: process.execPath, args: ['-e', 'process.exit(4)'], timeoutMs: 5000 });
	assert.equal(result.code, 4);
	assert.equal(result.timedOut, false);
});

test('runProcess kills the child on timeout', async () => {
	await assert.rejects(
		runProcess({ bin: process.execPath, args: ['-e', 'setTimeout(() => {}, 5000)'], timeoutMs: 150 }),
		(error) => error instanceof RsrsError && error.code === 'TIMEOUT',
	);
});

test('createRsrs.run parses envelopes and throws on failure', async () => {
	const config = { rsrsBin: process.execPath, dataDir: '/tmp/rsrs-data', rpcPort: 15270 };
	const rsrs = createRsrs({ config, env: { PATH: process.env.PATH } });
	assert.equal(rsrs.bin, process.execPath);

	const ok = await rsrs.run(['-e', 'console.log(JSON.stringify({command:"status",status:"ok",summary:{}}))']);
	assert.equal(ok.envelope.status, 'ok');
	assert.equal(rsrs.env.RSRS_DATA_DIR, '/tmp/rsrs-data');
	assert.equal(rsrs.env.RSRS_RPC_PORT, '15270');

	await assert.rejects(
		rsrs.run(['-e', 'process.stderr.write("boom");process.exit(2)']),
		(error) => error instanceof RsrsError && error.code === 'RSRS_FAILED' && /boom/.test(error.message),
	);

	// An envelope with status != ok is a failure even with exit code 0.
	await assert.rejects(
		rsrs.run(['-e', 'console.log(JSON.stringify({command:"recall",status:"fail",errors:["bad input"]}))']),
		(error) => error instanceof RsrsError && /bad input/.test(error.message),
	);

	// allowFailure returns the envelope instead of throwing.
	const soft = await rsrs.run(['-e', 'console.log(JSON.stringify({command:"status",status:"fail"}))'], { allowFailure: true });
	assert.equal(soft.envelope.status, 'fail');
});

test('probeLearn marks the build unsupported when learn --help fails', async () => {
	const config = { rsrsBin: process.execPath, dataDir: '' };
	const rsrs = createRsrs({ config, env: {} });
	const probe = await rsrs.probeLearn();
	assert.equal(probe.learnAvailable, false);
	assert.equal(rsrs.learnAvailable, false);
	assert.ok(probe.reason !== undefined);

	// The cached result is reused.
	const again = await rsrs.probeLearn();
	assert.equal(again.learnAvailable, false);
});

test('detection is cached and can be invalidated', () => {
	let stamp = 0;
	const config = { rsrsBin: '/fake/rsrs' };
	const rsrs = createRsrs({ config, env: {}, now: () => stamp, home: '/home/tester' });
	assert.equal(rsrs.bin, '/fake/rsrs');
	stamp += 1000;
	rsrs.invalidate();
	assert.equal(rsrs.bin, '/fake/rsrs');
});

/* ---------------- memory.mode env wiring ---------------- */

test('main mode sets neither RSRS_DATA_DIR nor RSRS_RPC_PORT', () => {
	const config = { rsrsBin: '/fake/rsrs', dataDir: '', rpcPort: 0 };
	const rsrs = createRsrs({ config, env: { PATH: '/usr/bin' } });
	// The plugin itself injects nothing, so the CLI falls back to ~/.rsrs.
	assert.equal('RSRS_DATA_DIR' in rsrs.env, false);
	assert.equal('RSRS_RPC_PORT' in rsrs.env, false);
});

test('isolated mode sets dataDir and port together', () => {
	const config = { rsrsBin: '/fake/rsrs', dataDir: '/home/fslong/.rsrs/accounts/dafeiyu', rpcPort: 15270 };
	const rsrs = createRsrs({ config, env: { PATH: '/usr/bin' } });
	assert.equal(rsrs.env.RSRS_DATA_DIR, '/home/fslong/.rsrs/accounts/dafeiyu');
	assert.equal(rsrs.env.RSRS_RPC_PORT, '15270');
});

test('createRsrs refuses a dataDir without a port (silent-main-store tripwire)', () => {
	assert.throws(
		() => createRsrs({ config: { rsrsBin: '/fake/rsrs', dataDir: '/srv/rsrs', rpcPort: 0 }, env: {} }),
		(error) => error instanceof RsrsError && error.code === 'MEMORY_CONFIG_INVALID' && /silently write the main store/.test(error.message),
	);
});

/* ---------------- attach / update / maintenance builders ---------------- */

test('attachArgs validates both ids and keeps the documented order', () => {
	assert.deepEqual(attachArgs('aaaa1111', 'bbbb2222'), ['attach', 'aaaa1111', '--parent', 'bbbb2222', '--json']);
	assert.throws(() => attachArgs('nope', 'bbbb2222'), /invalid id/);
	assert.throws(() => attachArgs('aaaa1111', 'nope'), /invalid parent/);
});

test('updateArgs passes only the provided fields and rejects supersedes', () => {
	assert.deepEqual(
		updateArgs('aaaa1111', { title: 'New title', sourceRefs: [{ id: 'x' }] }),
		['update', 'aaaa1111', '--json', '--title', 'New title', '--source-refs', '[{"id":"x"}]'],
	);
	assert.deepEqual(
		updateArgs('aaaa1111', { content: 'body', type: 'fact', validUntil: '2027-01-01T00:00:00.000Z', reviewAt: '2026-12-01T00:00:00.000Z' }),
		['update', 'aaaa1111', '--json', '--content', 'body', '--kind', 'fact',
			'--valid-until', '2027-01-01T00:00:00.000Z', '--review-at', '2026-12-01T00:00:00.000Z'],
	);
	// Nothing provided -> no field flags (the tool layer rejects that first).
	assert.deepEqual(updateArgs('aaaa1111', {}), ['update', 'aaaa1111', '--json']);
	// The CLI has no --supersedes on update: loud, not silent.
	assert.throws(() => updateArgs('aaaa1111', { supersedes: 'bbbb2222' }), /does not support supersedes/);
	assert.throws(() => updateArgs('bad-id', { title: 'x' }), /invalid id/);
});

test('maintenance builders are read-only commands with clamped limits', () => {
	assert.deepEqual(auditArgs(), ['audit', '--json']);
	assert.deepEqual(reviewDueArgs(), ['review', '--due', '--json', '--limit', '20']);
	assert.deepEqual(reviewDueArgs(0), ['review', '--due', '--json', '--limit', '1']);
	assert.deepEqual(reviewDueArgs(999), ['review', '--due', '--json', '--limit', '100']);
	assert.deepEqual(reviewDueArgs('junk'), ['review', '--due', '--json', '--limit', '20']);
	// No write verb appears anywhere in either command.
	for (const args of [auditArgs(), reviewDueArgs(50)]) {
		const joined = args.join(' ');
		assert.equal(/remember|update|attach|forget|delete/.test(joined), false, joined);
	}
});
