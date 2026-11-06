/** Module load: exported shape and cordis wiring through a fake context. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const mod = await import('../lib/index.js');

const dirs = [];
function tempDir() {
	const dir = mkdtempSync(path.join(tmpdir(), 'dafeiyu-module-'));
	dirs.push(dir);
	return dir;
}
after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Minimal cordis-like context recorder. */
function fakeCtx() {
	const registered = [];
	const sections = [];
	const handlers = new Map();
	const cleanups = [];
	const warnings = [];
	return {
		tools: { register: (tool) => registered.push(tool) },
		get: (name) => (name === 'systemPrompt' ? { section: (section) => sections.push(section) } : undefined),
		on: (event, handler) => handlers.set(event, handler),
		effect: (factory) => {
			const dispose = factory();
			if (typeof dispose === 'function') cleanups.push(dispose);
		},
		logger: {
			warn: (message) => warnings.push(message),
			info: () => {},
		},
		// test seams
		registered,
		sections,
		handlers,
		cleanups,
		warnings,
	};
}

/** Config that keeps the test hermetic: node stands in for the CLI. */
function testConfig(stateDir, extra = {}) {
	return { stateDir, rsrsBin: process.execPath, jobs: { enabled: false }, ...extra };
}

test('module exports the documented plugin shape', () => {
	assert.equal(mod.name, 'dafeiyu');
	assert.deepEqual(mod.inject, ['tools']);
	assert.equal(typeof mod.apply, 'function');
	assert.equal(typeof mod.Config, 'function');
	assert.equal(typeof mod.SYSTEM_PROMPT, 'string');
	assert.ok(mod.SYSTEM_PROMPT.length < 1200, `system prompt is ${mod.SYSTEM_PROMPT.length} chars`);
	assert.match(mod.SYSTEM_PROMPT, /untrusted historical context/);
	assert.match(mod.SYSTEM_PROMPT, /op="recall"/);
	assert.match(mod.SYSTEM_PROMPT, /never store secrets/i);
});

test('apply registers the tool, prompt section, pre-step handler and cleanup', () => {
	const stateDir = tempDir();
	const ctx = fakeCtx();
	mod.apply(ctx, testConfig(stateDir));

	assert.equal(ctx.registered.length, 1);
	const tool = ctx.registered[0];
	assert.equal(tool.name, 'memory');
	assert.equal(typeof tool.execute, 'function');
	assert.equal(tool.parameters.properties.op.type, 'string');

	assert.equal(ctx.sections.length, 2);
	assert.equal(ctx.sections[0].name, 'dafeiyu:memory');
	assert.equal(ctx.sections[0].order, 120);
	assert.ok(ctx.sections[0].text.length > 200);

	// The managed self-note is registered as a provider evaluated per assembly.
	const note = ctx.sections[1];
	assert.equal(note.name, 'dafeiyu:selfnote');
	assert.equal(note.order, 121);
	assert.equal(note.interpolate, false);
	assert.equal(typeof note.text, 'function');
	assert.equal(note.text({}), '', 'an empty note contributes nothing');

	assert.equal(ctx.handlers.has('agent/pre-step'), true);
	assert.equal(typeof ctx.handlers.get('agent/pre-step'), 'function');

	assert.equal(ctx.cleanups.length, 1);
	assert.doesNotThrow(() => ctx.cleanups[0]());
});

test('a disabled plugin registers nothing', () => {
	const stateDir = tempDir();
	const ctx = fakeCtx();
	mod.apply(ctx, testConfig(stateDir, { enabled: false }));
	assert.equal(ctx.registered.length, 0);
	assert.equal(ctx.sections.length, 0);
	assert.equal(ctx.handlers.size, 0);
	assert.equal(ctx.cleanups.length, 0);
});

test('apply tolerates a context without systemPrompt', () => {
	const stateDir = tempDir();
	const registered = [];
	const ctx = {
		tools: { register: (tool) => registered.push(tool) },
		get: () => undefined,
		on: () => {},
		effect: () => {},
	};
	assert.doesNotThrow(() => mod.apply(ctx, testConfig(stateDir)));
	assert.equal(registered.length, 1);
});

test('the scheduler starts when jobs are enabled and cleans up', () => {
	const stateDir = tempDir();
	const ctx = fakeCtx();
	mod.apply(ctx, testConfig(stateDir, { jobs: { enabled: true } }));
	assert.equal(ctx.cleanups.length, 1);
	assert.doesNotThrow(() => ctx.cleanups[0]());
});

test('the registered pre-step handler fails open with a broken CLI', async () => {
	const stateDir = tempDir();
	const ctx = fakeCtx();
	// A binary that always fails must not break the turn.
	mod.apply(ctx, testConfig(stateDir, { rsrsBin: '/definitely/not/a/binary' }));
	const handler = ctx.handlers.get('agent/pre-step');
	const decision = {
		kind: 'enter',
		messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'What did we decide about the deploy?' }] }],
	};
	const out = await handler({ agent: { id: 's1' } }, async () => decision);
	assert.strictEqual(out, decision);
	ctx.cleanups[0]();
});

test('the self-note provider reads the managed file on demand', async () => {
	const stateDir = tempDir();
	const ctx = fakeCtx();
	mod.apply(ctx, testConfig(stateDir));
	const note = ctx.sections[1];
	assert.equal(note.text({}), '');

	const { writeBrief, selfnoteFile, SELFNOTE_START, SELFNOTE_END } = await import('../lib/selfnote.js');
	writeBrief(selfnoteFile(stateDir), 'Prefer short answers.');
	assert.equal(note.text({}), `${SELFNOTE_START}\nPrefer short answers.\n${SELFNOTE_END}`);
	ctx.cleanups[0]();
});

test('apply fails fast on unsafe memory wiring instead of writing the main store', () => {
	const stateDir = tempDir();

	// isolated dataDir without its own port: refused at startup.
	const noPort = fakeCtx();
	assert.throws(
		() => mod.apply(noPort, testConfig(stateDir, { memory: { mode: 'isolated', isolatedRpcPort: 0 } })),
		/requires memory\.rpcPort|silently write the main store/,
	);
	assert.equal(noPort.registered.length, 0, 'nothing registers before validation');

	// main mode with an explicit dataDir: refused at startup.
	const mainWithDir = fakeCtx();
	assert.throws(
		() => mod.apply(mainWithDir, testConfig(stateDir, { dataDir: '/srv/rsrs' })),
		/mode='main' must not set dataDir/,
	);
	assert.equal(mainWithDir.registered.length, 0);

	// Valid wiring still starts.
	const ok = fakeCtx();
	assert.doesNotThrow(() => mod.apply(ok, testConfig(stateDir, { memory: { mode: 'isolated' } })));
	assert.equal(ok.registered.length, 1);
	ok.cleanups[0]();
});
