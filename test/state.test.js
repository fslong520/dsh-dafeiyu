/** State dir modes, atomic JSON, pending ring, mutes and locks. */
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
	DIR_MODE,
	FILE_MODE,
	PENDING_TTL_MS,
	acquireLock,
	appendLog,
	ensureDir,
	readJson,
	writeJsonAtomic,
	createState,
} from '../lib/state.js';

const dirs = [];
function tempDir() {
	const dir = mkdtempSync(path.join(tmpdir(), 'dafeiyu-state-'));
	dirs.push(dir);
	return dir;
}
after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

test('the state dir is 0700 and files are 0600', () => {
	const root = tempDir();
	const stateDir = path.join(root, 'dafeiyu');
	ensureDir(stateDir);
	assert.equal(statSync(stateDir).mode & 0o777, DIR_MODE);
	assert.equal(DIR_MODE, 0o700);

	const file = path.join(stateDir, 'x.json');
	writeJsonAtomic(file, { a: 1 });
	assert.equal(statSync(file).mode & 0o777, FILE_MODE);
	assert.equal(FILE_MODE, 0o600);
});

test('atomic write replaces content and leaves no temp files', () => {
	const root = tempDir();
	const file = path.join(root, 'data.json');
	writeJsonAtomic(file, { version: 1 });
	assert.deepEqual(readJson(file), { version: 1 });
	writeJsonAtomic(file, { version: 2 });
	assert.deepEqual(readJson(file), { version: 2 });
	const leftovers = readdirSync(root).filter((name) => name.includes('.tmp'));
	assert.deepEqual(leftovers, []);
	assert.ok(readFileSync(file, 'utf8').includes('"version": 2'));
});

test('readJson falls back for missing and corrupt files', () => {
	const root = tempDir();
	assert.deepEqual(readJson(path.join(root, 'missing.json'), { fallback: true }), { fallback: true });
	const corrupt = path.join(root, 'corrupt.json');
	writeFileSync(corrupt, '{not json');
	assert.deepEqual(readJson(corrupt, { fallback: true }), { fallback: true });
	writeFileSync(corrupt, '');
	assert.deepEqual(readJson(corrupt, { fallback: true }), { fallback: true });
});

test('pending recall snapshots are found by request id, query hash and id overlap', () => {
	let stamp = 1000;
	const state = createState({ stateDir: tempDir(), now: () => stamp });
	state.recordPending({ requestId: 'req-1', ids: ['056f02cc', 'af347325'], queryHash: 'hash-a' });
	stamp += 10;
	state.recordPending({ requestId: 'req-2', ids: ['deadbeef'], queryHash: 'hash-b' });

	assert.equal(state.findPending({ requestId: 'req-1' }).queryHash, 'hash-a');
	assert.equal(state.findPending({ queryHash: 'hash-b' }).requestId, 'req-2');
	// The newest matching snapshot wins.
	assert.equal(state.findPending({ ids: ['af347325'] }).requestId, 'req-1');
	assert.equal(state.findPending({ ids: ['99999999'] }), undefined);
	assert.equal(state.findPending({}), undefined);
});

test('pending snapshots expire after ten minutes and stay bounded', () => {
	let stamp = 1000;
	const state = createState({ stateDir: tempDir(), now: () => stamp });
	state.recordPending({ requestId: 'old', ids: ['056f02cc'], queryHash: 'h' });
	stamp += PENDING_TTL_MS + 1;
	state.recordPending({ requestId: 'new', ids: ['af347325'], queryHash: 'h2' });
	const items = state.readPending();
	assert.equal(items.length, 1);
	assert.equal(items[0].requestId, 'new');

	for (let index = 0; index < 60; index += 1) {
		state.recordPending({ requestId: `r${index}`, ids: ['056f02cc'], queryHash: `q${index}` });
	}
	assert.ok(state.readPending().length <= 50);
});

test('mute records are stored, listed and removed', () => {
	let stamp = 1000;
	const state = createState({ stateDir: tempDir(), now: () => stamp });
	state.addMute({ key: 'topic:abc', untilMs: stamp + 1000, label: 'the deploy' });
	state.addMute({ key: 'id:def', untilMs: stamp + 5000 });

	assert.equal(state.isMuted('topic:abc'), true);
	assert.equal(state.isMuted('topic:zzz'), false);
	assert.deepEqual(state.listMutes().map((entry) => entry.key), ['topic:abc', 'id:def']);

	// Expiry hides the entry but keeps the record until unmuted.
	stamp += 2000;
	assert.equal(state.isMuted('topic:abc'), false);
	assert.deepEqual(state.listMutes().map((entry) => entry.key), ['id:def']);

	assert.equal(state.removeMute('id:def'), true);
	assert.equal(state.removeMute('id:def'), false);
	assert.deepEqual(state.listMutes(), []);
});

test('locks are exclusive and released exactly once', () => {
	const root = tempDir();
	const file = path.join(root, 'job.lock');
	const release = acquireLock(file);
	assert.equal(typeof release, 'function');
	assert.equal(acquireLock(file), undefined);
	release();
	const again = acquireLock(file);
	assert.equal(typeof again, 'function');
	again();
});

test('a stale lock is reclaimed', () => {
	const root = tempDir();
	const file = path.join(root, 'job.lock');
	const first = acquireLock(file);
	assert.equal(typeof first, 'function');
	// staleMs -1 forces the existing lock to be considered stale.
	const second = acquireLock(file, { staleMs: -1 });
	assert.equal(typeof second, 'function');
	second();
});

test('job bookkeeping merges patches', () => {
	const state = createState({ stateDir: tempDir(), now: () => 1000 });
	assert.deepEqual(state.readJobs(), {});
	state.writeJobs({ daily: { status: 'ok' } });
	state.writeJobs({ weekly: { status: 'ok' } });
	assert.deepEqual(state.readJobs(), { daily: { status: 'ok' }, weekly: { status: 'ok' } });
});

test('appendLog never throws and creates the log file', () => {
	const root = tempDir();
	const file = path.join(root, 'logs', 'encoder.log');
	appendLog(file, 'line one');
	appendLog(file, 'line two');
	const text = readFileSync(file, 'utf8');
	assert.ok(text.includes('line one'));
	assert.ok(text.includes('line two'));
	assert.equal(statSync(file).mode & 0o777, FILE_MODE);
	// A directory that cannot be created must not throw.
	appendLog(path.join(root, 'x', 'y'), 'ignored');
});
