/**
 * dafeiyu configuration: schemastery `Config` plus a dependency-free
 * `resolveConfig()` normalizer used by every other module and by the tests.
 *
 * `resolveConfig()` never throws. Bad values fall back to defaults so that a
 * typo in a profile config can never take down a user turn.
 */
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Resolve schemastery under either the scoped name the DSH runtime ships
 * (`@deepseek-ai/schemastery`) or the bare peer-dependency name from
 * package.json. Returns undefined when neither is installed, which keeps the
 * plugin loadable in a bare checkout (cordis treats a missing Config as "no
 * schema").
 */
export function loadSchemastery() {
	for (const id of ['@deepseek-ai/schemastery', 'schemastery']) {
		try {
			const loaded = require(id);
			return loaded?.default ?? loaded;
		} catch {
			/* try the next candidate */
		}
	}
	return undefined;
}

const Schema = loadSchemastery();

/** Retrieval strategies accepted by `retrieval`. */
export const RETRIEVAL_MODES = ['auto', 'lexical', 'hybrid', 'granite'];
/** Host label recorded in status output. */
export const DEFAULT_HOST = 'dsh';
/** `dafeiyu.memory.mode` values: main store vs isolated account space. */
export const MEMORY_MODES = ['main', 'isolated'];
/**
 * `dafeiyu.scope.mode` values. `legacy` preserves the historical behaviour
 * (plain `config.project`, no scope derivation — the default, so switching
 * versions never rewrites live scopes); the other three map 1:1 onto
 * `lib/scope.js` deriveScope modes.
 */
export const SCOPE_MODES = ['legacy', 'per_conversation', 'per_user', 'global'];
/** Non-default rsrs RPC port forced in isolated mode (never 15169). */
export const ISOLATED_RPC_PORT = 15270;
/** Default isolated data dir; expands to `~/.rsrs/accounts/dafeiyu`. */
export const ISOLATED_DATA_DIR = '~/.rsrs/accounts/dafeiyu';

/**
 * Declarative defaults. This object is the single source of truth for both the
 * schemastery schema and `resolveConfig()`.
 */
export const DEFAULTS = Object.freeze({
	enabled: true,
	autoRecall: true,
	retrieval: 'auto',
	rsrsBin: '',
	dataDir: '',
	/** Child-process RPC port; 0 = do not set `RSRS_RPC_PORT` (CLI default). */
	rpcPort: 0,
	project: '',
	memory: Object.freeze({
		mode: 'main',
		isolatedDataDir: ISOLATED_DATA_DIR,
		isolatedRpcPort: ISOLATED_RPC_PORT,
	}),
	scope: Object.freeze({
		mode: 'legacy',
	}),
	recallLimit: 20,
	recallBudgetChars: 1500,
	recallTimeoutMs: 2500,
	cooldownMs: 30000,
	sameQueryCooldownMs: 600000,
	minScoreHybrid: 0.42,
	host: DEFAULT_HOST,
	proactive: Object.freeze({
		enabled: false,
		maxItems: 1,
		permissionTurns: 5,
		permissionMs: 1800000,
		topicCooldownMs: 86400000,
		reflectionTtlDays: 7,
		reflectionMaxChars: 350,
	}),
	jobs: Object.freeze({
		enabled: true,
		dailyHour: 3,
		dailyMinute: 30,
		dailyLimit: 5000,
		weeklyGranite: true,
		maintenanceEnabled: true,
		maintenanceHour: 4,
		maintenanceMinute: 0,
		maintenanceLimit: 20,
		respireRepo: '~/Documents/respire/respire-cli',
		graniteModelDir: '~/.rsrs/models/granite-97m-r2',
		anchorDir: '~/.rsrs/encoder',
	}),
	stateDir: '',
	debugLog: false,
});

const proactiveSchema = () => Schema.object({
	enabled: Schema.boolean().default(DEFAULTS.proactive.enabled),
	maxItems: Schema.natural().default(DEFAULTS.proactive.maxItems),
	permissionTurns: Schema.natural().default(DEFAULTS.proactive.permissionTurns),
	permissionMs: Schema.natural().default(DEFAULTS.proactive.permissionMs),
	topicCooldownMs: Schema.natural().default(DEFAULTS.proactive.topicCooldownMs),
	reflectionTtlDays: Schema.natural().default(DEFAULTS.proactive.reflectionTtlDays),
	reflectionMaxChars: Schema.natural().default(DEFAULTS.proactive.reflectionMaxChars),
});

const jobsSchema = () => Schema.object({
	enabled: Schema.boolean().default(DEFAULTS.jobs.enabled),
	dailyHour: Schema.natural().default(DEFAULTS.jobs.dailyHour),
	dailyMinute: Schema.natural().default(DEFAULTS.jobs.dailyMinute),
	dailyLimit: Schema.natural().default(DEFAULTS.jobs.dailyLimit),
	weeklyGranite: Schema.boolean().default(DEFAULTS.jobs.weeklyGranite),
	maintenanceEnabled: Schema.boolean().default(DEFAULTS.jobs.maintenanceEnabled),
	maintenanceHour: Schema.natural().default(DEFAULTS.jobs.maintenanceHour),
	maintenanceMinute: Schema.natural().default(DEFAULTS.jobs.maintenanceMinute),
	maintenanceLimit: Schema.natural().default(DEFAULTS.jobs.maintenanceLimit),
	respireRepo: Schema.string().default(DEFAULTS.jobs.respireRepo),
	graniteModelDir: Schema.string().default(DEFAULTS.jobs.graniteModelDir),
	anchorDir: Schema.string().default(DEFAULTS.jobs.anchorDir),
});

const memorySchema = () => Schema.object({
	mode: Schema.union(MEMORY_MODES.map((mode) => Schema.const(mode))).default(DEFAULTS.memory.mode),
	isolatedDataDir: Schema.string().default(DEFAULTS.memory.isolatedDataDir),
	isolatedRpcPort: Schema.natural().default(DEFAULTS.memory.isolatedRpcPort),
});

const scopeSchema = () => Schema.object({
	mode: Schema.union(SCOPE_MODES.map((mode) => Schema.const(mode))).default(DEFAULTS.scope.mode),
});

/**
 * Cordis/schemastery config schema. Undefined when schemastery is absent.
 */
export const Config = Schema ? Schema.object({
	enabled: Schema.boolean().default(DEFAULTS.enabled),
	autoRecall: Schema.boolean().default(DEFAULTS.autoRecall),
	retrieval: Schema.union(RETRIEVAL_MODES.map((mode) => Schema.const(mode))).default(DEFAULTS.retrieval),
	rsrsBin: Schema.string().default(DEFAULTS.rsrsBin),
	dataDir: Schema.string().default(DEFAULTS.dataDir),
	rpcPort: Schema.natural().default(DEFAULTS.rpcPort),
	project: Schema.string().default(DEFAULTS.project),
	memory: memorySchema().default({ ...DEFAULTS.memory }),
	scope: scopeSchema().default({ ...DEFAULTS.scope }),
	recallLimit: Schema.natural().default(DEFAULTS.recallLimit),
	recallBudgetChars: Schema.natural().default(DEFAULTS.recallBudgetChars),
	recallTimeoutMs: Schema.natural().default(DEFAULTS.recallTimeoutMs),
	cooldownMs: Schema.natural().default(DEFAULTS.cooldownMs),
	sameQueryCooldownMs: Schema.natural().default(DEFAULTS.sameQueryCooldownMs),
	minScoreHybrid: Schema.number().default(DEFAULTS.minScoreHybrid),
	host: Schema.string().default(DEFAULTS.host),
	proactive: proactiveSchema().default({ ...DEFAULTS.proactive }),
	jobs: jobsSchema().default({ ...DEFAULTS.jobs }),
	stateDir: Schema.string().default(DEFAULTS.stateDir),
	debugLog: Schema.boolean().default(DEFAULTS.debugLog),
}) : undefined;

/** Home directory used for `~` expansion; overridable for tests. */
function homeOf(env) {
	return env.HOME || env.USERPROFILE || homedir();
}

/**
 * Expand a leading `~` and `$VAR` / `${VAR}` references.
 * Unknown variables collapse to an empty string rather than throwing.
 */
export function expandPath(value, env = process.env) {
	if (typeof value !== 'string') return '';
	let out = value.trim();
	if (out === '') return '';
	const home = homeOf(env);
	if (out === '~') out = home;
	else if (out.startsWith('~/') || out.startsWith('~\\')) out = path.join(home, out.slice(2));
	out = out.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, braced, bare) => {
		const key = braced || bare;
		const resolved = env[key];
		return resolved === undefined ? '' : String(resolved);
	});
	return out;
}

/** Coerce to boolean with a default. */
export function bool(value, fallback) {
	if (typeof value === 'boolean') return value;
	if (value === 'true' || value === '1' || value === 1) return true;
	if (value === 'false' || value === '0' || value === 0) return false;
	return fallback;
}

/** Clamp a numeric value into [min, max], optionally rounding to an integer. */
export function num(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = true } = {}) {
	let next = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(next)) next = fallback;
	if (integer) next = Math.trunc(next);
	if (next < min) next = min;
	if (next > max) next = max;
	return next;
}

/** Resolve a string field with `~`/env expansion; empty means "unset". */
function pathField(value, fallback, env) {
	const raw = typeof value === 'string' && value.trim() !== '' ? value : fallback;
	return expandPath(raw, env);
}

/** Merge a nested options object over its defaults, ignoring non-objects. */
function mergeNested(value, defaults) {
	const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
	return { ...defaults, ...source };
}

/**
 * Normalize user config into a fully-resolved plain object.
 *
 * @param {object} [raw] raw config as delivered by cordis (may be undefined).
 * @param {{env?: object, cwd?: string, home?: string}} [options] test seams.
 * @returns {object} resolved config; every field present and in range.
 */
export function resolveConfig(raw = {}, options = {}) {
	const env = options.env ?? process.env;
	const cwd = options.cwd ?? process.cwd();
	const source = raw && typeof raw === 'object' ? raw : {};

	const retrieval = RETRIEVAL_MODES.includes(source.retrieval) ? source.retrieval : DEFAULTS.retrieval;

	const proactive = mergeNested(source.proactive, DEFAULTS.proactive);
	const jobs = mergeNested(source.jobs, DEFAULTS.jobs);
	const memory = mergeNested(source.memory, DEFAULTS.memory);
	const memoryMode = MEMORY_MODES.includes(memory.mode) ? memory.mode : DEFAULTS.memory.mode;
	const scope = mergeNested(source.scope, DEFAULTS.scope);
	const scopeMode = SCOPE_MODES.includes(scope.mode) ? scope.mode : DEFAULTS.scope.mode;

	// $DSH_HOME/dafeiyu is the default state root.
	const dshHome = env.DSH_HOME && env.DSH_HOME.trim() !== ''
		? expandPath(env.DSH_HOME, env)
		: path.join(homeOf(env), '.dsh');
	const defaultStateDir = path.join(dshHome, 'dafeiyu');
	const stateDirRaw = pathField(source.stateDir, defaultStateDir, env);

	// Memory storage axis (dafeiyu.memory.mode):
	//   main      -> neither RSRS_DATA_DIR nor RSRS_RPC_PORT is ever set;
	//               an explicit dataDir/rpcPort survives resolution ONLY so
	//               validateMemoryConfig() can reject it loudly (no silent drop).
	//   isolated  -> dataDir and rpcPort are set together, always.
	let dataDir;
	let rpcPort;
	if (memoryMode === 'isolated') {
		const rawDir = typeof memory.isolatedDataDir === 'string' && memory.isolatedDataDir.trim() !== ''
			? memory.isolatedDataDir
			: (typeof source.dataDir === 'string' && source.dataDir.trim() !== ''
				? source.dataDir
				: DEFAULTS.memory.isolatedDataDir);
		dataDir = pathField(rawDir, DEFAULTS.memory.isolatedDataDir, env);
		rpcPort = num(memory.isolatedRpcPort, DEFAULTS.memory.isolatedRpcPort, { min: 0, max: 65535 });
	} else {
		dataDir = pathField(source.dataDir, '', env);
		rpcPort = num(source.rpcPort, DEFAULTS.rpcPort, { min: 0, max: 65535 });
	}

	const resolved = {
		enabled: bool(source.enabled, DEFAULTS.enabled),
		autoRecall: bool(source.autoRecall, DEFAULTS.autoRecall),
		retrieval,
		rsrsBin: pathField(source.rsrsBin, '', env),
		dataDir,
		rpcPort,
		project: typeof source.project === 'string' ? source.project.trim() : DEFAULTS.project,
		memory: {
			mode: memoryMode,
			isolatedDataDir: expandPath(DEFAULTS.memory.isolatedDataDir, env),
			isolatedRpcPort: rpcPort,
		},
		scope: { mode: scopeMode },
		recallLimit: num(source.recallLimit, DEFAULTS.recallLimit, { min: 1, max: 50 }),
		recallBudgetChars: num(source.recallBudgetChars, DEFAULTS.recallBudgetChars, { min: 200, max: 20000 }),
		recallTimeoutMs: num(source.recallTimeoutMs, DEFAULTS.recallTimeoutMs, { min: 100, max: 120000 }),
		cooldownMs: num(source.cooldownMs, DEFAULTS.cooldownMs, { min: 0, max: 86400000 }),
		sameQueryCooldownMs: num(source.sameQueryCooldownMs, DEFAULTS.sameQueryCooldownMs, { min: 0, max: 604800000 }),
		minScoreHybrid: num(source.minScoreHybrid, DEFAULTS.minScoreHybrid, { min: 0, max: 1, integer: false }),
		host: typeof source.host === 'string' && source.host.trim() !== '' ? source.host.trim() : DEFAULTS.host,
		proactive: {
			enabled: bool(proactive.enabled, DEFAULTS.proactive.enabled),
			maxItems: num(proactive.maxItems, DEFAULTS.proactive.maxItems, { min: 0, max: 10 }),
			permissionTurns: num(proactive.permissionTurns, DEFAULTS.proactive.permissionTurns, { min: 0, max: 100 }),
			permissionMs: num(proactive.permissionMs, DEFAULTS.proactive.permissionMs, { min: 0, max: 86400000 }),
			topicCooldownMs: num(proactive.topicCooldownMs, DEFAULTS.proactive.topicCooldownMs, { min: 0, max: 604800000 }),
			reflectionTtlDays: num(proactive.reflectionTtlDays, DEFAULTS.proactive.reflectionTtlDays, { min: 1, max: 365 }),
			reflectionMaxChars: num(proactive.reflectionMaxChars, DEFAULTS.proactive.reflectionMaxChars, { min: 40, max: 2000 }),
		},
		jobs: {
			enabled: bool(jobs.enabled, DEFAULTS.jobs.enabled),
			dailyHour: num(jobs.dailyHour, DEFAULTS.jobs.dailyHour, { min: 0, max: 23 }),
			dailyMinute: num(jobs.dailyMinute, DEFAULTS.jobs.dailyMinute, { min: 0, max: 59 }),
			dailyLimit: num(jobs.dailyLimit, DEFAULTS.jobs.dailyLimit, { min: 1, max: 1000000 }),
			weeklyGranite: bool(jobs.weeklyGranite, DEFAULTS.jobs.weeklyGranite),
			maintenanceEnabled: bool(jobs.maintenanceEnabled, DEFAULTS.jobs.maintenanceEnabled),
			maintenanceHour: num(jobs.maintenanceHour, DEFAULTS.jobs.maintenanceHour, { min: 0, max: 23 }),
			maintenanceMinute: num(jobs.maintenanceMinute, DEFAULTS.jobs.maintenanceMinute, { min: 0, max: 59 }),
			maintenanceLimit: num(jobs.maintenanceLimit, DEFAULTS.jobs.maintenanceLimit, { min: 1, max: 100 }),
			respireRepo: pathField(jobs.respireRepo, DEFAULTS.jobs.respireRepo, env),
			graniteModelDir: pathField(jobs.graniteModelDir, DEFAULTS.jobs.graniteModelDir, env),
			anchorDir: pathField(jobs.anchorDir, DEFAULTS.jobs.anchorDir, env),
		},
		stateDir: path.resolve(cwd, stateDirRaw),
		debugLog: bool(source.debugLog, DEFAULTS.debugLog),
	};

	// dataDir is passed straight to the child env, so keep it absolute.
	if (resolved.dataDir !== '') resolved.dataDir = path.resolve(cwd, resolved.dataDir);
	return resolved;
}

/**
 * Fail fast on memory wiring that would silently write the main store.
 *
 * History: a non-default `dataDir` sharing the default 15169 singleton made
 * every write land in the real store with no error at all, so an ambiguous
 * configuration must abort plugin startup instead of degrading quietly.
 * `resolveConfig()` itself never throws (documented contract); this guard runs
 * first thing in `apply()` and again as a local tripwire in `createRsrs()`.
 *
 * @param {object} resolved result of `resolveConfig()`.
 * @throws {Error} when dataDir/rpcPort wiring is unsafe or self-contradictory.
 */
export function validateMemoryConfig(resolved) {
	const mode = resolved?.memory?.mode ?? DEFAULTS.memory.mode;
	const dataDir = typeof resolved?.dataDir === 'string' ? resolved.dataDir : '';
	const rpcPort = Number(resolved?.rpcPort ?? 0);

	if (mode === 'isolated') {
		if (dataDir === '') {
			throw new Error(
				"dafeiyu.memory.mode='isolated' resolved an empty dataDir; refusing to start (it would fall back to the main store)",
			);
		}
		if (!Number.isFinite(rpcPort) || rpcPort === 0) {
			throw new Error(
				`dafeiyu.memory.mode='isolated' requires memory.rpcPort (non-zero, default ${ISOLATED_RPC_PORT}); `
				+ `dataDir=${dataDir} with the default rsrs port would silently write the main store`,
			);
		}
		return resolved;
	}

	// mode === 'main': neither variable may be set.
	if (dataDir !== '') {
		throw new Error(
			`dafeiyu.memory.mode='main' must not set dataDir (got ${dataDir}); `
			+ "set dafeiyu.memory.mode='isolated' for a separate store, or clear dataDir",
		);
	}
	if (rpcPort !== 0) {
		throw new Error(
			`dafeiyu.memory.mode='main' must not set rpcPort (got ${rpcPort}); `
			+ "set dafeiyu.memory.mode='isolated' to bind a non-default port, or clear rpcPort",
		);
	}
	return resolved;
}
