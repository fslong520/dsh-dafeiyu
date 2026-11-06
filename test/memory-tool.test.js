/** `memory` tool dispatch against a fake rsrs CLI. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { resolveConfig } from '../lib/config.js';
import { createMemoryTool, hypothesisTitle } from '../lib/memory-tool.js';
import { createProactiveGate } from '../lib/proactive.js';
import { createState } from '../lib/state.js';
import { createFakeRsrs } from './fake-rsrs.js';

const T0 = 1_700_000_000_000;
const dirs = [];
const tools = [];

function setup({ learnAvailable = false, failOn = [], envelopes = {}, config: overrides = {} } = {}) {
	const dir = mkdtempSync(path.join(tmpdir(), 'dafeiyu-tool-'));
	dirs.push(dir);
	const state = createState({ stateDir: dir, now: () => T0 });
	const config = resolveConfig({ stateDir: dir, ...overrides }, { env: { HOME: '/home/tester' } });
	const rsrs = createFakeRsrs({ learnAvailable, failOn, envelopes });
	const gate = createProactiveGate({ config, state, now: () => T0 });
	const tool = createMemoryTool({
		config,
		rsrs,
		state,
		gate,
		probe: async () => ({ learnAvailable, bgeAvailable: false }),
		logger: { warn() {} },
		now: () => T0,
	});
	tools.push(tool);
	return { tool, rsrs, state, config, gate };
}

after(() => {
	for (const tool of tools) tool.dispose?.();
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

test('the tool is registered as `memory` with an op enum', () => {
	const { tool } = setup();
	assert.equal(tool.name, 'memory');
	assert.equal(tool.timeoutMs, 180000);
	assert.deepEqual(tool.parameters.properties.op.enum, [
		'recall', 'remember', 'show', 'chain', 'feedback', 'reflect', 'status', 'learn', 'mute', 'attach', 'update', 'selfnote',
	]);
	assert.equal(tool.parameters.required.includes('op'), true);
	assert.deepEqual(tool.parameters.properties.action.enum.slice(-3), ['write', 'show', 'clear']);
	const rendered = tool.output.render({}, { ok: true, op: 'status' });
	assert.deepEqual(rendered, [{ type: 'text', text: '{"ok":true,"op":"status"}' }]);
});

test('recall returns the envelope plus request metadata and records a pending snapshot', async () => {
	const { tool, rsrs, state } = setup();
	const result = await tool.execute({ op: 'recall', query: 'deploy decision' });

	assert.equal(result.ok, true);
	assert.equal(result.op, 'recall');
	assert.equal(result.data.command, 'recall');
	assert.equal(result.data.query_log_id, '11111111-2222-3333-4444-555555555555');
	assert.deepEqual(result.data.ids, ['056f02cc', 'af347325']);
	// Without the self-learning build, --lexical must never be passed.
	assert.equal(result.data.lexical, false);

	const args = rsrs.argsFor('recall')[0];
	assert.deepEqual(args, ['recall', 'deploy decision', '--json', '--titles', '--limit', '20']);
	assert.equal(state.readPending().length, 1);
	assert.equal(state.readPending()[0].requestId, '11111111-2222-3333-4444-555555555555');
});

test('recall honours lexical, limit, type and intent', async () => {
	const { tool, rsrs } = setup({ learnAvailable: true });
	await tool.execute({ op: 'recall', query: 'q', limit: 2, type: 'fact', intent: 'howto', lexical: true });
	const args = rsrs.argsFor('recall')[0];
	assert.ok(args.includes('--lexical'));
	assert.deepEqual(args.slice(2), ['--json', '--titles', '--limit', '2', '--intent', 'howto', '--type', 'fact', '--lexical']);
});

test('remember forwards every provided field', async () => {
	const { tool, rsrs } = setup();
	const result = await tool.execute({
		op: 'remember',
		content: 'Shipped the plugin',
		title: 'Plugin shipped',
		type: 'fact',
		importance: 'important',
		parent: 'abcdef12',
		tags: 'dsh,plugin',
		project: 'proj',
		source_refs: [{ kind: 'file', ref: 'lib/index.js' }],
		see_also: ['11112222'],
		supersedes: 'deadbeef',
		valid_until: '2026-02-01T00:00:00Z',
		review_at: '2026-01-10T00:00:00Z',
		force: true,
	});
	assert.equal(result.ok, true);
	const args = rsrs.argsFor('remember')[0];
	assert.equal(args[0], 'remember');
	assert.equal(args[1], 'Shipped the plugin');
	assert.ok(args.includes('--title') && args.includes('Plugin shipped'));
	assert.ok(args.includes('--importance') && args.includes('important'));
	assert.ok(args.includes('--parent') && args.includes('abcdef12'));
	assert.ok(args.includes('--see-also'));
	assert.ok(args.includes('--supersedes'));
	assert.ok(args.includes('--force'));
	assert.equal(args[args.indexOf('--source-refs') + 1], '[{"kind":"file","ref":"lib/index.js"}]');
});

test('feedback marks the ids and queues a debounced training run', async () => {
	const { tool, rsrs } = setup({ learnAvailable: true });
	const result = await tool.execute({
		op: 'feedback',
		ids: ['056f02cc-488c-46ab-8b5c-da68ec124875'],
		verdict: 'good',
		query_log_id: 'uuid-1',
		source: 'model',
	});

	assert.equal(result.ok, true);
	assert.equal(result.data.marked, true);
	assert.equal(result.data.train, 'queued');
	assert.equal(typeof result.data.result, 'object');

	const markArgs = rsrs.argsFor('query-log:mark')[0];
	assert.deepEqual(markArgs, ['query-log', '--json', 'mark', '056f02cc-488c-46ab-8b5c-da68ec124875', '--good', '--query-log-id', 'uuid-1', '--source', 'model']);

	// No training run happens inside the debounce window.
	assert.equal(rsrs.argsFor('learn').length, 0);
});

test('feedback skips training when the self-learning build is absent', async () => {
	const { tool, rsrs } = setup({ learnAvailable: false });
	const result = await tool.execute({ op: 'feedback', ids: ['056f02cc'], verdict: 'bad' });
	assert.equal(result.data.marked, true);
	assert.equal(result.data.train, 'skipped');
	assert.equal(rsrs.argsFor('query-log:mark')[0].includes('--bad'), true);
});

test('feedback resolves the query-log id from the pending snapshot', async () => {
	const { tool, rsrs } = setup();
	await tool.execute({ op: 'recall', query: 'deploy decision' });
	await tool.execute({ op: 'feedback', ids: ['056f02cc'], verdict: 'good' });
	const markArgs = rsrs.argsFor('query-log:mark')[0];
	assert.equal(markArgs[markArgs.indexOf('--query-log-id') + 1], '11111111-2222-3333-4444-555555555555');
	assert.equal(markArgs[markArgs.indexOf('mark') + 1], '056f02cc-488c-46ab-8b5c-da68ec124875');
});

test('reflect applies the documented defaults', async () => {
	const { tool, rsrs } = setup();
	const content = 'The deploy failed because the lexical flag was passed to an older build';
	const result = await tool.execute({
		op: 'reflect',
		content,
		source_refs: [{ kind: 'file', ref: 'lib/recall.js' }],
	});
	assert.equal(result.ok, true);
	const args = rsrs.argsFor('remember')[0];
	assert.equal(args[args.indexOf('--type') + 1], 'hypothesis');
	assert.equal(args[args.indexOf('--importance') + 1], 'important');
	assert.equal(args[args.indexOf('--title') + 1], `Hypothesis: ${content.slice(0, 59)}…`);
	assert.equal(args[args.indexOf('--valid-until') + 1], new Date(T0 + 7 * 86400000).toISOString());
	assert.equal(args[args.indexOf('--review-at') + 1], new Date(T0 + 3 * 86400000).toISOString());
	assert.equal(args[args.indexOf('--source-refs') + 1], '[{"kind":"file","ref":"lib/recall.js"}]');
});

test('reflect requires source_refs', async () => {
	const { tool } = setup();
	await assert.rejects(tool.execute({ op: 'reflect', content: 'x' }), /source_refs/);
	await assert.rejects(tool.execute({ op: 'reflect', content: 'x', source_refs: [] }), /source_refs/);
});

test('hypothesisTitle is capped at 60 characters', () => {
	assert.equal(hypothesisTitle('short'), 'Hypothesis: short');
	const long = hypothesisTitle('y'.repeat(120));
	assert.ok(long.length <= 72);
	assert.ok(long.endsWith('…'));
});

test('status reports per-section errors instead of throwing', async () => {
	const { tool } = setup({ failOn: ['status'] });
	const result = await tool.execute({ op: 'status' });
	assert.equal(result.ok, true);
	assert.equal(result.data.sections.rsrs.ok, false);
	assert.match(result.data.sections.rsrs.error, /fake failure/);
	// learn is unsupported on this build, which is reported rather than thrown.
	assert.equal(result.data.sections.learn.ok, false);
	assert.equal(result.data.sections.learn.unsupported, true);
	assert.equal(result.data.mode.learnAvailable, false);
	assert.equal(result.data.mode.lexical, false);
	assert.equal(typeof result.data.sections.encoder.ready, 'boolean');
	assert.equal(typeof result.data.counts.mutes, 'number');
});

test('learn returns a structured unsupported result, not a throw', async () => {
	const { tool } = setup({ learnAvailable: false });
	const result = await tool.execute({ op: 'learn', action: 'train' });
	assert.equal(result.ok, false);
	assert.equal(result.op, 'learn');
	assert.match(result.error, /does not support `learn`/);
	assert.match(result.error, /\/fake\/rsrs/);
});

test('learn delegates when the self-learning build is available', async () => {
	const { tool, rsrs } = setup({ learnAvailable: true });
	const status = await tool.execute({ op: 'learn', action: 'status' });
	assert.equal(status.ok, true);
	assert.deepEqual(rsrs.argsFor('learn')[0], ['learn', 'status', '--json']);

	await tool.execute({ op: 'learn', action: 'train', limit: 10, epochs: 2 });
	assert.deepEqual(rsrs.argsFor('learn')[1], ['learn', 'train', '--from-labels', '--json', '--limit', '10', '--epochs', '2']);

	await tool.execute({ op: 'learn', action: 'reset' });
	assert.deepEqual(rsrs.argsFor('learn')[2], ['learn', 'reset', '--json']);

	await tool.execute({ op: 'learn', action: 'lexical-off' });
	assert.deepEqual(rsrs.argsFor('learn')[3], ['learn', 'lexical', '--off', '--json']);
});

test('show and chain validate the id and pass through', async () => {
	const { tool, rsrs } = setup();
	const shown = await tool.execute({ op: 'show', id: '056f02cc' });
	assert.equal(shown.ok, true);
	assert.deepEqual(rsrs.argsFor('show')[0], ['show', '056f02cc', '--json']);

	const chained = await tool.execute({ op: 'chain', id: '056f02cc', depth: 2 });
	assert.equal(chained.ok, true);
	assert.deepEqual(rsrs.argsFor('chain')[0], ['chain', '056f02cc', '--depth', '2', '--json']);

	await assert.rejects(tool.execute({ op: 'show', id: 'not-an-id' }), /invalid id/);
});

test('mute, list and unmute round-trip', async () => {
	const { tool } = setup();
	const muted = await tool.execute({ op: 'mute', action: 'mute', topic: 'the old deploy', duration_hours: 24 });
	assert.equal(muted.ok, true);
	assert.equal(muted.data.muted, true);
	assert.equal(muted.data.kind, 'topic');

	const list = await tool.execute({ op: 'mute', action: 'list' });
	assert.equal(list.data.entries.length, 1);

	const removed = await tool.execute({ op: 'mute', action: 'unmute', topic: 'the old deploy' });
	assert.equal(removed.data.removed, true);

	const empty = await tool.execute({ op: 'mute', action: 'list' });
	assert.equal(empty.data.entries.length, 0);

	await assert.rejects(tool.execute({ op: 'mute', action: 'mute' }), /topic or an id/);
});

test('invalid arguments and unknown ops throw', async () => {
	const { tool } = setup();
	await assert.rejects(tool.execute({ op: 'recall' }), /query is required/);
	await assert.rejects(tool.execute({ op: 'remember' }), /content is required/);
	await assert.rejects(tool.execute({ op: 'feedback', ids: [], verdict: 'good' }), /non-empty array/);
	await assert.rejects(tool.execute({ op: 'feedback', ids: ['056f02cc'] }), /verdict is required/);
	await assert.rejects(tool.execute({ op: 'nope' }), /invalid arguments/);
	await assert.rejects(tool.execute({}), /invalid arguments/);
});

/* ---------------- attach / update ---------------- */

test('attach links an existing record under a causal parent', async () => {
	const { tool, rsrs } = setup();
	const result = await tool.execute({ op: 'attach', id: '056f02cc', parent: 'af347325' });
	assert.equal(result.ok, true);
	assert.equal(result.op, 'attach');
	assert.deepEqual(rsrs.argsFor('attach')[0], ['attach', '056f02cc', '--parent', 'af347325', '--json']);

	await assert.rejects(tool.execute({ op: 'attach', id: '056f02cc' }), /parent is required/);
	await assert.rejects(tool.execute({ op: 'attach', parent: 'af347325' }), /id is required/);
	await assert.rejects(tool.execute({ op: 'attach', id: 'bogus', parent: 'af347325' }), /invalid id/);
});

test('update passes source_refs, valid_until, review_at and friends', async () => {
	const { tool, rsrs } = setup();
	const result = await tool.execute({
		op: 'update',
		id: '056f02cc',
		content: 'updated body',
		title: 'New title',
		importance: 'important',
		tags: 'a,b',
		type: 'fact',
		summary: 'short summary',
		source_refs: [{ id: 'https://example.test/pr/1' }],
		valid_until: '2027-01-01T00:00:00.000Z',
		review_at: '2026-12-01T00:00:00.000Z',
	});
	assert.equal(result.ok, true);
	assert.deepEqual(rsrs.argsFor('update')[0], [
		'update', '056f02cc', '--json',
		'--content', 'updated body',
		'--title', 'New title',
		'--importance', 'important',
		'--tags', 'a,b',
		'--kind', 'fact',
		'--summary', 'short summary',
		'--source-refs', '[{"id":"https://example.test/pr/1"}]',
		'--valid-until', '2027-01-01T00:00:00.000Z',
		'--review-at', '2026-12-01T00:00:00.000Z',
	]);
});

test('update rejects an empty change set, bad ids and supersedes', async () => {
	const { tool } = setup();
	await assert.rejects(tool.execute({ op: 'update', id: '056f02cc' }), /at least one field/);
	await assert.rejects(tool.execute({ op: 'update', id: 'bogus', title: 'x' }), /invalid id/);
	// supersedes rides on remember, not on the CLI's update surface.
	await assert.rejects(
		tool.execute({ op: 'update', id: '056f02cc', title: 'x', supersedes: 'af347325' }),
		/does not support supersedes/,
	);
});

test('status reports the active memory mode', async () => {
	const { tool } = setup({ config: { memory: { mode: 'isolated' } } });
	const result = await tool.execute({ op: 'status' });
	assert.equal(result.data.plugin.memoryMode, 'isolated');
	assert.equal(result.data.plugin.scopeMode, 'legacy');
});

/* ---------------- scope.mode wiring through the tool ---------------- */

test('tool recall derives the project from the calling agent (non-legacy scope)', async () => {
	const { deriveScope } = await import('../lib/scope.js');
	const { tool, rsrs } = setup({ config: { scope: { mode: 'per_conversation' } } });

	await tool.execute({ op: 'recall', query: 'deploy decision' }, { agent: { id: 's-9' } });
	const args = rsrs.argsFor('recall')[0];
	assert.equal(args[args.indexOf('--project') + 1], deriveScope('per_conversation', 's-9', 's-9', 's-9'));

	// Bare call (no runtime identity): falls back to the legacy behaviour.
	await tool.execute({ op: 'recall', query: 'deploy decision' });
	assert.equal(rsrs.argsFor('recall')[1].includes('--project'), false);
});

test('tool remember and reflect honour scope mode, with args.project winning', async () => {
	const { deriveScope } = await import('../lib/scope.js');
	const { tool, rsrs } = setup({ config: { scope: { mode: 'global' } } });

	await tool.execute({ op: 'remember', content: 'body' }, { agent: { id: 's-9' } });
	assert.equal(rsrs.argsFor('remember')[0][rsrs.argsFor('remember')[0].indexOf('--project') + 1], 'dsh:global');

	// An explicit project argument overrides the derived scope.
	await tool.execute({ op: 'remember', content: 'body', project: 'explicit' }, { agent: { id: 's-9' } });
	assert.equal(rsrs.argsFor('remember')[1][rsrs.argsFor('remember')[1].indexOf('--project') + 1], 'explicit');

	await tool.execute({ op: 'reflect', content: 'hyp', source_refs: [{ id: 'r' }] }, { agent: { id: 's-9' } });
	assert.equal(rsrs.argsFor('remember')[2][rsrs.argsFor('remember')[2].indexOf('--project') + 1], 'dsh:global');
});

test('legacy scope mode keeps the pre-wiring project behaviour', async () => {
	const { tool, rsrs } = setup({ config: { scope: { mode: 'legacy' }, project: 'myproj' } });
	await tool.execute({ op: 'recall', query: 'deploy decision' }, { agent: { id: 's-9' } });
	const args = rsrs.argsFor('recall')[0];
	assert.equal(args[args.indexOf('--project') + 1], 'myproj');

	const bare = setup({ config: { scope: { mode: 'legacy' } } });
	await bare.tool.execute({ op: 'recall', query: 'deploy decision' }, { agent: { id: 's-9' } });
	assert.equal(bare.rsrs.argsFor('recall')[0].includes('--project'), false);
});

/* ---------------- selfnote write entrance ---------------- */

test('selfnote write/show/clear round-trips through the managed file', async () => {
	const { tool, config } = setup();
	const { SELFNOTE_START, SELFNOTE_END } = await import('../lib/selfnote.js');

	// Empty before the first write.
	const before = await tool.execute({ op: 'selfnote', action: 'show' });
	assert.deepEqual(before.data, { action: 'show', brief: '', chars: 0, max_chars: 300 });

	const written = await tool.execute({ op: 'selfnote', action: 'write', note: 'Prefer short answers; run the checklist.' });
	assert.equal(written.ok, true);
	assert.equal(written.data.action, 'write');
	assert.equal(written.data.brief, 'Prefer short answers; run the checklist.');
	assert.equal(written.data.clamped, false);

	// The file holds the managed block, so the prompt section can pick it up.
	const { readFileSync } = await import('node:fs');
	const { selfnoteFile } = await import('../lib/selfnote.js');
	const onDisk = readFileSync(selfnoteFile(config.stateDir), 'utf8');
	assert.equal(onDisk.includes(SELFNOTE_START) && onDisk.includes(SELFNOTE_END), true);

	const shown = await tool.execute({ op: 'selfnote' });
	assert.equal(shown.data.brief, 'Prefer short answers; run the checklist.');

	const cleared = await tool.execute({ op: 'selfnote', action: 'clear' });
	assert.equal(cleared.data.cleared, true);
	const after = await tool.execute({ op: 'selfnote', action: 'show' });
	assert.equal(after.data.brief, '');
});

test('selfnote clamps over-long notes and validates arguments', async () => {
	const { tool } = setup();
	const long = await tool.execute({ op: 'selfnote', action: 'write', note: 'x'.repeat(400) });
	assert.equal(long.data.clamped, true);
	assert.equal(long.data.chars, 300);
	assert.equal(long.data.max_chars, 300);

	await assert.rejects(tool.execute({ op: 'selfnote', action: 'write' }), /note is required/);
	// Unknown actions are rejected by the schema enum (or, if bypassed, by the
	// op handler itself) — never silently ignored.
	await assert.rejects(tool.execute({ op: 'selfnote', action: 'bogus' }), /invalid arguments|unknown selfnote action/);
});
