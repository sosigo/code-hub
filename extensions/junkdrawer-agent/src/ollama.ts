/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Junk Drawer Agent - Ollama (local) language model provider and @junk participant backend.

import * as vscode from 'vscode';
import { SimpleMessage, estimateTokens, toSimpleMessages } from './messages';

interface OllamaChatChunk {
	message?: { role: string; content: string };
	done: boolean;
	error?: string;
}

export function getOllamaConfig() {
	const cfg = vscode.workspace.getConfiguration('junkdrawer.ollama');
	return {
		url: cfg.get<string>('url', 'http://localhost:11434').replace(/\/+$/, ''),
		model: cfg.get<string>('model', 'llama3.2:3b'),
	};
}

export async function listOllamaModels(url: string): Promise<string[]> {
	const res = await fetch(`${url}/api/tags`);
	if (!res.ok) {
		throw new Error(`Ollama responded with ${res.status}`);
	}
	const data = await res.json() as { models?: { name: string }[] };
	return (data.models ?? []).map(m => m.name);
}

export function cannotReachOllama(url: string): string {
	return `Can't reach Ollama at \`${url}\`. Is \`ollama serve\` running?`;
}

export async function streamOllamaChat(url: string, model: string, messages: SimpleMessage[], onText: (text: string) => void, token: vscode.CancellationToken): Promise<void> {
	const response = await fetch(`${url}/api/chat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model, messages, stream: true }),
	});
	if (!response.ok || !response.body) {
		const detail = await response.text().catch(() => '');
		throw new Error(`Ollama error ${response.status}: ${detail}`);
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffered = '';
	while (!token.isCancellationRequested) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		buffered += decoder.decode(value, { stream: true });
		const lines = buffered.split('\n');
		buffered = lines.pop() ?? '';
		for (const line of lines) {
			if (!line.trim()) {
				continue;
			}
			let chunk: OllamaChatChunk;
			try {
				chunk = JSON.parse(line);
			} catch {
				continue;
			}
			if (chunk.error) {
				throw new Error(`Ollama error: ${chunk.error}`);
			}
			if (chunk.message?.content) {
				onText(chunk.message.content);
			}
		}
	}
	if (token.isCancellationRequested) {
		await reader.cancel().catch(() => undefined);
	}
}

export class OllamaChatProvider implements vscode.LanguageModelChatProvider {

	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

	refresh(): void {
		this._onDidChange.fire();
	}

	async provideLanguageModelChatInformation(_options: vscode.PrepareLanguageModelChatModelOptions, _token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[]> {
		const { url } = getOllamaConfig();
		let models: string[];
		try {
			models = await listOllamaModels(url);
		} catch {
			return [];
		}
		return models.map(name => ({
			id: name,
			name,
			family: name.split(':')[0],
			version: name.split(':')[1] ?? 'latest',
			detail: 'Ollama (local)',
			tooltip: `Local model \`${name}\` served by Ollama at ${url}`,
			maxInputTokens: 16384,
			maxOutputTokens: 4096,
			capabilities: {
				imageInput: false,
				toolCalling: true,
			},
		}));
	}

	async provideLanguageModelChatResponse(model: vscode.LanguageModelChatInformation, messages: readonly vscode.LanguageModelChatRequestMessage[], _options: vscode.ProvideLanguageModelChatResponseOptions, progress: vscode.Progress<vscode.LanguageModelResponsePart>, token: vscode.CancellationToken): Promise<void> {
		const { url } = getOllamaConfig();
		await streamOllamaChat(url, model.id, toSimpleMessages(messages), text => {
			progress.report(new vscode.LanguageModelTextPart(text));
		}, token);
	}

	async provideTokenCount(_model: vscode.LanguageModelChatInformation, text: string | vscode.LanguageModelChatRequestMessage, _token: vscode.CancellationToken): Promise<number> {
		return estimateTokens(text);
	}
}
