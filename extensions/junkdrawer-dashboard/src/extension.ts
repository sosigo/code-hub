/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Junk Drawer Dashboard - renders .dash files as command-center panels with an
// interactive typed-variable bar, and exposes an agent tool
// (junkdrawer_updateDashboard) so a chat agent can drive them. Everything the
// agent needs - the variables, their allowed values, the metrics - lives in the
// .dash file, so the file is both the render target and the agent's context.

import * as vscode from 'vscode';
import { resolveCards } from './evaluate';
import { mockMetricSource } from './metrics';
import { DashCard, DashModel, emptyModel, parseModel, serializeModel } from './model';
import { renderDashboard } from './render';
import { allowedOptions, typeCatalog, validateValue, VariableDef } from './types';

const VIEW_TYPE = 'junkdrawer.dashboard';

function nonce(): string {
	let text = '';
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}

/** Replace the whole document text with the serialized model. */
async function writeModel(document: vscode.TextDocument, model: DashModel): Promise<void> {
	const edit = new vscode.WorkspaceEdit();
	const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
	edit.replace(document.uri, fullRange, serializeModel(model));
	await vscode.workspace.applyEdit(edit);
}

class DashboardEditorProvider implements vscode.CustomTextEditorProvider {

	private readonly openDocuments = new Set<vscode.TextDocument>();
	private _active: vscode.TextDocument | undefined;

	get activeDocument(): vscode.TextDocument | undefined {
		return this._active ?? [...this.openDocuments][0];
	}

	resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): void {
		this.openDocuments.add(document);
		this._active = document;
		webviewPanel.webview.options = { enableScripts: true };

		let renderToken = 0;
		const update = async () => {
			const token = ++renderToken;
			const model = parseModel(document.getText());
			// Paint an immediate skeleton (source-backed cards show a spinner value)
			// so the panel is responsive while any HTTP fetches resolve.
			const hasSource = model.cards.some(c => c.source);
			if (hasSource) {
				const skeleton = model.cards.map(c => c.source ? '…' : '');
				webviewPanel.webview.html = renderDashboard(model, skeleton, nonce());
			}
			const values = await resolveCards(model, mockMetricSource);
			if (token !== renderToken) {
				return; // a newer update superseded this one
			}
			webviewPanel.webview.html = renderDashboard(model, values, nonce());
		};
		void update();

		const changeSub = vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.uri.toString() === document.uri.toString()) {
				void update();
			}
		});

		// Human changed a variable via a dropdown/input in the panel -> validate
		// and write it back into the file (which re-renders).
		const messageSub = webviewPanel.webview.onDidReceiveMessage(async (message: { type: string; name?: string; value?: string }) => {
			if (message.type !== 'setVar' || !message.name) {
				return;
			}
			const model = parseModel(document.getText());
			const def = model.variables.find(v => v.name === message.name);
			if (!def) {
				return;
			}
			const result = validateValue(def, message.value ?? '');
			if (result.ok && result.value !== undefined) {
				def.value = result.value;
				await writeModel(document, model);
			} else {
				vscode.window.showWarningMessage(`Junk Drawer: ${result.error ?? 'Invalid value.'}`);
				void update(); // revert the control to the stored value
			}
		});

		webviewPanel.onDidChangeViewState(e => {
			if (e.webviewPanel.active) {
				this._active = document;
			}
		});
		webviewPanel.onDidDispose(() => {
			changeSub.dispose();
			messageSub.dispose();
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
	variables?: VariableDef[];
	setVariables?: Record<string, string>;
	cards?: DashCard[];
}

class UpdateDashboardTool implements vscode.LanguageModelTool<UpdateInput> {

	constructor(private readonly provider: DashboardEditorProvider) { }

	private async resolveTarget(input: UpdateInput): Promise<vscode.TextDocument | undefined> {
		if (input.filePath) {
			for (const folder of vscode.workspace.workspaceFolders ?? []) {
				try {
					return await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, input.filePath));
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

		const model = document.getText().trim() ? parseModel(document.getText()) : emptyModel();

		if (input.title !== undefined) { model.title = input.title; }
		if (input.subtitle !== undefined) { model.subtitle = input.subtitle; }
		if (input.variables) { model.variables = input.variables; }
		if (input.cards) { model.cards = input.cards; }

		// Patch individual variable values, validated against their declared type.
		const errors: string[] = [];
		if (input.setVariables) {
			for (const [name, value] of Object.entries(input.setVariables)) {
				const def = model.variables.find(v => v.name === name);
				if (!def) {
					errors.push(`Unknown variable "${name}". Declared variables: ${model.variables.map(v => v.name).join(', ') || '(none)'}.`);
					continue;
				}
				const result = validateValue(def, value);
				if (result.ok && result.value !== undefined) {
					def.value = result.value;
				} else {
					const allowed = result.allowed ?? allowedOptions(def)?.map(o => o.value) ?? [];
					errors.push(`${result.error ?? `Invalid value for ${name}.`}${allowed.length ? ` Allowed: ${allowed.join(', ')}.` : ''}`);
				}
			}
		}

		await writeModel(document, model);

		const summary = `Updated dashboard "${model.title}": ${model.variables.length} variable(s), ${model.cards.length} card(s).`;
		const text = errors.length ? `${summary}\nSome changes were rejected:\n- ${errors.join('\n- ')}` : summary;
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
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

	// Surface the typed-variable catalog once for logs / debugging.
	void typeCatalog();
}

export function deactivate() { }
