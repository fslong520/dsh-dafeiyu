/**
 * Test helper: an in-memory stand-in for the createRsrs() handle.
 *
 * Records every call so tests can assert on the exact argument array (order and
 * flags) without spawning a process.
 */
import { RsrsError } from '../lib/rsrs.js';

/** Default envelopes per command. */
function defaultEnvelope(key) {
	switch (key) {
		case 'status':
			return {
				command: 'status',
				status: 'ok',
				summary: { data_dir: '/tmp/rsrs', local_total: 10, unlocked: true },
				items: [],
				actions: [],
				errors: [],
				details: null,
				related: [],
			};
		case 'learn':
			return { command: 'learn', status: 'ok', summary: { trained: 3 }, items: [], actions: [], errors: [], details: null, related: [] };
		case 'query-log:mark':
			return { command: 'query-log', status: 'ok', summary: { marked: 1 }, items: [], actions: [], errors: [], details: null, related: [] };
		case 'query-log':
			return { command: 'query-log', status: 'ok', summary: { count: 0 }, items: [], actions: [], errors: [], details: [], related: [] };
		case 'remember':
			return { command: 'remember', status: 'ok', summary: { id: 'aaaa1111' }, items: [], actions: [], errors: [], details: null, related: [] };
		case 'attach':
			return { command: 'attach', status: 'ok', summary: { id: 'aaaa1111', parent: 'bbbb2222' }, items: [], actions: [], errors: [], details: null, related: [] };
		case 'update':
			return { command: 'update', status: 'ok', summary: { id: 'aaaa1111' }, items: [], actions: [], errors: [], details: null, related: [] };
		case 'audit':
			return { command: 'audit', status: 'ok', summary: { status: 'ok', total_active: 12, orphans: 0 }, items: [], actions: [], errors: [], details: null, related: [] };
		case 'review':
			return { command: 'review', status: 'ok', summary: { status: 'ok', due: 2 }, items: [{ id: 'aaaa1111' }, { id: 'bbbb2222' }], actions: [], errors: [], details: null, related: [] };
		case 'show':
			return { command: 'show', status: 'ok', summary: { id: 'aaaa1111', title: 'T' }, items: [], actions: [], errors: [], details: {}, related: [] };
		case 'chain':
			return { command: 'chain', status: 'ok', summary: {}, items: [], actions: [], errors: [], details: {}, related: [] };
		case 'recall':
		default:
			return {
				command: 'recall',
				status: 'ok',
				summary: { count: 2, query_log_id: '11111111-2222-3333-4444-555555555555' },
				items: [
					{ name: '056f02cc', status: 'ok', value: '0.610 Deployed the dsh plugin' },
					{ name: 'af347325', status: 'ok', value: '0.480 Older note' },
				],
				actions: [],
				errors: [],
				details: [
					{ id: '056f02cc-488c-46ab-8b5c-da68ec124875', title: 'Deployed the dsh plugin', score: 0.61 },
					{ id: 'af347325-b808-4306-8d97-cff1c02da5ef', title: 'Older note', score: 0.48 },
				],
				related: [],
			};
	}
}

/** Command key for call recording. */
export function callKey(args) {
	if (args[0] === 'query-log' && (args[1] === 'mark' || (args[1] === '--json' && args[2] === 'mark'))) return 'query-log:mark';
	if (args[0] === 'query-log') return 'query-log';
	return args[0];
}

/**
 * @param {{learnAvailable?: boolean, envelopes?: object, failOn?: string[], bin?: string}} [options]
 */
export function createFakeRsrs({ learnAvailable = false, envelopes = {}, failOn = [], bin = '/fake/rsrs' } = {}) {
	/** @type {Array<{args: string[], options: object}>} */
	const calls = [];

	const run = async (args, options = {}) => {
		const key = callKey(args);
		calls.push({ args, options, key });
		if (failOn.includes(key)) {
			throw new RsrsError(`fake failure for ${key}`, { code: 'RSRS_FAILED', args, stderr: 'boom' });
		}
		const envelope = envelopes[key] ?? defaultEnvelope(key);
		return { envelope, code: 0, stdout: JSON.stringify(envelope), stderr: '', timedOut: false };
	};

	return {
		run,
		calls,
		bin,
		source: 'config',
		env: { RSRS_DATA_DIR: '/tmp/rsrs' },
		probeLearn: async () => ({ learnAvailable, bin, source: 'config', reason: learnAvailable ? undefined : 'learn --help failed' }),
		get learnAvailable() {
			return learnAvailable;
		},
		/** All recorded argument arrays for one command key. */
		argsFor(key) {
			return calls.filter((call) => call.key === key).map((call) => call.args);
		},
	};
}
