/**
 * Proactive reflection policy: mute list, per-topic cooldown and the
 * per-session permission window that bounds how often unverified hypotheses may
 * be surfaced. Default off.
 */
import { createHash } from 'node:crypto';
import { hashTopic } from './state.js';

/** Hash a normalized topic into a stable mute/cooldown key. */
export function topicKey(topic) {
	const normalized = hashTopic(topic);
	if (normalized === '') return undefined;
	return `topic:${createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`;
}

/** Hash a memory id into a stable mute key. */
export function idKey(id) {
	const text = String(id ?? '').trim().toLowerCase();
	if (text === '') return undefined;
	return `id:${createHash('sha256').update(text).digest('hex').slice(0, 16)}`;
}

/** Default mute duration: 30 days. */
export const DEFAULT_MUTE_HOURS = 720;

/**
 * Create the proactive gate.
 *
 * Semantics:
 * - muted topic or muted id  -> never surface;
 * - live per-topic cooldown  -> never surface again inside the window;
 * - permission window        -> at most `permissionTurns` injections per
 *   `permissionMs` per session; the window resets when it expires, when the
 *   turns run out, or when the topic changes.
 *
 * @param {{config: object, state: object, now?: Function}} options
 */
export function createProactiveGate({ config, state, now = Date.now }) {
	const proactive = config.proactive;
	/** @type {Map<string, {untilMs: number, turnsLeft: number, topicHash?: string, topicCooldowns: Map<string, number>}>} */
	const sessions = new Map();

	const sessionOf = (key) => {
		let entry = sessions.get(key);
		if (!entry) {
			entry = { untilMs: 0, turnsLeft: proactive.permissionTurns, topicHash: undefined, topicCooldowns: new Map() };
			sessions.set(key, entry);
		}
		return entry;
	};

	/** Reset the window when expired, exhausted, or the topic changed. */
	const refresh = (session, topicHash) => {
		const stamp = now();
		const expired = session.untilMs <= stamp;
		const exhausted = session.turnsLeft <= 0;
		const changed = session.topicHash !== topicHash;
		if (expired || exhausted || changed) {
			session.untilMs = stamp + proactive.permissionMs;
			session.turnsLeft = proactive.permissionTurns;
			session.topicHash = topicHash;
		}
		return session;
	};

	const isMuted = (topicHash, ids) => {
		if (topicHash && state.isMuted(topicHash)) return 'muted-topic';
		for (const id of ids ?? []) {
			const key = idKey(id);
			if (key && state.isMuted(key)) return 'muted-id';
		}
		return undefined;
	};

	return {
		/** True when proactive reflections are enabled at all. */
		get enabled() {
			return Boolean(proactive.enabled);
		},

		/**
		 * Filter a candidate reflection list down to what may be surfaced.
		 * @returns {Array<object>}
		 */
		filter({ sessionKey = 'default', topic, items = [] } = {}) {
			if (!proactive.enabled || proactive.maxItems <= 0) return [];
			const tKey = topicKey(topic);
			const session = sessionOf(sessionKey);
			const stamp = now();

			// Drop muted topics and muted records first.
			const candidates = items.filter((item) => !isMuted(tKey, [item?.id ?? item?.name]));
			if (candidates.length === 0) return [];

			refresh(session, tKey);
			const cooldownUntil = tKey ? session.topicCooldowns.get(tKey) ?? 0 : 0;
			if (cooldownUntil > stamp) {
				state.log?.('proactive: topic cooling down');
				return [];
			}
			if (session.turnsLeft <= 0) {
				state.log?.('proactive: permission turns exhausted');
				return [];
			}

			return candidates.slice(0, proactive.maxItems);
		},

		/** Record that a reflection was actually injected. */
		recordInjected({ sessionKey = 'default', topic, ids = [] } = {}) {
			const tKey = topicKey(topic);
			const session = sessionOf(sessionKey);
			const stamp = now();
			refresh(session, tKey);
			session.untilMs = stamp + proactive.permissionMs;
			session.turnsLeft = Math.max(0, session.turnsLeft - 1);
			session.topicHash = tKey;
			if (tKey) session.topicCooldowns.set(tKey, stamp + proactive.topicCooldownMs);
			state.log?.(`proactive: injected ${ids.length} reflection(s), turnsLeft=${session.turnsLeft}`);
			return session;
		},

		/** Mute a topic for `durationHours`. */
		muteTopic(topic, durationHours = DEFAULT_MUTE_HOURS) {
			const key = topicKey(topic);
			if (!key) throw new Error('mute requires a non-empty topic');
			const untilMs = now() + durationHours * 3600 * 1000;
			state.addMute({ key, untilMs, label: String(topic).slice(0, 200), kind: 'topic', hash: key.slice('topic:'.length) });
			return { key, untilMs, kind: 'topic' };
		},

		/** Mute a memory id for `durationHours`. */
		muteId(id, durationHours = DEFAULT_MUTE_HOURS) {
			const key = idKey(id);
			if (!key) throw new Error('mute requires a non-empty id');
			const untilMs = now() + durationHours * 3600 * 1000;
			state.addMute({ key, untilMs, label: String(id).slice(0, 200), kind: 'id', hash: key.slice('id:'.length) });
			return { key, untilMs, kind: 'id' };
		},

		/** Remove a mute by topic, id, or raw key. */
		unmute(target) {
			for (const key of [topicKey(target), idKey(target), String(target)]) {
				if (key && state.removeMute(key)) return { key, removed: true };
			}
			return { removed: false };
		},

		/** Live mute entries. */
		list() {
			return state.listMutes();
		},

		/** Test seam. */
		sessions,
	};
}
