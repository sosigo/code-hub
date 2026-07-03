/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Junk Drawer Agent - Anthropic API language model provider.
// Uses raw fetch/SSE (no SDK) so this built-in extension stays dependency-free,
// matching the Ollama provider. The API key lives in SecretStorage (OS keychain).

import * as vscode from 'vscode';
import { SimpleMessage, estimateTokens, toSimpleMessages } from './messages';

const API_KEY_SECRET = 'junkdrawer.anthropic.apiKey';
const API_BASE = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';

interface AnthropicModel {
	id: string;
	display_name: string;
	max_input_tokens?: number;
	max_tokens?: number;
	capabilities?: {
		image_input?: { supported?: boolean };
	};
}

interface AnthropicSseEvent {
	type: string;
	delta?: { type: string; text?: string; stop_reason?: string };
	error?: { type: string; message: string };
	message?: { stop_reason?: string };
}

export class AnthropicChatProvider implements vscode.LanguageModelChatProvider {

	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

	constructor(private readonly secrets: vscode.SecretStorage) { }

	refresh(): void {
		this._onDidChange.fire();
	}

	async getApiKey(): Promise<string | undefined> {
		return this.secrets.get(API_KEY_SECRET);
	}

	async setApiKey(): Promise<boolean> {
		const key = await vscode.window.showInputBox({
			title: 'Anthropic API Key',
			prompt: 'Stored securely in the OS keychain. Get one at console.anthropic.com.',
			password: true,
			ignoreFocusOut: true,
			placeHolder: 'sk-ant-...',
		});
		if (!key) {
			return false;
		}
		await this.secrets.store(API_KEY_SECRET, key.trim());
		this.refresh();
		return true;
	}

	async clearApiKey(): Promise<void> {
		await this.secrets.delete(API_KEY_SECRET);
		this.refresh();
	}

	async provideLanguageModelChatInformation(options: vscode.PrepareLanguageModelChatModelOptions, _token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[]> {
		let apiKey = await this.getApiKey();
		if (!apiKey) {
			if (options.silent) {
				return [];
			}
			if (!await this.setApiKey()) {
				return [];
			}
			apiKey = await this.getApiKey();
			if (!apiKey) {
				return [];
			}
		}

		let models: AnthropicModel[];
		try {
			const res = await fetch(`${API_BASE}/v1/models?limit=50`, {
				headers: { 'x-api-key': apiKey, 'anthropic-version': API_VERSION },
			});
			if (!res.ok) {
				throw new Error(`Anthropic responded with ${res.status}`);
			}
			const data = await res.json() as { data?: AnthropicModel[] };
			models = data.data ?? [];
		} catch {
			return [];
		}

		return models
			.filter(m => m.id.startsWith('claude-'))
			.map(m => ({
				id: m.id,
				name: m.display_name || m.id,
				family: m.id.replace(/-\d{8}$/, ''),
				version: m.id,
				detail: 'Anthropic',
				tooltip: `${m.display_name || m.id} via the Anthropic API`,
				maxInputTokens: m.max_input_tokens ?? 200000,
				maxOutputTokens: m.max_tokens ?? 8192,
				capabilities: {
					imageInput: m.capabilities?.image_input?.supported ?? true,
					toolCalling: true,
				},
			}));
	}

	async provideLanguageModelChatResponse(model: vscode.LanguageModelChatInformation, messages: readonly vscode.LanguageModelChatRequestMessage[], _options: vscode.ProvideLanguageModelChatResponseOptions, progress: vscode.Progress<vscode.LanguageModelResponsePart>, token: vscode.CancellationToken): Promise<void> {
		const apiKey = await this.getApiKey();
		if (!apiKey) {
			throw new Error('No Anthropic API key set. Run "Junk Drawer: Set Anthropic API Key".');
		}

		const simple = toSimpleMessages(messages);
		const system = simple.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
		const conversation: SimpleMessage[] = simple.filter(m => m.role !== 'system');

		const response = await fetch(`${API_BASE}/v1/messages`, {
			method: 'POST',
			headers: {
				'x-api-key': apiKey,
				'anthropic-version': API_VERSION,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: model.id,
				max_tokens: Math.min(model.maxOutputTokens, 64000),
				stream: true,
				...(system ? { system } : {}),
				messages: conversation,
			}),
		});
		if (!response.ok || !response.body) {
			const detail = await response.text().catch(() => '');
			throw new Error(`Anthropic error ${response.status}: ${detail}`);
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffered = '';
		let stopReason: string | undefined;
		while (!token.isCancellationRequested) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			buffered += decoder.decode(value, { stream: true });
			const lines = buffered.split('\n');
			buffered = lines.pop() ?? '';
			for (const line of lines) {
				if (!line.startsWith('data:')) {
					continue;
				}
				let event: AnthropicSseEvent;
				try {
					event = JSON.parse(line.slice(5).trim());
				} catch {
					continue;
				}
				if (event.type === 'error' && event.error) {
					throw new Error(`Anthropic error: ${event.error.message}`);
				}
				if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
					progress.report(new vscode.LanguageModelTextPart(event.delta.text));
				}
				if (event.type === 'message_delta' && event.delta?.stop_reason) {
					stopReason = event.delta.stop_reason;
				}
			}
		}
		if (token.isCancellationRequested) {
			await reader.cancel().catch(() => undefined);
			return;
		}
		if (stopReason === 'refusal') {
			progress.report(new vscode.LanguageModelTextPart('\n\n_The request was declined by Anthropic safety classifiers._'));
		}
	}

	async provideTokenCount(_model: vscode.LanguageModelChatInformation, text: string | vscode.LanguageModelChatRequestMessage, _token: vscode.CancellationToken): Promise<number> {
		return estimateTokens(text);
	}
}
