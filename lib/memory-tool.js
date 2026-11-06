/**
 * The single `memory` tool.
 *
 * One tool, one `op` discriminator: the model learns one entry point and the
 * schema stays small. Every op delegates to the `rsrs` CLI — this plugin keeps
 * no memory store of its own.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { encoderStatus } from './granite.js';
import { hashQuery, performRecall, planRecall } from './recall.js';
import {
	ORDINARY_TIMEOUT_MS,
	TRAIN_TIMEOUT_MS,
	attachArgs,
	chainArgs,
	learnLexicalArgs,
	learnResetArgs,
	learnStatusArgs,
	learnTrainArgs,
	queryLogMarkArgs,
	rememberArgs,
	showArgs,
	statusArgs,
	updateArgs,
} from './rsrs.js';
import { deriveProject } from './scope.js';
import { MAX_BRIEF, clearBrief, clampBrief, readBrief, selfnoteFile, writeBrief } from './selfnote.js';

/** Operations exposed by the tool. */
export const OPS = ['recall', 'remember', 'show', 'chain', 'feedback', 'reflect', 'status', 'learn', 'mute', 'attach', 'update', 'selfnote'];
/** `learn` actions. */
export const LEARN_ACTIONS = ['status', 'train', 'reset', 'lexical-on', 'lexical-off'];
/** `mute` actions. */
export const MUTE_ACTIONS = ['mute', 'unmute', 'list'];
/** `selfnote` actions. */
export const SELFNOTE_ACTIONS = ['write', 'show', 'clear'];

/** Feedback debounce before a training run is queued. */
export const TRAIN_DEBOUNCE_MS = 5000;
/** Minimum spacing between automatic training runs. */
export const TRAIN_MIN_INTERVAL_MS = 10 * 60 * 1000;

function requireString(value, field) {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(`${field} is required and must be a non-empty string`);
	}
	return value.trim();
}

function requireIds(value, field) {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${field} is required and must be a non-empty array of ids`);
	}
	return value.map((id) => requireString(id, `${field}[]`));
}

/** RFC3339 timestamp `days` from now. */
function rfc3339(ms) {
	return new Date(ms).toISOString();
}

/** Short hypothesis title from its body. */
export function hypothesisTitle(content) {
	const text = String(content ?? '').replace(/\s+/g, ' ').trim();
	const head = text.length > 60 ? `${text.slice(0, 59)}…` : text;
	return `Hypothesis: ${head}`;
}

/**
 * Create the `memory` tool.
 *
 * @param {{
 *   config: object, rsrs: object, state: object, gate: object,
 *   probe: Function, logger?: object, now?: Function, timers?: object,
 * }} options
 */
export function createMemoryTool({ config, rsrs, state, gate, probe, logger, now = Date.now, timers } = {}) {
	const setTimer = timers?.setTimeout ?? setTimeout;
	const clearTimer = timers?.clearTimeout ?? clearTimeout;

	let debounceHandle;
	let lastTrainAt = 0;

	const warn = (message) => {
		try {
			logger?.warn?.(`dafeiyu: ${message}`);
		} catch {
			/* optional */
		}
		state.log?.(`warn ${message}`);
	};

	const env = async () => {
		try {
			return await probe();
		} catch (error) {
			return { learnAvailable: false, bgeAvailable: false, warning: error?.message };
		}
	};

	/**
	 * Project for one call: an explicit `args.project` always wins; otherwise
	 * `dafeiyu.scope.mode` decides — `legacy` (default) keeps the historical
	 * `config.project` behaviour byte-identical, the other modes derive a
	 * hashed `dsh:...` scope from the calling agent's session id (`exec.agent`,
	 * set by the agent loop; absent in bare test calls, which then fall back).
	 */
	const scopedProject = (args, exec) => {
		if (typeof args?.project === 'string' && args.project.trim() !== '') return args.project.trim();
		return deriveProject({
			mode: config.scope?.mode,
			agentId: String(exec?.agent?.id ?? exec?.agent?.sessionId ?? ''),
			fallbackProject: config.project,
		});
	};

	/** Run a training pass; only counts/status are kept. */
	const trainNow = async () => {
		const { envelope } = await rsrs.run(
			learnTrainArgs({ limit: config.jobs.dailyLimit, epochs: 1 }),
			{ timeoutMs: TRAIN_TIMEOUT_MS },
		);
		lastTrainAt = now();
		const counts = {};
		for (const [key, value] of Object.entries(envelope?.summary ?? {})) {
			if (typeof value === 'number' || typeof value === 'boolean') counts[key] = value;
		}
		state.writeJobs({ lastFeedbackTrain: { at: lastTrainAt, status: 'ok', counts } });
		return { status: 'ok', counts };
	};

	/**
	 * Queue a debounced training run.
	 * @returns {'queued'|'skipped'}
	 */
	const queueTrain = async () => {
		const environment = await env();
		if (!environment.learnAvailable) return 'skipped';
		if (!config.jobs.enabled) return 'skipped';
		if (now() - lastTrainAt < TRAIN_MIN_INTERVAL_MS) return 'skipped';
		if (debounceHandle) return 'queued';
		debounceHandle = setTimer(() => {
			debounceHandle = undefined;
			trainNow().catch((error) => warn(`feedback train failed: ${error?.message ?? error}`));
		}, TRAIN_DEBOUNCE_MS);
		debounceHandle.unref?.();
		return 'queued';
	};

	const ops = {
		async recall(args, exec) {
			const query = requireString(args.query, 'query');
			const environment = await env();
			const limit = args.limit === undefined ? config.recallLimit : Math.max(1, Math.trunc(args.limit));
			const result = await performRecall({
				rsrs,
				query,
				limit,
				titles: true,
				brief: args.brief === true,
				type: args.type,
				intent: args.intent,
				project: scopedProject(args, exec),
				retrieval: config.retrieval,
				learnAvailable: environment.learnAvailable,
				bgeAvailable: environment.bgeAvailable,
				lexicalFlag: args.lexical === true,
				timeoutMs: config.recallTimeoutMs,
			});
			state.recordPending({
				requestId: result.requestId,
				ids: result.ids,
				fullIds: result.fullIds,
				idMap: result.idMap,
				queryHash: hashQuery(query),
				ts: now(),
			});
			return {
				...result.envelope,
				query_log_id: result.requestId,
				lexical: result.useLexical,
				ids: result.ids,
			};
		},

		async remember(args, exec) {
			const content = requireString(args.content, 'content');
			const options = {
				title: args.title,
				importance: args.importance,
				type: args.type,
				parent: args.parent,
				tags: args.tags,
				project: scopedProject(args, exec),
				sourceRefs: args.source_refs,
				validUntil: args.valid_until,
				reviewAt: args.review_at,
				supersedes: args.supersedes,
				seeAlso: args.see_also,
				force: args.force === true,
			};
			const { envelope } = await rsrs.run(rememberArgs(content, options), { timeoutMs: ORDINARY_TIMEOUT_MS });
			return envelope;
		},

		async show(args) {
			const { envelope } = await rsrs.run(showArgs(requireString(args.id, 'id')), { timeoutMs: ORDINARY_TIMEOUT_MS });
			return envelope;
		},

		/** Explicit causal attach: `rsrs attach <id> --parent <parent>`. */
		async attach(args) {
			const id = requireString(args.id, 'id');
			const parent = requireString(args.parent, 'parent');
			const { envelope } = await rsrs.run(attachArgs(id, parent), { timeoutMs: ORDINARY_TIMEOUT_MS });
			return envelope;
		},

		/**
		 * Update one record in place: omitted fields stay unchanged.
		 * `source_refs` / `valid_until` / `review_at` ride along; `supersedes`
		 * is rejected loudly because the CLI's `update` has no such flag.
		 */
		async update(args) {
			const id = requireString(args.id, 'id');
			const touched = ['content', 'title', 'importance', 'tags', 'type', 'summary', 'source_refs', 'valid_until', 'review_at'];
			if (!touched.some((key) => args[key] !== undefined && args[key] !== null && args[key] !== '')) {
				throw new Error(`update requires at least one field to change (${touched.join(', ')})`);
			}
			const options = {
				content: args.content,
				title: args.title,
				importance: args.importance,
				tags: args.tags,
				type: args.type,
				summary: args.summary,
				sourceRefs: args.source_refs,
				validUntil: args.valid_until,
				reviewAt: args.review_at,
				supersedes: args.supersedes,
			};
			const { envelope } = await rsrs.run(updateArgs(id, options), { timeoutMs: ORDINARY_TIMEOUT_MS });
			return envelope;
		},

		async chain(args) {
			const depth = args.depth === undefined ? 3 : Math.max(1, Math.trunc(args.depth));
			const { envelope } = await rsrs.run(chainArgs(requireString(args.id, 'id'), depth), { timeoutMs: ORDINARY_TIMEOUT_MS });
			return envelope;
		},

		async feedback(args) {
			const ids = requireIds(args.ids, 'ids');
			const verdict = args.verdict === 'bad' ? 'bad' : args.verdict === 'good' ? 'good' : undefined;
			if (!verdict) throw new Error('verdict is required and must be "good" or "bad"');

			const pending = state.findPending({ requestId: args.query_log_id, ids });
			const queryLogId = args.query_log_id ?? pending?.requestId;
			if (!queryLogId && args.source && args.source !== 'model') {
				throw new Error('feedback with source human/task_outcome requires a query_log_id; run recall first');
			}
			// With an explicit query_log_id the CLI requires complete candidate
			// UUIDs, not the 8-character display ids from `--titles`. Resolve
			// through the pending recall's short -> full map.
			const idMap = pending?.idMap && typeof pending.idMap === 'object' ? pending.idMap : {};
			const resolved = ids.map((id) => idMap[String(id).slice(0, 8)] ?? id);
			if (queryLogId && resolved.some((id) => String(id).length < 32)) {
				throw new Error('feedback with query_log_id needs full memory ids; run recall again and use its ids');
			}
			const { envelope } = await rsrs.run(
				queryLogMarkArgs(resolved, verdict, { queryLogId, source: args.source }),
				{ timeoutMs: ORDINARY_TIMEOUT_MS },
			);
			const train = await queueTrain();
			return { marked: true, train, result: envelope };
		},

		async reflect(args, exec) {
			const content = requireString(args.content, 'content');
			if (!Array.isArray(args.source_refs) || args.source_refs.length === 0) {
				throw new Error('reflect requires a non-empty source_refs array');
			}
			const stamp = now();
			const ttlDays = config.proactive.reflectionTtlDays;
			const options = {
				title: args.title ?? hypothesisTitle(content),
				type: args.type ?? 'hypothesis',
				importance: args.importance ?? 'important',
				parent: args.parent,
				tags: args.tags,
				project: scopedProject(args, exec),
				sourceRefs: args.source_refs,
				validUntil: args.valid_until ?? rfc3339(stamp + ttlDays * 86400000),
				reviewAt: args.review_at ?? rfc3339(stamp + Math.min(3, ttlDays) * 86400000),
				seeAlso: args.see_also,
				force: args.force === true,
			};
			const { envelope } = await rsrs.run(rememberArgs(content, options), { timeoutMs: ORDINARY_TIMEOUT_MS });
			return envelope;
		},

		async status() {
			const data = {
				plugin: {
					enabled: config.enabled,
					autoRecall: config.autoRecall,
					retrieval: config.retrieval,
					host: config.host,
					stateDir: config.stateDir,
					proactive: config.proactive.enabled,
					jobs: config.jobs.enabled,
					memoryMode: config.memory?.mode ?? 'main',
					scopeMode: config.scope?.mode ?? 'legacy',
				},
				bin: { path: rsrs.bin, source: rsrs.source },
				sections: {},
			};

			try {
				const { envelope } = await rsrs.run(statusArgs(), { timeoutMs: ORDINARY_TIMEOUT_MS, allowFailure: true });
				data.sections.rsrs = envelope?.status === 'ok'
					? { ok: true, summary: envelope.summary }
					: { ok: false, error: 'rsrs status reported a failure' };
			} catch (error) {
				data.sections.rsrs = { ok: false, error: error?.message ?? String(error) };
			}

			const environment = await env();
			data.mode = {
				learnAvailable: environment.learnAvailable,
				bgeAvailable: environment.bgeAvailable,
				lexical: planRecall({
					retrieval: config.retrieval,
					learnAvailable: environment.learnAvailable,
					bgeAvailable: environment.bgeAvailable,
				}).useLexical,
				...(environment.warning ? { warning: environment.warning } : {}),
			};

			if (environment.learnAvailable) {
				try {
					const { envelope } = await rsrs.run(learnStatusArgs(), { timeoutMs: ORDINARY_TIMEOUT_MS, allowFailure: true });
					data.sections.learn = envelope?.status === 'ok'
						? { ok: true, summary: envelope.summary }
						: { ok: false, error: 'learn status reported a failure' };
				} catch (error) {
					data.sections.learn = { ok: false, error: error?.message ?? String(error) };
				}
			} else {
				data.sections.learn = {
					ok: false,
					unsupported: true,
					error: `self-learning build not available (${environment.warning ?? 'learn --help failed'})`,
				};
			}

			try {
				data.sections.encoder = encoderStatus({
					graniteModelDir: config.jobs.graniteModelDir,
					respireRepo: config.jobs.respireRepo,
				});
			} catch (error) {
				data.sections.encoder = { ok: false, error: error?.message ?? String(error) };
			}

			try {
				const jobs = state.readJobs();
				data.sections.jobs = { ok: true, lastDaily: jobs.daily ?? null, lastWeekly: jobs.weekly ?? null };
			} catch (error) {
				data.sections.jobs = { ok: false, error: error?.message ?? String(error) };
			}

			try {
				data.counts = {
					pendingRecalls: state.readPending().length,
					mutes: gate.list().length,
				};
			} catch (error) {
				data.counts = { error: error?.message ?? String(error) };
			}

			return data;
		},

		async learn(args) {
			const action = args.action ?? 'status';
			const environment = await env();
			if (!environment.learnAvailable) {
				const detected = environment.bin ?? rsrs.bin ?? 'unknown';
				return {
					unsupported: true,
					action,
					bin: detected,
					reason: `the detected rsrs binary (${detected}) does not support \`learn\`; a self-learning build is required: ${environment.warning ?? 'learn --help failed'}`,
				};
			}
			switch (action) {
				case 'status': {
					const { envelope } = await rsrs.run(learnStatusArgs(), { timeoutMs: ORDINARY_TIMEOUT_MS });
					return envelope;
				}
				case 'train': {
					const limit = args.limit === undefined ? config.jobs.dailyLimit : Math.max(1, Math.trunc(args.limit));
					const epochs = args.epochs === undefined ? 1 : Math.max(1, Math.trunc(args.epochs));
					const { envelope } = await rsrs.run(learnTrainArgs({ limit, epochs }), { timeoutMs: TRAIN_TIMEOUT_MS });
					lastTrainAt = now();
					return envelope;
				}
				case 'reset': {
					const { envelope } = await rsrs.run(learnResetArgs(), { timeoutMs: ORDINARY_TIMEOUT_MS });
					return envelope;
				}
				case 'lexical-on': {
					const { envelope } = await rsrs.run(learnLexicalArgs(true), { timeoutMs: ORDINARY_TIMEOUT_MS });
					return envelope;
				}
				case 'lexical-off': {
					const { envelope } = await rsrs.run(learnLexicalArgs(false), { timeoutMs: ORDINARY_TIMEOUT_MS });
					return envelope;
				}
				default:
					throw new Error(`unknown learn action: ${action}`);
			}
		},

		async mute(args) {
			const action = args.action ?? 'list';
			const durationHours = args.duration_hours === undefined
				? 720
				: Math.max(1, Math.trunc(args.duration_hours));
			if (action === 'mute') {
				if (typeof args.topic === 'string' && args.topic.trim() !== '') {
					const record = gate.muteTopic(args.topic, durationHours);
					return { muted: true, ...record, until: rfc3339(record.untilMs) };
				}
				if (typeof args.id === 'string' && args.id.trim() !== '') {
					const record = gate.muteId(args.id, durationHours);
					return { muted: true, ...record, until: rfc3339(record.untilMs) };
				}
				throw new Error('mute requires a topic or an id');
			}
			if (action === 'unmute') {
				const target = args.topic ?? args.id;
				if (typeof target !== 'string' || target.trim() === '') throw new Error('unmute requires a topic or an id');
				return gate.unmute(target);
			}
			if (action === 'list') return { entries: gate.list() };
			throw new Error(`unknown mute action: ${action}`);
		},

		/**
		 * Managed persona self-note: the brief injected as the
		 * `dafeiyu:selfnote` system-prompt section (re-read on every prompt
		 * assembly, so a write lands on the next step without a restart).
		 */
		async selfnote(args) {
			const action = args.action ?? 'show';
			const file = selfnoteFile(config.stateDir);
			if (action === 'show') {
				const brief = readBrief(file);
				return { action, brief, chars: brief.length, max_chars: MAX_BRIEF };
			}
			if (action === 'write') {
				const brief = requireString(args.note, 'note');
				writeBrief(file, brief);
				const stored = readBrief(file);
				return {
					action,
					brief: stored,
					chars: stored.length,
					max_chars: MAX_BRIEF,
					// True when the input was longer than the 300-char cap.
					clamped: clampBrief(brief) !== brief,
				};
			}
			if (action === 'clear') {
				clearBrief(file);
				return { action, cleared: true, brief: '', chars: 0 };
			}
			throw new Error(`unknown selfnote action: ${action}`);
		},
	};

	const parameters = {
		op: {
			type: 'string',
			required: true,
			enum: OPS,
			description: 'Operation to perform.',
		},
		query: { type: 'string', description: 'recall: search query.' },
		content: { type: 'string', description: 'remember/reflect: body text.' },
		id: { type: 'string', description: 'show/chain/attach/update: memory id (8-64 hex).' },
		ids: { type: 'array', items: { type: 'string' }, description: 'feedback: memory ids to label.' },
		verdict: { type: 'string', enum: ['good', 'bad'], description: 'feedback: label direction.' },
		query_log_id: { type: 'string', description: 'feedback: explicit query-log request id.' },
		source: { type: 'string', enum: ['model', 'human', 'task_outcome'], description: 'feedback: label source.' },
		title: { type: 'string', description: 'remember/reflect: short event title.' },
		type: { type: 'string', description: 'Entry type, e.g. fact, hypothesis, decision (update: stored as kind).' },
		importance: { type: 'string', enum: ['important', 'trivial'], description: 'remember/reflect/update: importance.' },
		parent: { type: 'string', description: 'remember/reflect: causal parent id; attach: the parent to attach under.' },
		tags: { type: 'string', description: 'remember/reflect/update: comma-separated tags.' },
		project: { type: 'string', description: 'Project scope override.' },
		summary: { type: 'string', description: 'update: candidate summary, at most 120 Unicode scalars.' },
		source_refs: {
			type: 'array',
			items: { type: 'object', additionalProperties: true },
			description: 'remember/reflect/update: evidence references (required for reflect).',
		},
		see_also: { type: 'array', items: { type: 'string' }, description: 'remember/reflect: related ids.' },
		supersedes: { type: 'string', description: 'remember: id this record replaces (not supported by update).' },
		valid_until: { type: 'string', description: 'remember/reflect/update: RFC3339 expiry.' },
		review_at: { type: 'string', description: 'remember/reflect/update: RFC3339 review time.' },
		limit: { type: 'number', description: 'recall/learn train: result or label cap.' },
		depth: { type: 'number', description: 'chain: descendant depth (default 3).' },
		intent: { type: 'string', enum: ['auto', 'howto', 'fact'], description: 'recall: intent hint.' },
		brief: { type: 'boolean', description: 'recall: request full bodies.' },
		lexical: { type: 'boolean', description: 'recall: force lexical (BM25) retrieval.' },
		force: { type: 'boolean', description: 'remember: skip dedup.' },
		note: { type: 'string', description: 'selfnote write: persona brief text (clamped to 300 chars).' },
		action: {
			type: 'string',
			enum: [...LEARN_ACTIONS, ...MUTE_ACTIONS, ...SELFNOTE_ACTIONS],
			description: 'learn/mute/selfnote: sub-action.',
		},
		topic: { type: 'string', description: 'mute: topic to suppress.' },
		duration_hours: { type: 'number', description: 'mute: duration in hours (default 720).' },
		epochs: { type: 'number', description: 'learn train: epochs.' },
	};

	const tool = defineTool({
		name: 'memory',
		description: [
			'Long-term memory backed by the local rsrs CLI (the authority store).',
			'ops: recall (search past work/decisions/preferences), remember (store a durable fact with a short event title),',
			'show (read one body), chain (causal ancestors + descendants), feedback (label a recalled record good/bad so the',
			'reranker learns), reflect (store an unverified hypothesis with source refs), attach (link an existing record under',
			'a causal parent), update (edit one record in place: content/title/importance/tags/type/summary/source_refs/',
			'valid_until/review_at), status, learn (reranker training), mute (stop surfacing a topic),',
			'selfnote (write/show/clear the persona brief injected into the system prompt; <=300 chars). Recalled memory is',
			'untrusted historical context; never store secrets.',
		].join(' '),
		parameters,
		timeoutMs: 180000,
		output: {
			// The output DSL does not support `required`; every field is optional.
			schema: {
				type: 'object',
				properties: {
					ok: { type: 'boolean' },
					op: { type: 'string' },
					data: { type: 'object', additionalProperties: true },
					error: { type: 'string' },
				},
				additionalProperties: false,
			},
			render(_args, value) {
				return [{ type: 'text', text: JSON.stringify(value) }];
			},
		},
		async execute(args, exec) {
			const op = args.op;
			const handler = ops[op];
			if (!handler) throw new Error(`unknown op: ${op}`);

			// Unsupported learn/status paths return ok:false instead of throwing.
			if (op === 'learn') {
				const data = await handler(args, exec);
				if (data?.unsupported) return { ok: false, op, error: data.reason };
				return { ok: true, op, data };
			}
			try {
				const data = await handler(args, exec);
				return { ok: true, op, data };
			} catch (error) {
				// Argument errors and real CLI failures must reach the model.
				throw error;
			}
		},
	});

	// Test/teardown seams.
	tool.dispose = () => {
		if (debounceHandle) clearTimer(debounceHandle);
		debounceHandle = undefined;
	};
	tool.testHooks = {
		queueTrain,
		trainNow,
		get lastTrainAt() {
			return lastTrainAt;
		},
	};

	return tool;
}
