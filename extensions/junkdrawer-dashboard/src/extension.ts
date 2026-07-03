/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Junk Drawer Dashboard - renders .dash files as command-center panels and
// exposes an agent tool (junkdrawer_updateDashboard) so a chat agent can drive them.

import * as vscode from 'vscode';
import { DashCard, DashModel, emptyModel, parseModel, serializeModel } from './model';
import { renderDashboard } from './render';

const VIEW_TYPE = 'junkdrawer.dashboard';

function nonce(): string {
	let text = '';
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}

class DashboardEditorProvider implements vscode.CustomTextEditorProvider {

	/** Tracks currently-open dashboards so the agent tool can target the active one. */
	private readonly openDocuments = new Set<vscode.TextDocument>();

	get activeDocument(): vscode.TextDocument | undefined {
		// Prefer the most recently focused dashboard.
		return this._active ?? [...this.openDocuments][0];
	}
	private _active: vscode.TextDocument | undefined;

	resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): void {
		this.openDocuments.add(document);
		this._active = document;
		webviewPanel.webview.options = { enableScripts: true };

		const update = () => {
			const model = parseModel(document.getText());
			webviewPanel.webview.html = renderDashboard(model, nonce());
		};
		update();

		const changeSub = vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.uri.toString() === document.uri.toString()) {
				update();
			}
		});
		webviewPanel.onDidChangeViewState(e => {
			if (e.webviewPanel.active) {
				this._active = document;
			}
		});
		webviewPanel.onDidDispose(() => {
			changeSub.dispose();
			this.openDocuments.delete(document);
			if (this._active === document) {
				this._active = undefined;
			}
		});
	}
}

interface UpdateInput {
	filePath?: string;
	title?: string;
	subtitle?: string;
	cards?: DashCard[];
}

/** Applies the tool input to a dashboard model. */
function applyUpdate(current: DashModel, input: UpdateInput): DashModel {
	return {
		title: input.title ?? current.title,
		subtitle: input.subtitle ?? current.subtitle,
		cards: input.cards ?? current.cards,
	};
}

class UpdateDashboardTool implements vscode.LanguageModelTool<UpdateInput> {

	constructor(private readonly provider: DashboardEditorProvider) { }

	private async resolveTarget(input: UpdateInput): Promise<vscode.TextDocument | undefined> {
		if (input.filePath) {
			const folders = vscode.workspace.workspaceFolders ?? [];
			for (const folder of folders) {
				const uri = vscode.Uri.joinPath(folder.uri, input.filePath);
				try {
					return await vscode.workspace.openTextDocument(uri);
				} catch {
					// try next folder
				}
			}
			return undefined;
		}
		return this.provider.activeDocument;
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<UpdateInput>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const input = options.input;
		const document = await this.resolveTarget(input);
		if (!document) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
				'No dashboard is open. Open a .dash file first, or pass filePath to a .dash file in the workspace.')]);
		}

		const current = document.getText().trim() ? parseModel(document.getText()) : emptyModel();
		const next = applyUpdate(current, input);

		const edit = new vscode.WorkspaceEdit();
		const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
		edit.replace(document.uri, fullRange, serializeModel(next));
		await vscode.workspace.applyEdit(edit);

		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(
			`Updated dashboard "${next.title}" with ${next.cards.length} card(s).`)]);
	}

	prepareInvocation(_options: vscode.LanguageModelToolInvocationPrepareOptions<UpdateInput>): vscode.PreparedToolInvocation {
		return { invocationMessage: 'Updating dashboard' };
	}
}

export function activate(context: vscode.ExtensionContext) {
	const provider = new DashboardEditorProvider();
	context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
		webviewOptions: { retainContextWhenHidden: true },
		supportsMultipleEditorsPerDocument: false,
	}));
	context.subscriptions.push(vscode.lm.registerTool('junkdrawer_updateDashboard', new UpdateDashboardTool(provider)));
}

export function deactivate() { }
