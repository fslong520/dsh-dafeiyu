/**
 * rsrs (respire CLI) adapter: binary discovery, self-learning feature probe,
 * argument builders and a JSON spawn wrapper.
 *
 * Every command is spawned with an argument array. Nothing here ever builds a
 * shell string, so memory text can never reach a shell parser.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { expandPath } from './config.js';

/** Recall must never delay a turn: hard 2.5 s default. */
export const RECALL_TIMEOUT_MS = 2500;
/** Ordinary read/write commands. */
export const ORDINARY_TIMEOUT_MS = 15000;
/** `learn train --from-labels`. */
export const TRAIN_TIMEOUT_MS = 120000;
/** Weekly Granite encoder pipeline. */
export const ENCODER_TIMEOUT_MS = 2 * 60 * 60 * 1000;
/** `audit --json` (read-only). */
export const AUDIT_TIMEOUT_MS = 120000;
/** `review --due --json` (read-only). */
export const REVIEW_TIMEOUT_MS = 60000;
/** stderr is truncated to this many characters before it reaches a log or model. */
export const STDERR_LIMIT = 2000;
/** Memory ids are 8-64 hex characters, optionally a hyphenated UUID; anything else is never passed to the CLI. */
export const ID_RE = /^(?:[0-9a-f]{8,64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Detection results are cached for this long. */
const DETECT_TTL_MS = 5 * 60 * 1000;

/** Failure raised when the CLI cannot be run or returns an unusable envelope. */
export class RsrsError extends Error {
	constructor(message, details = {}) {
		super(message);
		this.name = 'RsrsError';
		this.code = details.code ?? 'RSRS_ERROR';
		this.bin = details.bin;
		this.args = details.args;
		this.exitCode = details.exitCode;
		this.stderr = details.stderr;
	}
}

/** True when `id` is a plausible memory id. */
export function isValidId(id) {
	return typeof id === 'string' && ID_RE.test(id.trim());
}

/** Validate an id or throw a model-visible error. */
export function assertId(id, label = 'id') {
	if (!isValidId(id)) {
		throw new RsrsError(`invalid ${label}: expected 8-64 hex characters`, { code: 'INVALID_ID' });
	}
	return id.trim();
}

/** First 8 characters of an id, used in injected framing. */
export function shortId(id) {
	const text = String(id ?? '').trim();
	return text.slice(0, 8);
}

/** Truncate a captured stream for safe logging. */
export function truncate(text, limit = STDERR_LIMIT) {
	const value = typeof text === 'string' ? text : '';
	return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

/** True when the path is an executable regular file. */
export function isExecutable(file) {
	try {
		if (!statSync(file).isFile()) return false;
		accessSync(file, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/** Resolve `name` through PATH without spawning a shell. */
export function findOnPath(name, env = process.env) {
	const dirs = String(env.PATH ?? '').split(path.delimiter).filter(Boolean);
	for (const dir of dirs) {
		const candidate = path.join(dir, name);
		if (isExecutable(candidate)) return candidate;
	}
	return undefined;
}

/**
 * Resolve the CLI in the documented order:
 * config.rsrsBin > $RSRS_BIN > ~/.local/bin/rsrs-dafeiyu (managed self-learning
 * build; survives npm shim rewrites) > ~/.rsrs/bin/rsrs > `rsrs` on PATH.
 *
 * @returns {{bin: string|undefined, source: string}} source is a stable label.
 */
export function discoverBinary({ config = {}, env = process.env, home, check = isExecutable } = {}) {
	const homeDir = home ?? env.HOME ?? homedir();
	const configured = expandPath(config.rsrsBin ?? '', { ...env, HOME: homeDir });
	if (configured !== '' && check(configured)) return { bin: configured, source: 'config' };
	if (configured !== '') return { bin: configured, source: 'config-unverified' };

	const fromEnv = expandPath(env.RSRS_BIN ?? '', { ...env, HOME: homeDir });
	if (fromEnv !== '' && check(fromEnv)) return { bin: fromEnv, source: 'env' };

	// Managed copy: the npm `rsrs` shim re-materializes ~/.rsrs/bin/rsrs and
	// would otherwise silently revert a self-learning build.
	const managed = path.join(homeDir, '.local', 'bin', 'rsrs-dafeiyu');
	if (check(managed)) return { bin: managed, source: 'managed' };

	const conventional = path.join(homeDir, '.rsrs', 'bin', 'rsrs');
	if (check(conventional)) return { bin: conventional, source: 'home' };

	const onPath = findOnPath('rsrs', env);
	if (onPath !== undefined) return { bin: onPath, source: 'path' };
	return { bin: 'rsrs', source: 'unresolved' };
}

/* ------------------------------------------------------------------ */
/* Argument builders                                                   */
/* ------------------------------------------------------------------ */

/** `status --json` */
export function statusArgs() {
	return ['status', '--json'];
}

/** `learn status --json` */
export function learnStatusArgs() {
	return ['learn', 'status', '--json'];
}

/** `learn --help` — the self-learning feature probe. */
export function learnProbeArgs() {
	return ['learn', '--help'];
}

/** `learn train --from-labels --json --limit N --epochs N` */
export function learnTrainArgs({ limit = 5000, epochs = 1 } = {}) {
	return ['learn', 'train', '--from-labels', '--json', '--limit', String(limit), '--epochs', String(epochs)];
}

/** `learn reset --json` */
export function learnResetArgs() {
	return ['learn', 'reset', '--json'];
}

/** `learn lexical --json` / `learn lexical --off --json` */
export function learnLexicalArgs(enabled = true) {
	return enabled ? ['learn', 'lexical', '--json'] : ['learn', 'lexical', '--off', '--json'];
}

/**
 * `recall <query> --json [--titles] [--brief] [--limit N] [--project P]
 *  [--intent I] [--type T] [--lexical]`
 */
export function recallArgs(query, options = {}) {
	const args = ['recall', String(query ?? ''), '--json'];
	if (options.titles) args.push('--titles');
	if (options.brief) args.push('--brief');
	if (options.limit !== undefined) args.push('--limit', String(options.limit));
	if (options.project) args.push('--project', String(options.project));
	if (options.intent) args.push('--intent', String(options.intent));
	if (options.type) args.push('--type', String(options.type));
	if (options.lexical) args.push('--lexical');
	return args;
}

/**
 * `remember <content> --json [--title T] [--importance I] [--type T]
 *  [--parent ID] [--tags T] [--project P] [--source-refs JSON]
 *  [--valid-until RFC3339] [--review-at RFC3339] [--supersedes ID]
 *  [--see-also IDS] [--force] [--merge-ids IDS]`
 */
export function rememberArgs(content, options = {}) {
	const args = ['remember', String(content ?? ''), '--json'];
	if (options.title) args.push('--title', String(options.title));
	if (options.importance) args.push('--importance', String(options.importance));
	if (options.type) args.push('--type', String(options.type));
	if (options.parent) args.push('--parent', assertId(options.parent, 'parent'));
	if (options.tags) args.push('--tags', String(options.tags));
	if (options.project) args.push('--project', String(options.project));
	if (options.sourceRefs !== undefined) args.push('--source-refs', JSON.stringify(options.sourceRefs));
	if (options.validUntil) args.push('--valid-until', String(options.validUntil));
	if (options.reviewAt) args.push('--review-at', String(options.reviewAt));
	if (options.supersedes) args.push('--supersedes', assertId(options.supersedes, 'supersedes'));
	if (options.seeAlso !== undefined) {
		const ids = Array.isArray(options.seeAlso) ? options.seeAlso : String(options.seeAlso).split(',');
		args.push('--see-also', ids.map((id) => assertId(id, 'see_also')).join(','));
	}
	if (options.force) args.push('--force');
	if (options.mergeIds !== undefined) {
		const ids = Array.isArray(options.mergeIds) ? options.mergeIds : String(options.mergeIds).split(',');
		args.push('--merge-ids', ids.map((id) => assertId(id, 'merge_ids')).join(','));
	}
	return args;
}

/** `show <id> --json` */
export function showArgs(id) {
	return ['show', assertId(id), '--json'];
}

/**
 * `attach <id> --parent <parent> --json` — explicit causal attach.
 */
export function attachArgs(id, parent) {
	return ['attach', assertId(id, 'id'), '--parent', assertId(parent, 'parent'), '--json'];
}

/**
 * `update <id> --json [--content C] [--title T] [--importance I] [--tags T]
 *  [--kind K] [--summary S] [--source-refs JSON] [--valid-until R]
 *  [--review-at R]` — omitted fields stay unchanged.
 *
 * The CLI's `update` surface has no `--supersedes`; callers passing one get an
 * explicit error instead of a silent drop.
 */
export function updateArgs(id, options = {}) {
	if (options.supersedes !== undefined && options.supersedes !== null && options.supersedes !== '') {
		throw new RsrsError('update does not support supersedes; use remember with --supersedes', {
			code: 'INVALID_ARGS',
		});
	}
	const args = ['update', assertId(id, 'id'), '--json'];
	if (options.content !== undefined && options.content !== null && options.content !== '') {
		args.push('--content', String(options.content));
	}
	if (options.title !== undefined && options.title !== null && options.title !== '') {
		args.push('--title', String(options.title));
	}
	if (options.importance) args.push('--importance', String(options.importance));
	if (options.tags !== undefined && options.tags !== null) args.push('--tags', String(options.tags));
	if (options.type) args.push('--kind', String(options.type));
	if (options.summary !== undefined && options.summary !== null && options.summary !== '') {
		args.push('--summary', String(options.summary));
	}
	if (options.sourceRefs !== undefined) args.push('--source-refs', JSON.stringify(options.sourceRefs));
	if (options.validUntil) args.push('--valid-until', String(options.validUntil));
	if (options.reviewAt) args.push('--review-at', String(options.reviewAt));
	return args;
}

/** `audit --json` — read-only store audit; never mutates a memory. */
export function auditArgs() {
	return ['audit', '--json'];
}

/**
 * `review --due --json --limit N` — read-only due-review listing with the
 * limit clamped to 1-100.
 */
export function reviewDueArgs(limit = 20) {
	let value = Number.parseInt(limit, 10);
	if (!Number.isFinite(value)) value = 20;
	value = Math.max(1, Math.min(100, value));
	return ['review', '--due', '--json', '--limit', String(value)];
}

/** `chain <id> --depth N --json` */
export function chainArgs(id, depth = 3) {
	return ['chain', assertId(id), '--depth', String(depth), '--json'];
}

/** `query-log --limit N --json` */
export function queryLogArgs(limit = 20) {
	return ['query-log', '--limit', String(limit), '--json'];
}

/**
 * `query-log mark <ids> --good|--bad --json [--query-log-id UUID] [--source S]`
 */
export function queryLogMarkArgs(ids, verdict, options = {}) {
	const list = Array.isArray(ids) ? ids : [ids];
	if (list.length === 0) throw new RsrsError('feedback requires at least one id', { code: 'INVALID_ARGS' });
	// `query-log mark` has no --json flag of its own; the parent query-log
	// command must see it BEFORE the mark subcommand.
	const args = ['query-log', '--json', 'mark', list.map((id) => assertId(id)).join(','), verdict === 'bad' ? '--bad' : '--good'];
	if (options.queryLogId) args.push('--query-log-id', String(options.queryLogId));
	if (options.source) args.push('--source', String(options.source));
	return args;
}

/* ------------------------------------------------------------------ */
/* Spawn wrapper                                                       */
/* ------------------------------------------------------------------ */

/**
 * Spawn the CLI with an argument array and capture output.
 * The child is killed on timeout or abort. Never rejects for a nonzero exit;
 * the caller inspects `code`.
 *
 * @returns {Promise<{code: number|null, signal: string|null, stdout: string, stderr: string, timedOut: boolean}>}
 */
export function runProcess({
	bin,
	args,
	env,
	cwd,
	timeoutMs = ORDINARY_TIMEOUT_MS,
	signal,
	spawnImpl = nodeSpawn,
} = {}) {
	return new Promise((resolve, reject) => {
		let child;
		try {
			child = spawnImpl(bin, args, {
				env: env ?? process.env,
				cwd,
				stdio: ['ignore', 'pipe', 'pipe'],
				windowsHide: true,
			});
		} catch (error) {
			reject(new RsrsError(`failed to spawn ${bin}: ${error.message}`, { code: 'SPAWN_FAILED', bin, args }));
			return;
		}

		let stdout = '';
		let stderr = '';
		let timedOut = false;
		let settled = false;

		const kill = () => {
			try {
				child.kill('SIGKILL');
			} catch {
				/* already gone */
			}
		};

		const timer = setTimeout(() => {
			timedOut = true;
			kill();
		}, timeoutMs);
		timer.unref?.();

		const onAbort = () => {
			timedOut = false;
			kill();
		};
		if (signal) {
			if (signal.aborted) onAbort();
			else signal.addEventListener('abort', onAbort, { once: true });
		}

		const cleanup = () => {
			clearTimeout(timer);
			signal?.removeEventListener?.('abort', onAbort);
		};

		child.stdout?.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr?.on('data', (chunk) => {
			stderr += chunk;
		});

		child.on('error', (error) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(new RsrsError(`failed to spawn ${bin}: ${error.message}`, { code: 'SPAWN_FAILED', bin, args }));
		});

		child.on('close', (code, closeSignal) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (timedOut) {
				reject(new RsrsError(`rsrs timed out after ${timeoutMs} ms`, {
					code: 'TIMEOUT',
					bin,
					args,
					stderr: truncate(stderr),
				}));
				return;
			}
			resolve({
				code,
				signal: closeSignal,
				stdout,
				stderr,
				timedOut,
			});
		});
	});
}

/** Parse a stdout buffer into the canonical rsrs envelope. */
export function parseEnvelope(stdout, { bin, args } = {}) {
	const text = String(stdout ?? '').trim();
	if (text === '') throw new RsrsError('rsrs returned no output', { code: 'EMPTY_OUTPUT', bin, args });
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new RsrsError(`rsrs returned invalid JSON: ${error.message}`, {
			code: 'INVALID_JSON',
			bin,
			args,
			stderr: truncate(text),
		});
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new RsrsError('rsrs returned a non-object envelope', { code: 'INVALID_ENVELOPE', bin, args });
	}
	return parsed;
}

/** Extract a human-readable message from an envelope's `errors` array. */
function envelopeError(envelope) {
	const errors = Array.isArray(envelope?.errors) ? envelope.errors : [];
	const messages = errors
		.map((entry) => (typeof entry === 'string' ? entry : entry?.message ?? entry?.reason ?? JSON.stringify(entry)))
		.filter(Boolean);
	if (messages.length > 0) return messages.join('; ');
	return typeof envelope?.summary?.reason === 'string' ? envelope.summary.reason : '';
}

/**
 * Create the cached CLI handle used by the plugin.
 *
 * @param {{config: object, env?: object, spawnImpl?: Function, now?: () => number, home?: string}} options
 */
export function createRsrs({ config, env = process.env, spawnImpl = nodeSpawn, now = Date.now, home } = {}) {
	// Local fail-fast tripwire (same rule as validateMemoryConfig): a data dir
	// without its own port would share the default singleton and write the
	// main store silently.
	if (config.dataDir && !config.rpcPort) {
		throw new RsrsError(
			`refusing to start: dataDir=${config.dataDir} without rpcPort would silently write the main store`,
			{ code: 'MEMORY_CONFIG_INVALID' },
		);
	}
	const childEnv = { ...env };
	// Pass the data dir and its dedicated port through the child env instead of
	// flags. main mode leaves both unset so the CLI falls back to ~/.rsrs.
	if (config.dataDir) childEnv.RSRS_DATA_DIR = config.dataDir;
	if (config.rpcPort) childEnv.RSRS_RPC_PORT = String(config.rpcPort);

	/** @type {{at: number, bin?: string, source?: string, learnAvailable: boolean, learnProbe?: string} | undefined} */
	let cache;

	const resolve = (force = false) => {
		const stamp = now();
		if (!force && cache && stamp - cache.at < DETECT_TTL_MS) return cache;
		const { bin, source } = discoverBinary({ config, env, home });
		cache = { at: stamp, bin, source, learnAvailable: false };
		return cache;
	};

	/** Probe `learn --help`; only the self-learning build accepts it. */
	const probeLearn = async () => {
		const current = resolve();
		if (cache && cache.learnProbedAt !== undefined && now() - cache.learnProbedAt < DETECT_TTL_MS) {
			return { learnAvailable: cache.learnAvailable, bin: current.bin, source: current.source, reason: cache.learnProbe };
		}
		if (!current.bin) {
			return { learnAvailable: false, bin: undefined, source: current.source, reason: 'no rsrs binary found' };
		}
		try {
			const result = await runProcess({
				bin: current.bin,
				args: learnProbeArgs(),
				env: childEnv,
				timeoutMs: ORDINARY_TIMEOUT_MS,
				spawnImpl,
			});
			const ok = result.code === 0;
			cache.learnAvailable = ok;
			cache.learnProbedAt = now();
			cache.learnProbe = ok ? undefined : truncate(result.stderr || 'learn --help failed');
			return { learnAvailable: ok, bin: current.bin, source: current.source, reason: cache.learnProbe };
		} catch (error) {
			cache.learnAvailable = false;
			cache.learnProbedAt = now();
			cache.learnProbe = truncate(error?.stderr || error?.message || 'probe failed');
			return { learnAvailable: false, bin: current.bin, source: current.source, reason: cache.learnProbe };
		}
	};

	/**
	 * Run one command and return `{envelope, stdout, stderr}`.
	 * Throws RsrsError on spawn failure, timeout, nonzero exit or bad JSON.
	 */
	const run = async (args, { timeoutMs = ORDINARY_TIMEOUT_MS, signal, allowFailure = false } = {}) => {
		const current = resolve();
		if (!current.bin || current.source === 'unresolved') {
			throw new RsrsError('rsrs binary not found (set rsrsBin, RSRS_BIN, or install ~/.local/bin/rsrs-dafeiyu)', {
				code: 'BINARY_NOT_FOUND',
				args,
			});
		}
		const result = await runProcess({
			bin: current.bin,
			args,
			env: childEnv,
			timeoutMs,
			signal,
			spawnImpl,
		});
		let envelope;
		try {
			envelope = parseEnvelope(result.stdout, { bin: current.bin, args });
		} catch (error) {
			if (allowFailure) return { envelope: undefined, ...result, error };
			// A nonzero exit with no parsable envelope is a CLI failure, and its
			// stderr is more useful to the model than "no output".
			if (result.code !== 0) {
				throw new RsrsError(`rsrs ${args[0]} failed: ${truncate(result.stderr) || `exit ${result.code}`}`, {
					code: 'RSRS_FAILED',
					bin: current.bin,
					args,
					exitCode: result.code,
					stderr: truncate(result.stderr),
				});
			}
			throw error;
		}
		const failed = result.code !== 0 || (envelope.status && envelope.status !== 'ok');
		if (failed && !allowFailure) {
			const detail = envelopeError(envelope) || truncate(result.stderr) || `exit ${result.code}`;
			throw new RsrsError(`rsrs ${args[0]} failed: ${detail}`, {
				code: 'RSRS_FAILED',
				bin: current.bin,
				args,
				exitCode: result.code,
				stderr: truncate(result.stderr),
			});
		}
		return { envelope, ...result };
	};

	return {
		config,
		env: childEnv,
		spawnImpl,
		resolve,
		probeLearn,
		run,
		get bin() {
			return resolve().bin;
		},
		get source() {
			return resolve().source;
		},
		get learnAvailable() {
			return Boolean(cache?.learnAvailable);
		},
		/** Test seam: drop cached detection. */
		invalidate() {
			cache = undefined;
		},
	};
}
