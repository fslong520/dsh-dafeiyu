// @fslong/dsh-dafeiyu — browser half (T3b).
//
// Three UI pieces, all on documented public extension seats:
//   1. conversation.hero.brand.mark — 常驻大肥鱼形象（FISH_LOGO SVG 游动动画，零 wasm）
//   2. conversation.header          — ON AIR 状态条（待播/直播中指示灯＋干活内容字幕）
//   3. sidebar.right.pane.tab       — 右栏「大肥鱼·进化」面板（两段式注册，仿 dsh-cabinet-mode）
//
// Plain JavaScript, no build framework: this file is the source; client/build.mjs
// validates it and emits lib/client.js (placeholders substituted). React comes
// from the frozen browser module table; @deepseek-ai/dsh-client-ui-primitives
// (FISH_LOGO constants) is required defensively with an embedded fallback path
// extracted from the same host build (assets/fish-logo.svg).
//
// Data channels (see README §client 数据源):
//   - remote 'api-session/status' (sessionId, running:boolean) → 活动状态灯
//   - sidebar tab slot props (useSession/useSessions/useSessionStatus) → 任务时间线
//   - 记忆量/能力清单等 host 数据【未接通】— panel 明示占位，不造假数。
window.__ModuleLoader__.load({
	id: '@fslong/dsh-dafeiyu',
	factory(require) {
		'use strict';
		const React = require('react');
		const h = React.createElement;

		// ---- build placeholders (substituted by client/build.mjs) ----
		const VERSION = '__DAFEIYU_VERSION__';
		const BUILD_TIME = '__DAFEIYU_BUILD_TIME__';
		const FISH_EMBED_PATH = '__FISH_PATH_EMBED__';
		const FISH_EMBED_VIEWBOX = { width: 23.16, height: 17.04 };

		// FISH_LOGO constants: runtime primitives (same release as the host) first,
		// embedded copy from this host build as fallback. Zero wasm, zero Rive.
		let FISH;
		try {
			const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
			if (primitives && primitives.FISH_LOGO_PATH && primitives.FISH_LOGO_VIEWBOX) {
				FISH = { path: primitives.FISH_LOGO_PATH, viewBox: primitives.FISH_LOGO_VIEWBOX };
			}
		} catch (error) {
			/* fall through to the embedded copy */
		}
		if (!FISH) FISH = { path: FISH_EMBED_PATH, viewBox: FISH_EMBED_VIEWBOX };

		// ---- shared activity store (remote events → ON AIR bar) ----
		const activity = {
			running: new Map(),   // sessionId -> boolean
			tasks: [],            // in-progress task subjects pushed by the panel
			listeners: new Set(),
			rev: 0,
		};
		function activityEmit() {
			activity.rev += 1;
			for (const listener of Array.from(activity.listeners)) {
				try { listener(); } catch (error) { /* one bad subscriber must not break the rest */ }
			}
		}
		function activitySubscribe(listener) {
			activity.listeners.add(listener);
			return () => activity.listeners.delete(listener);
		}
		function activityLive() {
			for (const value of activity.running.values()) if (value) return true;
			return false;
		}
		function useActivity() {
			const [, force] = React.useState(0);
			React.useEffect(() => activitySubscribe(() => force((n) => n + 1)), []);
			return { live: activityLive(), tasks: activity.tasks, rev: activity.rev };
		}
		function setSessionRunning(sessionId, running) {
			const key = String(sessionId);
			const next = running === true;
			if (activity.running.get(key) === next) return;
			activity.running.set(key, next);
			activityEmit();
		}
		function setActivityTasks(subjects) {
			const joined = subjects.join(' ');
			if (joined === activity.tasks.join(' ')) return;
			activity.tasks = subjects;
			activityEmit();
		}

		// ---- styles (mounted in apply, removed on dispose) ----
		const STYLE_ID = 'dsh-dafeiyu-ui-styles';
		const CSS = [
			// hero fish: 常驻游动（尊重 prefers-reduced-motion）
			'.dshf-fish{display:block;overflow:visible;transform-origin:50% 60%;color:inherit}',
			'@keyframes dshf-swim{0%,100%{transform:translate(0,0) rotate(0deg)}25%{transform:translate(1.6px,-1.4px) rotate(-4deg)}50%{transform:translate(3px,0) rotate(1.5deg)}75%{transform:translate(1.4px,1.2px) rotate(2.5deg)}}',
			'@media (prefers-reduced-motion:no-preference){.dshf-fish{animation:dshf-swim 3.4s ease-in-out infinite}}',
			// ON AIR 状态条
			'.dshf-onair-row{display:flex;justify-content:center;padding:2px 8px}',
			'.dshf-onair{display:inline-flex;align-items:center;gap:8px;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.35));border-radius:999px;background:var(--dsw-alias-bg-elevated,rgba(20,20,24,.6));color:var(--dsw-alias-label-primary,#e8e8ea);font-size:12px;line-height:18px;padding:2px 10px;max-width:100%;min-width:0}',
			'.dshf-onair-dot{flex:none;width:8px;height:8px;border-radius:50%;background:#8b93a1}',
			'.dshf-onair-dot.live{background:#e5484d;box-shadow:0 0 0 0 rgba(229,72,77,.55)}',
			'@media (prefers-reduced-motion:no-preference){.dshf-onair-dot.live{animation:dshf-pulse 1.4s ease-out infinite}}',
			'@keyframes dshf-pulse{0%{box-shadow:0 0 0 0 rgba(229,72,77,.55)}70%{box-shadow:0 0 0 7px rgba(229,72,77,0)}100%{box-shadow:0 0 0 0 rgba(229,72,77,0)}}',
			'.dshf-onair-label{font-weight:600;letter-spacing:.06em;white-space:nowrap}',
			'.dshf-onair-label.live{color:#ff6369}',
			'.dshf-onair-sub{color:var(--dsw-alias-label-caption,#9a9aa3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
			// right panel
			'.dshf-panel{display:flex;flex-direction:column;gap:14px;padding:10px 12px 16px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary,#e8e8ea)}',
			'.dshf-panel-head{display:flex;align-items:center;gap:8px;font-weight:600}',
			'.dshf-section{border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.3));border-radius:8px;padding:8px 10px;background:var(--dsw-alias-bg-sunken,rgba(255,255,255,.03))}',
			'.dshf-section h4{margin:0 0 6px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#c3c3ca)}',
			'.dshf-kv{display:flex;justify-content:space-between;gap:10px}',
			'.dshf-kv span:last-child{color:var(--dsw-alias-label-caption,#9a9aa3);font-family:var(--ds-font-family-code,monospace)}',
			'.dshf-muted{color:var(--dsw-alias-label-dimmed,#77777f)}',
			'.dshf-cap{color:var(--dsw-alias-label-caption,#9a9aa3);font-size:11px}',
			'.dshf-timeline{display:flex;flex-direction:column;gap:6px}',
			'.dshf-task{display:flex;gap:8px;align-items:flex-start}',
			'.dshf-task-dot{flex:none;width:8px;height:8px;border-radius:50%;margin-top:5px;background:#8b93a1}',
			'.dshf-task-dot.done{background:#46a758}.dshf-task-dot.progress{background:#f5a524}.dshf-task-dot.blocked{background:#e5484d}',
			'.dshf-task-main{min-width:0;flex:1}',
			'.dshf-task-sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.dshf-list{margin:0;padding-left:16px}',
			'.dshf-list li{margin:1px 0}',
		].join('\n');
		function injectStyles() {
			if (typeof document === 'undefined') return () => {};
			const existing = document.getElementById(STYLE_ID);
			if (existing) return () => {};
			const el = document.createElement('style');
			el.id = STYLE_ID;
			el.textContent = CSS;
			document.head.appendChild(el);
			return () => { try { el.remove(); } catch (error) { /* already gone */ } };
		}

		// ---- 1. hero fish mark ----
		function FishMark(props) {
			const size = Number.isFinite(props && props.size) ? props.size : 34;
			const ratio = FISH.viewbox.height / FISH.viewbox.width;
			const cls = ['dshf-fish', props && props.className].filter(Boolean).join(' ');
			return h(
				'svg',
				{
					width: size,
					height: Math.round(size * ratio * 100) / 100,
					viewBox: `0 0 ${FISH.viewbox.width} ${FISH.viewbox.height}`,
					className: cls,
					'aria-hidden': 'true',
					focusable: 'false',
				},
				h('path', { d: FISH.path, fill: 'currentColor' })
			);
		}

		// ---- 2. ON AIR bar (conversation.header) ----
		function OnAirBar() {
			const snapshot = useActivity();
			const live = snapshot.live;
			let subtitle;
			if (snapshot.tasks.length > 0) {
				subtitle = snapshot.tasks.slice(0, 2).join(' · ') + (snapshot.tasks.length > 2 ? ` ＋${snapshot.tasks.length - 2}` : '');
			} else {
				subtitle = live ? '宿主运行中（打开右栏「大肥鱼·进化」可看任务字幕）' : '空闲待播';
			}
			return h(
				'div',
				{ className: 'dshf-onair-row' },
				h(
					'div',
					{ className: 'dshf-onair', role: 'status', 'aria-live': 'polite' },
					h('span', { className: `dshf-onair-dot${live ? ' live' : ''}` }),
					h('span', { className: `dshf-onair-label${live ? ' live' : ''}` }, live ? 'ON AIR' : 'STANDBY'),
					h('span', { className: 'dshf-onair-sub', title: subtitle }, subtitle)
				)
			);
		}

		// ---- 3. right panel: 大肥鱼·进化 ----
		const identityHook = (value) => value;
		const safeHook = (fn) => (typeof fn === 'function' ? fn : identityHook);
		const KNOWN_CAPABILITIES = [
			'memory op=recall / show / chain（召回与因果链）',
			'memory op=remember / reflect（事实与假设存档）',
			'memory op=feedback / mute（重训与静音）',
			'jobs：日训 + 周编码器调度（lib/jobs.js）',
			'proactive pre-step 召回门（host 侧 lib/recall.js）',
		];
		function DafeiyuPanel(props) {
			const readSession = safeHook(props && props.useSession);
			const readSessions = safeHook(props && props.useSessions);
			const readStatus = safeHook(props && props.useSessionStatus);

			// agentTeam 投影（与 dsh-cabinet-mode 同通道）
			const parentSessionId = readSession((snapshot) => snapshot?.subagent?.address?.parentSessionId);
			const sessionId = props && props.sessionId;
			const leadSessionId = parentSessionId ?? sessionId;
			const list = readSessions((state) => state);
			const statusMap = readStatus((state) => state);
			const projections = list?.projectionsBySession;
			const team = projections
				? (projections[leadSessionId]?.values?.agentTeam
					|| (leadSessionId !== sessionId && projections[sessionId] ? projections[sessionId].values.agentTeam : undefined))
				: undefined;

			const tasks = (team?.tasks ?? []).filter((task) => task && task.status !== 'deleted');

			// 把进行中任务推给 ON AIR 字幕（面板打开期间）
			React.useEffect(() => {
				const subjects = tasks
					.filter((task) => task.status === 'in_progress' || task.status === 'in-progress' || task.status === 'progress')
					.map((task) => String(task.subject ?? task.id ?? '').trim())
					.filter(Boolean);
				setActivityTasks(subjects);
				return undefined;
			}, [JSON.stringify(tasks.map((task) => [task.id, task.status, task.subject]))]);

			let runningCount = 0;
			if (statusMap && typeof statusMap === 'object') {
				for (const value of Object.values(statusMap)) if (value === true) runningCount += 1;
			}

			let release = null;
			try {
				release = (typeof window !== 'undefined' && window.__DSH_BOOT__ && (window.__DSH_BOOT__.release ?? window.__DSH_BOOT__.entry?.release)) || null;
			} catch (error) { release = null; }

			const statusClass = (status) => (status === 'completed' || status === 'complete' ? 'done' : status === 'in_progress' || status === 'in-progress' ? 'progress' : status === 'blocked' ? 'blocked' : '');

			return h(
				'div',
				{ className: 'dshf-panel' },
				h('div', { className: 'dshf-panel-head' }, h(FishMark, { size: 18 }), '大肥鱼 · 进化面板'),

				// ① 版本历史
				h(
					'section',
					{ className: 'dshf-section' },
					h('h4', null, '版本历史'),
					h('div', { className: 'dshf-kv' }, h('span', null, '插件版本'), h('span', null, VERSION)),
					h('div', { className: 'dshf-kv' }, h('span', null, 'client 构建时间'), h('span', null, BUILD_TIME)),
					release ? h('div', { className: 'dshf-kv' }, h('span', null, 'Host release'), h('span', null, String(release.version ?? release) + (release.commit ? ` @${String(release.commit).slice(0, 8)}` : ''))) : null,
					h('div', { className: 'dshf-cap', style: { marginTop: 4 } }, '插件目录非 git 仓库（实测）；变更史待建 git/CHANGELOG 后接入')
				),

				// ② 能力清单
				h(
					'section',
					{ className: 'dshf-section' },
					h('h4', null, '能力清单'),
					h('ul', { className: 'dshf-list' }, KNOWN_CAPABILITIES.map((line) => h('li', { key: line }, line))),
					h('div', { className: 'dshf-cap' }, '静态清单；运行时以 设置 → 插件列表 为准')
				),

				// ③ 记忆量（数据源未接通——明示，不编数）
				h(
					'section',
					{ className: 'dshf-section' },
					h('h4', null, '记忆量'),
					h('div', { className: 'dshf-muted' }, '未接通：host 尚未向浏览器暴露 memory op=status 通道'),
					h('div', { className: 'dshf-cap' }, '数据源规划：lib/memory-tool.js 的 status 输出（需 host 桥接，见 README §client 数据源）')
				),

				// ④ 任务日志时间线
				h(
					'section',
					{ className: 'dshf-section' },
					h('h4', null, '任务日志时间线'),
					runningCount > 0 ? h('div', { className: 'dshf-cap' }, `运行中会话：${runningCount}`) : null,
					tasks.length > 0
						? h('div', { className: 'dshf-timeline' },
							tasks.map((task) =>
								h(
									'div',
									{ className: 'dshf-task', key: String(task.id ?? task.subject ?? task.status) },
									h('span', { className: `dshf-task-dot ${statusClass(task.status)}` }),
									h(
										'div',
										{ className: 'dshf-task-main' },
										h('div', { className: 'dshf-task-sub', title: String(task.subject ?? '') }, String(task.subject ?? task.id ?? '')),
										h('div', { className: 'dshf-cap' }, `${task.status ?? 'pending'}${task.owner ? ` · ${task.owner}` : ''}`)
									)
								)
							))
						: h('div', { className: 'dshf-muted' }, '暂无团队任务（agentTeam 投影为空）'),
					h('div', { className: 'dshf-cap' }, '数据源：agentTeam session 投影（设置/任务板同源）')
				)
			);
		}

		// ---- registration (two-stage pattern copied from dsh-cabinet-mode) ----
		const TAB_ID = 'dafeiyu-evolution';

		function apply(ctx) {
			ctx.effect(() => injectStyles(), 'dafeiyu-ui: styles');

			// 活动通道：api-session/status → ON AIR 指示灯（服务缺位则整体降级）
			ctx.inject(['remote'], (scope) => {
				scope.effect(() => {
					let dispose;
					try {
						dispose = scope.remote.$on('api-session/status', (sessionId, running) => {
							try { setSessionRunning(sessionId, running); } catch (error) { /* ignore */ }
						});
					} catch (error) { /* remote unavailable: bar stays STANDBY */ }
					return () => { try { if (typeof dispose === 'function') dispose(); } catch (error) { /* ignore */ } };
				}, 'dafeiyu-ui: activity');
			}, 'dafeiyu-ui: remote');

			// ① hero 常驻形象
			ctx.effect(() => ctx.slots.inject(
				'conversation.hero.brand.mark',
				() => ctx.slots.register({ name: 'conversation.hero.brand.mark', key: '@fslong/dsh-dafeiyu/fish' }, FishMark)
			), 'dafeiyu-ui: hero fish');

			// ② ON AIR 状态条
			ctx.effect(() => ctx.slots.inject(
				'conversation.header',
				() => ctx.slots.register({ name: 'conversation.header', key: '@fslong/dsh-dafeiyu/on-air' }, OnAirBar)
			), 'dafeiyu-ui: on air');

			// ③ 右栏 tab：stage one = 类型声明
			ctx.effect(() => ctx.sidebarRightTabs.register({
				id: TAB_ID,
				kind: 'dafeiyu',
				priority: 'extension',
				title: () => '大肥鱼·进化',
				guide: [{
					id: 'dafeiyu',
					order: 60,
					title: () => '大肥鱼·进化面板',
					description: () => '版本历史 / 能力清单 / 记忆量 / 任务时间线',
				}],
			}), 'dafeiyu-ui: sidebar type');

			// ③ 右栏 tab：stage two = 正文挂载
			ctx.effect(() => ctx.slots.inject(
				'sidebar.right.pane.tab',
				() => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, DafeiyuPanel)
			), 'dafeiyu-ui: sidebar body');
		}

		return { inject: ['slots', 'sidebarRightTabs'], apply };
	},
});
