/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Junk Drawer Dashboard - webview HTML renderer (self-contained, no external assets).

import { Accent, DashModel } from './model';

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

export function renderDashboard(model: DashModel, nonce: string): string {
	const cards = model.cards.length
		? model.cards.map(card => `
			<div class="card">
				<div class="card-label">${escapeHtml(card.label)}</div>
				<div class="card-value" style="color:${accentColor(card.accent)}">${escapeHtml(card.value)}</div>
				${card.hint ? `<div class="card-hint">${escapeHtml(card.hint)}</div>` : ''}
			</div>`).join('')
		: `<div class="empty">No cards yet. Ask the agent to add some, or edit this <code>.dash</code> file.</div>`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
	<style nonce="${nonce}">
		* { box-sizing: border-box; }
		body {
			margin: 0;
			padding: 32px 40px;
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
		}
		.header { margin-bottom: 28px; }
		.title { font-size: 30px; font-weight: 800; letter-spacing: -0.5px; }
		.subtitle { font-size: 14px; opacity: 0.65; margin-top: 4px; }
		.brand { font-size: 11px; font-weight: 800; letter-spacing: 1px; color: #3FB950; text-transform: uppercase; margin-bottom: 10px; }
		.grid {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
			gap: 16px;
		}
		.card {
			background: var(--vscode-editorWidget-background, rgba(127,127,127,0.08));
			border: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.2));
			border-radius: 10px;
			padding: 18px 20px;
		}
		.card-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.6; }
		.card-value { font-size: 28px; font-weight: 700; margin-top: 8px; }
		.card-hint { font-size: 12px; opacity: 0.55; margin-top: 6px; }
		.empty { opacity: 0.6; font-size: 14px; padding: 40px 0; }
		code { background: rgba(127,127,127,0.15); padding: 1px 5px; border-radius: 4px; }
	</style>
</head>
<body>
	<div class="header">
		<div class="brand">Junk Drawer</div>
		<div class="title">${escapeHtml(model.title)}</div>
		${model.subtitle ? `<div class="subtitle">${escapeHtml(model.subtitle)}</div>` : ''}
	</div>
	<div class="grid">${cards}</div>
</body>
</html>`;
}
