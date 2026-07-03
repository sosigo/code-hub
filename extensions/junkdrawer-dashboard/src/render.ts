/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Junk Drawer Dashboard - webview HTML renderer. Renders an interactive
// variables bar (typed dropdowns / inputs the human can change) plus the metric
// cards. Self-contained: all CSS and the tiny message-posting script are inline
// under a nonce'd CSP.

import { Accent, DashModel } from './model';
import { allowedOptions } from './types';

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function accentColor(accent: Accent | undefined): string {
	switch (accent) {
		case 'green': return '#3FB950';
		case 'blue': return '#4DAAFC';
		case 'red': return '#F85149';
		default: return 'var(--vscode-foreground)';
	}
}

function deltaColor(delta: string): string {
	if (delta.trim().startsWith('-')) { return '#F85149'; }
	if (delta.trim().startsWith('+')) { return '#3FB950'; }
	return 'var(--vscode-descriptionForeground, #8b949e)';
}

function renderControl(name: string, type: string, value: string, options: readonly { value: string; label: string }[] | null, min?: number, max?: number, step?: number): string {
	const id = `var-${escapeHtml(name)}`;
	if (options) {
		const opts = options.map(o =>
			`<option value="${escapeHtml(o.value)}"${o.value === value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
		return `<select class="control" id="${id}" data-var="${escapeHtml(name)}">${opts}</select>`;
	}
	if (type === 'number') {
		const attrs = [
			min !== undefined ? `min="${min}"` : '',
			max !== undefined ? `max="${max}"` : '',
			step !== undefined ? `step="${step}"` : '',
		].filter(Boolean).join(' ');
		return `<input class="control" type="number" id="${id}" data-var="${escapeHtml(name)}" value="${escapeHtml(value)}" ${attrs}>`;
	}
	return `<input class="control" type="text" id="${id}" data-var="${escapeHtml(name)}" value="${escapeHtml(value)}">`;
}

export function renderDashboard(model: DashModel, resolvedValues: string[], nonce: string): string {
	const chips = model.variables.map(v => {
		const label = escapeHtml(v.label ?? v.name);
		const control = renderControl(v.name, v.type, v.value, allowedOptions(v), v.min, v.max, v.step);
		return `<div class="chip"><span class="chip-label">${label}</span>${control}</div>`;
	}).join('');

	const cards = model.cards.length
		? model.cards.map((card, i) => {
			const value = resolvedValues[i] ?? '';
			return `
			<div class="card">
				<div class="card-label">${escapeHtml(card.label)}</div>
				<div class="card-value" style="color:${accentColor(card.accent)}">${escapeHtml(value)}</div>
				<div class="card-foot">
					${card.delta ? `<span class="delta" style="color:${deltaColor(card.delta)}">${escapeHtml(card.delta)}</span>` : ''}
					${card.hint ? `<span class="card-hint">${escapeHtml(card.hint)}</span>` : ''}
				</div>
			</div>`;
		}).join('')
		: `<div class="empty">No cards yet. Ask the agent to add some, or edit this <code>.dash</code> file.</div>`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
	<style nonce="${nonce}">
		* { box-sizing: border-box; }
		body {
			margin: 0;
			padding: 28px 40px 40px;
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
		}
		.brand { font-size: 11px; font-weight: 800; letter-spacing: 1px; color: #3FB950; text-transform: uppercase; margin-bottom: 10px; }
		.title { font-size: 30px; font-weight: 800; letter-spacing: -0.5px; }
		.subtitle { font-size: 14px; opacity: 0.65; margin-top: 4px; }
		.vars { display: flex; flex-wrap: wrap; gap: 10px; margin: 22px 0 26px; }
		.chip {
			display: inline-flex; align-items: center; gap: 8px;
			background: var(--vscode-editorWidget-background, rgba(127,127,127,0.08));
			border: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.2));
			border-radius: 20px; padding: 6px 12px;
		}
		.chip-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.6; }
		.control {
			background: transparent; color: var(--vscode-foreground);
			border: none; font-family: inherit; font-size: 13px; font-weight: 600;
			outline: none; cursor: pointer;
		}
		.control:focus { text-decoration: underline; }
		option { background: var(--vscode-editorWidget-background, #1e1e1e); color: var(--vscode-foreground); }
		.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
		.card {
			background: var(--vscode-editorWidget-background, rgba(127,127,127,0.08));
			border: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.2));
			border-radius: 10px; padding: 18px 20px;
		}
		.card-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.6; }
		.card-value { font-size: 28px; font-weight: 700; margin-top: 8px; }
		.card-foot { display: flex; align-items: baseline; gap: 8px; margin-top: 6px; min-height: 16px; }
		.delta { font-size: 13px; font-weight: 700; }
		.card-hint { font-size: 12px; opacity: 0.55; }
		.empty { opacity: 0.6; font-size: 14px; padding: 40px 0; }
		code { background: rgba(127,127,127,0.15); padding: 1px 5px; border-radius: 4px; }
	</style>
</head>
<body>
	<div class="brand">Junk Drawer</div>
	<div class="title">${escapeHtml(model.title)}</div>
	${model.subtitle ? `<div class="subtitle">${escapeHtml(model.subtitle)}</div>` : ''}
	${model.variables.length ? `<div class="vars">${chips}</div>` : ''}
	<div class="grid">${cards}</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		for (const el of document.querySelectorAll('.control')) {
			el.addEventListener('change', (e) => {
				vscode.postMessage({ type: 'setVar', name: e.target.dataset.var, value: e.target.value });
			});
		}
	</script>
</body>
</html>`;
}
