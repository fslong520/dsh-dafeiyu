/**
 * Local plugin state: state dir (0700), atomic JSON files (0600), append-only
 * logs, mute/permission records, a pending-recall ring for feedback, and
 * lock files for the scheduled jobs.
 *
 * All of this is host bookkeeping only — the authority store is rsrs.
 */
import {
	appendFileSync,
	chmodSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';

/** Directory mode for the state root. */
export const DIR_MODE = 0o700;
/** File mode for every state file. */
export const FILE_MODE = 0o600;
/** Pending-recall snapshots live this long. */
export const PENDING_TTL_MS = 10 * 60 * 1000;
/** Maximum pending-recall snapshots retained. */
export const PENDING_MAX = 50;

/** Create a directory (recursively) and force its mode. */
export function ensureDir(dir, mode = DIR_MODE) {
	mkdirSync(dir, { recursive: true, mode });
	try {
		chmodSync(dir, mode);
	} catch {
		/* best effort on filesystems without POSIX modes */
	}
	return dir;
}

/** Read and parse JSON; returns `fallback` for a missing or corrupt file. */
export function readJson(file, fallback) {
	try {
		const text = readFileSync(file, 'utf8');
		if (text.trim() === '') return fallback;
		return JSON.parse(text);
	} catch {
		return fallback;
	}
}

/**
 * Atomically write JSON: temp file in the same directory, fsync-free rename.
 * The temp file is created 0600 so the payload is never briefly world-readable.
 */
export function writeJsonAtomic(file, value, { mode = FILE_MODE } = {}) {
	const dir = path.dirname(file);
	ensureDir(dir);
	const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
	const text = `${JSON.stringify(value, null, 2)}\n`;
	let fd;
	try {
		fd = openSync(tmp, 'wx', mode);
		writeFileSync(fd, text, 'utf8');
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
	try {
		chmodSync(tmp, mode);
	} catch {
		/* best effort */
	}
	renameSync(tmp, file);
	try {
		chmodSync(file, mode);
	} catch {
		/* best effort */
	}
	return file;
}

/** Append one line to a log file, creating it 0600. Never throws. */
export function appendLog(file, line) {
	try {
		ensureDir(path.dirname(file));
		if (!existsSync(file)) writeFileSync(file, '', { mode: FILE_MODE });
		appendFileSync(file, `${line}\n`, { mode: FILE_MODE });
	} catch {
		/* logging must never break a turn */
	}
}

/** Normalize a topic or id into a stable hash key. */
export function hashTopic(topic) {
	const text = String(topic ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
	return text;
}

/**
 * Acquire an exclusive lock file. Returns a release function, or undefined when
 * another live lock is held.
 *
 * @param {string} file lock path
 * @param {{staleMs?: number, now?: () => number}} [options]
 */
export function acquireLock(file, { staleMs = 25 * 60 * 60 * 1000, now = Date.now } = {}) {
	ensureDir(path.dirname(file));
	const stamp = now();
	try {
		if (existsSync(file)) {
			const info = statSync(file);
			if (stamp - info.mtimeMs > staleMs) {
				// Stale lock from a crashed run: reclaim it.
				try {
					unlinkSync(file);
				} catch {
					/* someone else reclaimed it */
				}
			}
		}
		const fd = openSync(file, 'wx', FILE_MODE);
		writeFileSync(fd, JSON.stringify({ pid: process.pid, at: stamp }));
		closeSync(fd);
		return () => {
			try {
				unlinkSync(file);
			} catch {
				/* already released */
			}
		};
	} catch {
		return undefined;
	}
}

/**
 * Create the plugin state store.
 *
 * @param {{stateDir: string, debug?: boolean, now?: () => number}} options
 */
export function createState({ stateDir, debug = false, now = Date.now }) {
	ensureDir(stateDir);
	const logsDir = ensureDir(path.join(stateDir, 'logs'));
	const files = {
		permissions: path.join(stateDir, 'permissions.json'),
		recalls: path.join(stateDir, 'pending-recalls.json'),
		jobs: path.join(stateDir, 'jobs.json'),
		status: path.join(stateDir, 'status.json'),
		dailyLock: path.join(stateDir, 'daily.lock'),
		encoderLock: path.join(stateDir, 'encoder.lock'),
		maintenanceLock: path.join(stateDir, 'maintenance.lock'),
		encoderLog: path.join(logsDir, 'encoder.log'),
		debugLog: path.join(logsDir, 'dafeiyu.log'),
	};

	const log = (message) => {
		if (!debug) return;
		appendLog(files.debugLog, `${new Date(now()).toISOString()} ${message}`);
	};

	/** Mute records: `{ entries: { [key]: {topicHash?, id?, untilMs, createdAtMs} } }` */
	const readPermissions = () => {
		const raw = readJson(files.permissions, { entries: {} });
		return raw && typeof raw === 'object' && raw.entries && typeof raw.entries === 'object'
			? raw
			: { entries: {} };
	};

	const writePermissions = (value) => writeJsonAtomic(files.permissions, value);

	return {
		stateDir,
		logsDir,
		files,
		now,
		log,

		readPermissions,
		writePermissions,

		/**
		 * Store a mute record. `key` is `topic:<hash>` or `id:<hash>`; `hash` and
		 * `kind` are stored alongside it so a record is self-describing.
		 */
		addMute({ key, untilMs, createdAtMs = now(), label, kind, hash }) {
			const current = readPermissions();
			current.entries[key] = {
				...(kind ? { kind } : {}),
				...(hash ? { hash } : {}),
				...(label ? { label: String(label).slice(0, 200) } : {}),
				untilMs,
				createdAtMs,
			};
			writePermissions(current);
			return current.entries[key];
		},

		/** Remove one mute record; returns true when something was removed. */
		removeMute(key) {
			const current = readPermissions();
			if (!Object.hasOwn(current.entries, key)) return false;
			delete current.entries[key];
			writePermissions(current);
			return true;
		},

		/** Live (unexpired) mute entries as `[{key, ...record}]`. */
		listMutes() {
			const current = readPermissions();
			const stamp = now();
			return Object.entries(current.entries)
				.map(([key, record]) => ({ key, ...record }))
				.filter((entry) => Number(entry.untilMs) > stamp)
				.sort((a, b) => a.untilMs - b.untilMs);
		},

		/** True when this topic hash or id hash is muted. */
		isMuted(key) {
			const current = readPermissions();
			const record = current.entries[key];
			if (!record) return false;
			return Number(record.untilMs) > now();
		},

		/* ---------------- pending recall ring ---------------- */

		readPending() {
			const raw = readJson(files.recalls, { items: [] });
			const items = Array.isArray(raw?.items) ? raw.items : [];
			const stamp = now();
			return items.filter((item) => item && stamp - Number(item.ts ?? 0) < PENDING_TTL_MS);
		},

		/** Record one recall snapshot so `feedback` can find its request id. */
		recordPending({ requestId, ids, fullIds, idMap, queryHash, ts = now() }) {
			const items = this.readPending();
			const short = Array.isArray(ids) ? ids.slice(0, 50) : [];
			const map = idMap && typeof idMap === 'object' && !Array.isArray(idMap) ? idMap : {};
			const full = Array.isArray(fullIds)
				? fullIds.slice(0, 50)
				: short.map((id) => map[String(id).slice(0, 8)] ?? id);
			items.push({
				requestId: requestId ?? null,
				ids: short,
				fullIds: full,
				idMap: map,
				queryHash: queryHash ?? null,
				ts,
			});
			const trimmed = items.slice(-PENDING_MAX);
			try {
				writeJsonAtomic(files.recalls, { items: trimmed });
			} catch (error) {
				log(`recordPending failed: ${error.message}`);
			}
			return trimmed.length;
		},

		/**
		 * Newest snapshot matching an explicit request id, a query hash, or an
		 * id intersection — in that order.
		 */
		findPending({ requestId, queryHash, ids } = {}) {
			const items = this.readPending();
			if (requestId) {
				const hit = items.find((item) => item.requestId === requestId);
				if (hit) return hit;
			}
			if (queryHash) {
				const hit = [...items].reverse().find((item) => item.queryHash === queryHash);
				if (hit) return hit;
			}
			if (Array.isArray(ids) && ids.length > 0) {
				const wanted = new Set(ids.map((id) => String(id).slice(0, 8)));
				const hit = [...items].reverse().find((item) => item.ids.some((id) => wanted.has(String(id).slice(0, 8))));
				if (hit) return hit;
			}
			return undefined;
		},

		/* ---------------- job bookkeeping ---------------- */

		readJobs() {
			const raw = readJson(files.jobs, {});
			return raw && typeof raw === 'object' ? raw : {};
		},

		writeJobs(patch) {
			const next = { ...this.readJobs(), ...patch };
			writeJsonAtomic(files.jobs, next);
			return next;
		},

		acquireDailyLock() {
			return acquireLock(files.dailyLock, { staleMs: 6 * 60 * 60 * 1000, now });
		},

		acquireEncoderLock() {
			return acquireLock(files.encoderLock, { staleMs: 25 * 60 * 60 * 1000, now });
		},

		acquireMaintenanceLock() {
			return acquireLock(files.maintenanceLock, { staleMs: 6 * 60 * 60 * 1000, now });
		},
	};
}
