/** Config defaults, normalization and schemastery schema. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { Config, DEFAULTS, SCOPE_MODES, expandPath, resolveConfig, validateMemoryConfig } from '../lib/config.js';

const ENV = { HOME: '/home/tester', PATH: '/usr/bin' };

test('defaults resolve to the documented values', () => {
	const config = resolveConfig({}, { env: ENV, cwd: '/work' });
	assert.equal(config.enabled, true);
	assert.equal(config.autoRecall, true);
	assert.equal(config.retrieval, 'auto');
	assert.equal(config.rsrsBin, '');
	assert.equal(config.dataDir, '');
	assert.equal(config.project, '');
	assert.equal(config.recallLimit, 20);
	assert.equal(config.recallBudgetChars, 1500);
	assert.equal(config.recallTimeoutMs, 2500);
	assert.equal(config.cooldownMs, 30000);
	assert.equal(config.sameQueryCooldownMs, 600000);
	assert.equal(config.minScoreHybrid, 0.42);
	assert.equal(config.host, 'dsh');
	assert.equal(config.debugLog, false);
	assert.deepEqual(config.proactive, { ...DEFAULTS.proactive });
	assert.deepEqual(config.jobs, {
		...DEFAULTS.jobs,
		respireRepo: '/home/tester/Documents/respire/respire-cli',
		graniteModelDir: '/home/tester/.rsrs/models/granite-97m-r2',
		anchorDir: '/home/tester/.rsrs/encoder',
	});
});

test('stateDir defaults to $DSH_HOME/dafeiyu', () => {
	const plain = resolveConfig({}, { env: ENV, cwd: '/work' });
	assert.equal(plain.stateDir, path.join('/home/tester', '.dsh', 'dafeiyu'));

	const withHome = resolveConfig({}, { env: { ...ENV, DSH_HOME: '/custom/dsh' }, cwd: '/work' });
	assert.equal(withHome.stateDir, path.join('/custom/dsh', 'dafeiyu'));

	const explicit = resolveConfig({ stateDir: '~/state' }, { env: ENV, cwd: '/work' });
	assert.equal(explicit.stateDir, path.join('/home/tester', 'state'));
});

test('~ and $VAR expansion', () => {
	assert.equal(expandPath('~/x', ENV), path.join('/home/tester', 'x'));
	assert.equal(expandPath('~', ENV), '/home/tester');
	assert.equal(expandPath('$HOME/y', ENV), path.join('/home/tester', 'y'));
	assert.equal(expandPath('${HOME}/z', ENV), path.join('/home/tester', 'z'));
	assert.equal(expandPath('$MISSING/q', ENV), '/q');
	assert.equal(expandPath('  ', ENV), '');
	assert.equal(expandPath(42, ENV), '');
});

test('retrieval accepts only documented modes', () => {
	assert.equal(resolveConfig({ retrieval: 'lexical' }, { env: ENV }).retrieval, 'lexical');
	assert.equal(resolveConfig({ retrieval: 'granite' }, { env: ENV }).retrieval, 'granite');
	assert.equal(resolveConfig({ retrieval: 'nonsense' }, { env: ENV }).retrieval, 'auto');
});

test('numbers are clamped and integers truncated', () => {
	const config = resolveConfig({
		recallLimit: 0,
		recallBudgetChars: 999999,
		recallTimeoutMs: 1,
		minScoreHybrid: 7,
		cooldownMs: -5,
		proactive: { maxItems: 99, permissionTurns: 3.9 },
		jobs: { dailyHour: 99, dailyMinute: -3, dailyLimit: 0 },
	}, { env: ENV });
	assert.equal(config.recallLimit, 1);
	assert.equal(config.recallBudgetChars, 20000);
	assert.equal(config.recallTimeoutMs, 100);
	assert.equal(config.minScoreHybrid, 1);
	assert.equal(config.cooldownMs, 0);
	assert.equal(config.proactive.maxItems, 10);
	assert.equal(config.proactive.permissionTurns, 3);
	assert.equal(config.jobs.dailyHour, 23);
	assert.equal(config.jobs.dailyMinute, 0);
	assert.equal(config.jobs.dailyLimit, 1);
});

test('booleans accept strings and reject junk', () => {
	assert.equal(resolveConfig({ enabled: 'false' }, { env: ENV }).enabled, false);
	assert.equal(resolveConfig({ autoRecall: 0 }, { env: ENV }).autoRecall, false);
	assert.equal(resolveConfig({ enabled: 'maybe' }, { env: ENV }).enabled, true);
	assert.equal(resolveConfig({ proactive: { enabled: 'true' } }, { env: ENV }).proactive.enabled, true);
});

test('binary and data dir come from config or env, and are absolute', () => {
	const config = resolveConfig(
		{ rsrsBin: '~/bin/rsrs', dataDir: '$RSRS_HOME' },
		{ env: { ...ENV, RSRS_HOME: '/data/rsrs' }, cwd: '/work' },
	);
	assert.equal(config.rsrsBin, path.join('/home/tester', 'bin', 'rsrs'));
	assert.equal(config.dataDir, '/data/rsrs');
});

test('schemastery Config is exported and validates defaults', { skip: Config === undefined ? 'schemastery not installed' : false }, () => {
	assert.equal(typeof Config, 'function');
	const resolved = Config({});
	assert.equal(resolved.retrieval, 'auto');
	assert.equal(resolved.recallLimit, 20);
	assert.equal(resolved.proactive.enabled, false);
	assert.equal(resolved.jobs.dailyHour, 3);
});

/* ---------------- memory.mode: main / isolated ---------------- */

test('memory.mode=main leaves both child env vars unset', () => {
	const config = resolveConfig({ memory: { mode: 'main' } }, { env: ENV, cwd: '/work' });
	assert.equal(config.memory.mode, 'main');
	assert.equal(config.dataDir, '');
	assert.equal(config.rpcPort, 0);
	assert.equal(validateMemoryConfig(config), config);
	// Neither env var is ever set in main mode (asserted against the child env
	// construction in rsrs.test.js).
});

test('memory.mode=isolated forces dataDir and rpcPort together', () => {
	const config = resolveConfig({ memory: { mode: 'isolated' } }, { env: ENV, cwd: '/work' });
	assert.equal(config.memory.mode, 'isolated');
	assert.equal(config.dataDir, path.join('/home/tester', '.rsrs', 'accounts', 'dafeiyu'));
	assert.equal(config.rpcPort, 15270);
	assert.equal(validateMemoryConfig(config), config);
});

test('memory.mode=isolated expands to the documented per-host path', () => {
	// The default `~/.rsrs/accounts/dafeiyu` on the real host HOME.
	const config = resolveConfig({ memory: { mode: 'isolated' } }, { env: { HOME: '/home/fslong' }, cwd: '/work' });
	assert.equal(config.dataDir, '/home/fslong/.rsrs/accounts/dafeiyu');
	assert.equal(config.rpcPort, 15270);
});

test('memory.mode honors an explicit isolated dataDir and port', () => {
	const config = resolveConfig(
		{ memory: { mode: 'isolated', isolatedDataDir: '/srv/other-space', isolatedRpcPort: 15999 } },
		{ env: ENV, cwd: '/work' },
	);
	assert.equal(config.dataDir, '/srv/other-space');
	assert.equal(config.rpcPort, 15999);
	assert.equal(validateMemoryConfig(config), config);
});

test('an unknown memory.mode falls back to main', () => {
	const config = resolveConfig({ memory: { mode: 'nonsense' } }, { env: ENV });
	assert.equal(config.memory.mode, 'main');
	assert.equal(config.dataDir, '');
	assert.equal(config.rpcPort, 0);
});

test('fail fast: isolated dataDir without a port is rejected at startup', () => {
	// The silent-main-store bug: dataDir set, port left at the default 15169.
	const broken = { ...resolveConfig({ memory: { mode: 'isolated', isolatedRpcPort: 0 } }, { env: ENV, cwd: '/work' }) };
	assert.equal(broken.dataDir !== '', true);
	assert.equal(broken.rpcPort, 0);
	assert.throws(() => validateMemoryConfig(broken), /isolated.*requires memory\.rpcPort|silently write the main store/);
});

test('fail fast: main mode refuses an explicit dataDir or rpcPort', () => {
	const withDataDir = resolveConfig({ dataDir: '/srv/rsrs' }, { env: ENV, cwd: '/work' });
	assert.throws(() => validateMemoryConfig(withDataDir), /mode='main' must not set dataDir/);

	const withPort = resolveConfig({ rpcPort: 15270 }, { env: ENV, cwd: '/work' });
	assert.throws(() => validateMemoryConfig(withPort), /mode='main' must not set rpcPort/);

	// Main with both set is still self-contradictory: mode wins, it throws.
	const both = resolveConfig({ dataDir: '/srv/rsrs', rpcPort: 15270 }, { env: ENV, cwd: '/work' });
	assert.throws(() => validateMemoryConfig(both), /mode='main' must not set dataDir/);
});

/* ---------------- scope.mode: legacy / per_conversation / per_user / global ---------------- */

test('scope.mode defaults to legacy (existing behaviour preserved)', () => {
	const config = resolveConfig({}, { env: ENV, cwd: '/work' });
	assert.equal(config.scope.mode, 'legacy');
	assert.deepEqual(config.scope, { mode: 'legacy' });
});

test('scope.mode accepts the four documented modes', () => {
	assert.deepEqual(SCOPE_MODES, ['legacy', 'per_conversation', 'per_user', 'global']);
	// The three non-legacy modes are exactly the lib/scope.js deriveScope modes.
	assert.deepEqual(SCOPE_MODES.slice(1), ['per_conversation', 'per_user', 'global']);
	for (const mode of SCOPE_MODES) {
		assert.equal(resolveConfig({ scope: { mode } }, { env: ENV }).scope.mode, mode);
	}
});

test('an unknown scope.mode falls back to legacy', () => {
	const config = resolveConfig({ scope: { mode: 'nonsense' } }, { env: ENV });
	assert.equal(config.scope.mode, 'legacy');
});
