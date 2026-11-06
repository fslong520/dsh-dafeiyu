/**
 * Self-learning schedule.
 *
 * Daily: `rsrs learn train --from-labels` so the locally learned residual
 * reranker keeps improving from query-log labels.
 * Weekly (Sunday 02:00): the respire Granite encoder pipeline
 * (prepare -> train -> reembed -> gate -> swap), run as an external script.
 * Nightly (04:00, read-only): `rsrs audit --json` + `rsrs review --due --json`
 * — counters only, never a delete/update/forget (ported from
 * astrbot dafeiyu_jobs.py run_maintenance; the AstrBot side stays off, so only
 * one host owns the training schedule while both sides may run the read-only
 * pass).
 *
 * Timers are unref'd so they never hold the process open, and every job is
 * guarded by a lock plus a last-run record.
 */
import path from 'node:path';
import { encoderStatus } from './granite.js';
import {
	AUDIT_TIMEOUT_MS,
	ENCODER_TIMEOUT_MS,
	REVIEW_TIMEOUT_MS,
	TRAIN_TIMEOUT_MS,
	auditArgs,
	learnTrainArgs,
	reviewDueArgs,
	runProcess,
	truncate,
} from './rsrs.js';
import { appendLog } from './state.js';

/** Catch-up runs start within this window after load. */
export const CATCHUP_MS = 60 * 1000;
/** A daily run is due again after this long. */
export const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** The read-only maintenance pass runs at most once per this window. */
export const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Weekly encoder slot: Sunday 02:00 local time. */
export const WEEKLY_DAY = 0;
export const WEEKLY_HOUR = 2;

/**
 * Only these scalars from `audit` may ever reach `jobs.json`
 * (astrbot dafeiyu_jobs.py AUDIT_SCALARS — `details` can carry titles, so it
 * is never copied).
 */
export const AUDIT_SCALARS = Object.freeze([
	'status',
	'total_active',
	'orphans',
	'invalid_importance',
	'same_title_groups',
	'truncated_titles',
	'max_depth',
	'hot_untyped',
	'failing_skills',
	'skill_template_gaps',
	'hot_untyped_skipped',
	'skill_template_gaps_skipped',
]);
/** Summary keys that may carry memory text; never persisted. */
export const TEXT_KEYS = Object.freeze(
	new Set(['title', 'content', 'body', 'text', 'desc', 'description', 'snippet', 'preview', 'excerpt', 'titles']),
);

/** Milliseconds until the next local `hour:minute`. */
export function msUntilNext(hour, minute, nowMs = Date.now()) {
	const now = new Date(nowMs);
	const target = new Date(now.getTime());
	target.setHours(hour, minute, 0, 0);
	if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
	return target.getTime() - now.getTime();
}

/** Milliseconds until the next Sunday 02:00 local time. */
export function msUntilNextWeekly(nowMs = Date.now()) {
	const now = new Date(nowMs);
	const target = new Date(now.getTime());
	const deltaDays = (WEEKLY_DAY - target.getDay() + 7) % 7;
	target.setDate(target.getDate() + deltaDays);
	target.setHours(WEEKLY_HOUR, 0, 0, 0);
	if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 7);
	return target.getTime() - now.getTime();
}

/** Keep only numeric/count fields from a learn envelope — never memory text. */
export function summarizeLearn(envelope) {
	const summary = envelope?.summary;
	if (!summary || typeof summary !== 'object') return {};
	const out = {};
	for (const [key, value] of Object.entries(summary)) {
		if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
			if (typeof value === 'string' && value.length > 80) continue;
			out[key] = value;
		}
	}
	return out;
}

/** True for scalar values allowed in a persisted job record. */
function isScalar(value) {
	return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string';
}

/**
 * Whitelisted `audit` counters only (astrbot dafeiyu_jobs.py summarize_audit).
 * `details` (which carries hot-untyped ids and titles) is never copied, so the
 * record that lands in `jobs.json` cannot leak memory text. Counters live in
 * `summary`, the verdict (`ok`/`warn`) at the envelope top level — both read.
 */
export function summarizeAudit(envelope) {
	if (!envelope || typeof envelope !== 'object') return {};
	let source = envelope.summary;
	if (!source || typeof source !== 'object') source = envelope;
	const out = {};
	for (const key of AUDIT_SCALARS) {
		if (!(key in source)) continue;
		const value = source[key];
		if (isScalar(value)) out[key] = value;
		else if (typeof value === 'string' && value.length <= 40 && key === 'status') out[key] = value;
	}
	if (typeof out.status !== 'string') {
		const top = envelope.status;
		if (typeof top === 'string' && top.length <= 40) out.status = top;
	}
	return out;
}

/**
 * Scalar `review --due` summary fields plus item counts — never titles
 * (astrbot dafeiyu_jobs.py summarize_review).
 */
export function summarizeReview(envelope) {
	if (!envelope || typeof envelope !== 'object') return {};
	const out = {};
	const summary = envelope.summary;
	if (summary && typeof summary === 'object') {
		for (const [key, value] of Object.entries(summary)) {
			if (TEXT_KEYS.has(String(key).toLowerCase())) continue;
			if (isScalar(value)) out[key] = value;
			else if (typeof value === 'string' && value.length <= 40) out[key] = value;
		}
	}
	if (typeof out.status !== 'string') {
		const top = envelope.status;
		if (typeof top === 'string' && top.length <= 40) out.status = top;
	}
	out.items = Array.isArray(envelope.items) ? envelope.items.length : 0;
	if (typeof out.due !== 'number' && Array.isArray(envelope.details)) out.due = envelope.details.length;
	return out;
}

/**
 * Create the job scheduler.
 *
 * @param {{
 *   config: object, rsrs: object, state: object, logger?: object,
 *   now?: Function, spawnImpl?: Function, timers?: object,
 * }} options
 */
export function createJobs({ config, rsrs, state, logger, now = Date.now, spawnImpl, timers } = {}) {
	const setTimer = timers?.setTimeout ?? setTimeout;
	const clearTimer = timers?.clearTimeout ?? clearTimeout;
	const jobsConfig = config.jobs;
	/** @type {Set<object>} */
	const handles = new Set();
	let started = false;

	const warn = (message) => {
		try {
			logger?.warn?.(`dafeiyu: ${message}`);
		} catch {
			/* optional */
		}
		state.log?.(`warn ${message}`);
	};

	const track = (handle) => {
		if (!handle) return handle;
		handle.unref?.();
		handles.add(handle);
		return handle;
	};

	const untrack = (handle) => {
		if (!handle) return;
		handles.delete(handle);
		clearTimer(handle);
	};

	/** Run the daily residual-reranker training. */
	const runDailyLearn = async ({ force = false } = {}) => {
		const probe = await rsrs.probeLearn();
		if (!probe.learnAvailable) {
			state.log?.('daily learn skipped: learn subcommand unavailable');
			return { ran: false, reason: 'learn-unavailable' };
		}
		const release = state.acquireDailyLock();
		if (!release) {
			state.log?.('daily learn skipped: lock held');
			return { ran: false, reason: 'locked' };
		}
		try {
			const last = state.readJobs().daily ?? {};
			const stamp = now();
			if (!force && typeof last.finishedAt === 'number' && stamp - last.finishedAt < DAILY_INTERVAL_MS) {
				return { ran: false, reason: 'not-due' };
			}
			const args = learnTrainArgs({ limit: jobsConfig.dailyLimit, epochs: 1 });
			const { envelope } = await rsrs.run(args, { timeoutMs: TRAIN_TIMEOUT_MS });
			const record = {
				startedAt: stamp,
				finishedAt: now(),
				status: 'ok',
				counts: summarizeLearn(envelope),
			};
			state.writeJobs({ daily: record });
			state.log?.(`daily learn ok ${JSON.stringify(record.counts)}`);
			return { ran: true, ...record };
		} catch (error) {
			const record = {
				startedAt: now(),
				finishedAt: now(),
				status: 'error',
				error: truncate(error?.message ?? String(error), 500),
			};
			state.writeJobs({ daily: record });
			warn(`daily learn failed: ${record.error}`);
			return { ran: false, ...record };
		} finally {
			release();
		}
	};

	/** Run the weekly Granite encoder pipeline. */
	const runWeeklyEncoder = async () => {
		if (!jobsConfig.weeklyGranite) return { ran: false, reason: 'disabled' };
		const status = encoderStatus({ graniteModelDir: jobsConfig.graniteModelDir, respireRepo: jobsConfig.respireRepo });
		if (!status.ready) {
			state.log?.(`weekly encoder skipped: ${status.reason}`);
			return { ran: false, reason: status.reason };
		}
		const release = state.acquireEncoderLock();
		if (!release) {
			state.log?.('weekly encoder skipped: lock held');
			return { ran: false, reason: 'locked' };
		}
		const startedAt = now();
		try {
			appendLog(state.files.encoderLog, `--- ${new Date(startedAt).toISOString()} start ${status.script.script}`);
			const env = {
				...rsrs.env,
				RSRS_BIN: rsrs.bin ?? '',
				RSRS_ENCODER_BASE: jobsConfig.graniteModelDir,
				RSRS_ENCODER_STATE: jobsConfig.anchorDir,
			};
			if (config.dataDir) env.RSRS_DATA_DIR = config.dataDir;
			const result = await runProcess({
				bin: 'bash',
				args: [status.script.script],
				env,
				timeoutMs: ENCODER_TIMEOUT_MS,
				spawnImpl,
			});
			appendLog(state.files.encoderLog, truncate(result.stdout, 20000));
			if (result.stderr) appendLog(state.files.encoderLog, truncate(result.stderr, 20000));
			const record = {
				startedAt,
				finishedAt: now(),
				exitCode: result.code,
				status: result.code === 0 ? 'ok' : 'error',
			};
			state.writeJobs({ weekly: record });
			appendLog(state.files.encoderLog, `--- ${new Date(record.finishedAt).toISOString()} exit ${result.code}`);
			return { ran: true, ...record };
		} catch (error) {
			const record = {
				startedAt,
				finishedAt: now(),
				status: 'error',
				error: truncate(error?.message ?? String(error), 500),
			};
			state.writeJobs({ weekly: record });
			appendLog(state.files.encoderLog, `--- error ${record.error}`);
			warn(`weekly encoder failed: ${record.error}`);
			return { ran: false, ...record };
		} finally {
			release();
		}
	};

	/**
	 * Nightly read-only maintenance: `audit` + `review --due`.
	 * Counts only — never deletes, updates or forgets a memory, and a failing
	 * audit does not skip the review (independent guards).
	 */
	const runMaintenance = async ({ force = false } = {}) => {
		if (!jobsConfig.maintenanceEnabled) return { ran: false, reason: 'disabled' };
		const release = state.acquireMaintenanceLock();
		if (!release) return { ran: false, reason: 'locked' };
		const startedAt = now();
		try {
			const last = state.readJobs().maintenance ?? {};
			const stamp = now();
			if (!force && typeof last.finishedAt === 'number' && stamp - last.finishedAt < MAINTENANCE_INTERVAL_MS) {
				return { ran: false, reason: 'not-due' };
			}

			/** Read-only step runner: counts or `{status:'error'}`, never throws. */
			const step = async (key, args, timeoutMs, summarize) => {
				try {
					const { envelope } = await rsrs.run(args, { timeoutMs, allowFailure: true });
					if (!envelope || (envelope.status && envelope.status !== 'ok')) {
						const errors = Array.isArray(envelope?.errors)
							? envelope.errors
								.map((entry) => (typeof entry === 'string' ? entry : entry?.message ?? entry?.reason ?? ''))
								.filter(Boolean)
							: [];
						const detail = truncate(
							errors.join('; ') || envelope?.summary?.reason || 'audit/review reported a failure',
							300,
						);
						return { status: 'error', counts: {}, error: detail };
					}
					const counts = summarize(envelope);
					return { status: typeof counts.status === 'string' && counts.status ? counts.status : 'ok', counts };
				} catch (error) {
					const detail = truncate(error?.message ?? String(error), 300);
					warn(`maintenance ${key} failed: ${detail}`);
					return { status: 'error', counts: {}, error: detail };
				}
			};

			const audit = await step('audit', auditArgs(), AUDIT_TIMEOUT_MS, summarizeAudit);
			const review = await step(
				'review',
				reviewDueArgs(jobsConfig.maintenanceLimit),
				REVIEW_TIMEOUT_MS,
				summarizeReview,
			);
			const record = {
				startedAt,
				finishedAt: now(),
				status: audit.status === 'error' || review.status === 'error' ? 'error' : 'ok',
				audit,
				review,
			};
			state.writeJobs({ maintenance: record });
			state.log?.(`maintenance ${record.status} audit=${audit.status} review=${review.status}`);
			return { ran: true, ...record };
		} catch (error) {
			const record = {
				startedAt,
				finishedAt: now(),
				status: 'error',
				error: truncate(error?.message ?? String(error), 500),
			};
			state.writeJobs({ maintenance: record });
			warn(`maintenance crashed: ${record.error}`);
			return { ran: false, ...record };
		} finally {
			release();
		}
	};

	const scheduleDaily = (delay) => {
		const handle = track(setTimer(async () => {
			untrack(handle);
			try {
				await runDailyLearn();
			} catch (error) {
				warn(`daily job crashed: ${error?.message ?? error}`);
			}
			if (started) scheduleDaily(msUntilNext(jobsConfig.dailyHour, jobsConfig.dailyMinute, now()));
		}, Math.max(1000, delay)));
		return handle;
	};

	const scheduleWeekly = () => {
		const handle = track(setTimer(async () => {
			untrack(handle);
			try {
				await runWeeklyEncoder();
			} catch (error) {
				warn(`weekly job crashed: ${error?.message ?? error}`);
			}
			if (started) scheduleWeekly();
		}, Math.max(1000, msUntilNextWeekly(now()))));
		return handle;
	};

	const scheduleMaintenance = (delay) => {
		const handle = track(setTimer(async () => {
			untrack(handle);
			try {
				await runMaintenance();
			} catch (error) {
				warn(`maintenance job crashed: ${error?.message ?? error}`);
			}
			if (started && jobsConfig.maintenanceEnabled) {
				scheduleMaintenance(msUntilNext(jobsConfig.maintenanceHour, jobsConfig.maintenanceMinute, now()));
			}
		}, Math.max(1000, delay)));
		return handle;
	};

	return {
		runDailyLearn,
		runWeeklyEncoder,
		runMaintenance,

		/** Start timers. No-op when jobs are disabled. */
		start() {
			if (!jobsConfig.enabled || started) return false;
			started = true;
			const last = state.readJobs().daily;
			const stamp = now();
			const overdue = !last || typeof last.finishedAt !== 'number' || stamp - last.finishedAt >= DAILY_INTERVAL_MS;
			// Catch up on load when the last run is stale.
			const delay = overdue ? CATCHUP_MS : msUntilNext(jobsConfig.dailyHour, jobsConfig.dailyMinute, stamp);
			scheduleDaily(delay);
			scheduleWeekly();
			if (jobsConfig.maintenanceEnabled) {
				scheduleMaintenance(msUntilNext(jobsConfig.maintenanceHour, jobsConfig.maintenanceMinute, stamp));
			}
			state.log?.(`jobs started (daily delay ${Math.round(delay / 1000)}s)`);
			return true;
		},

		/** Stop and clear every timer. */
		stop() {
			started = false;
			for (const handle of handles) clearTimer(handle);
			handles.clear();
		},

		get started() {
			return started;
		},

		/** Exposed for tests. */
		handles,
	};
}
