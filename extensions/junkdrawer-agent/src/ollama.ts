/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Junk Drawer Agent - Ollama (local) language model provider and @junk participant backend.

import * as vscode from 'vscode';
import { SimpleMessage, convertMessages, estimateTokens } from './messages';

interface OllamaToolCall {
	id?: string;
	function: { name: string; arguments: object };
}

interface OllamaChatMessage {
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string;
	tool_calls?: OllamaToolCall[];
	tool_name?: string;
}

interface OllamaChatChunk {
	message?: { role: string; content: string; tool_calls?: OllamaToolCall[] };
	done: boolean;
	error?: string;
}

export interface OllamaStreamCallbacks {
	onText(text: string): void;
	onToolCall?(id: string, name: string, input: object): void;
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

export async function streamOllamaChat(url: string, model: string, messages: OllamaChatMessage[], callbacks: OllamaStreamCallbacks, token: vscode.CancellationToken, tools?: object[]): Promise<void> {
	const response = await fetch(`${url}/api/chat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model, messages, stream: true, ...(tools?.length ? { tools } : {}) }),
	});
	if (!response.ok || !response.body) {
		const detail = await response.text().catch(() => '');
		throw new Error(`Ollama error ${response.status}: ${detail}`);
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffered = '';
	let toolCallCount = 0;
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
				callbacks.onText(chunk.message.content);
			}
			for (const call of chunk.message?.tool_calls ?? []) {
				const id = call.id ?? `ollama_call_${Date.now()}_${toolCallCount++}`;
				callbacks.onToolCall?.(id, call.function.name, call.function.arguments ?? {});
			}
		}
	}
	if (token.isCancellationRequested) {
		await reader.cancel().catch(() => undefined);
	}
}

/** Converts provider messages to Ollama chat messages, mapping tool results back to tool names. */
function toOllamaMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): OllamaChatMessage[] {
	const converted = convertMessages(messages);
	const callNames = new Map<string, string>();
	for (const message of converted) {
		for (const call of message.toolCalls) {
			callNames.set(call.id, call.name);
		}
	}

	const out: OllamaChatMessage[] = [];
	for (const message of converted) {
		if (message.role === 'user') {
			for (const result of message.toolResults) {
				out.push({ role: 'tool', content: result.content, tool_name: callNames.get(result.callId) });
			}
			if (message.text) {
				out.push({ role: 'user', content: message.text });
			}
		} else if (message.role === 'assistant') {
			out.push({
				role: 'assistant',
				content: message.text,
				...(message.toolCalls.length ? { tool_calls: message.toolCalls.map(c => ({ id: c.id, function: { name: c.name, arguments: c.input } })) } : {}),
			});
		} else if (message.text) {
			out.push({ role: 'system', content: message.text });
		}
	}
	return out;
}

export function simpleToOllamaMessages(messages: SimpleMessage[]): OllamaChatMessage[] {
	return messages.map(m => ({ role: m.role, content: m.content }));
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

	async provideLanguageModelChatResponse(model: vscode.LanguageModelChatInformation, messages: readonly vscode.LanguageModelChatRequestMessage[], options: vscode.ProvideLanguageModelChatResponseOptions, progress: vscode.Progress<vscode.LanguageModelResponsePart>, token: vscode.CancellationToken): Promise<void> {
		const { url } = getOllamaConfig();
		const tools = options.tools?.map(t => ({
			type: 'function',
			function: {
				name: t.name,
				description: t.description,
				parameters: t.inputSchema ?? { type: 'object', properties: {} },
			},
		}));
		await streamOllamaChat(url, model.id, toOllamaMessages(messages), {
			onText: text => progress.report(new vscode.LanguageModelTextPart(text)),
			onToolCall: (id, name, input) => progress.report(new vscode.LanguageModelToolCallPart(id, name, input)),
		}, token, tools);
	}

	async provideTokenCount(_model: vscode.LanguageModelChatInformation, text: string | vscode.LanguageModelChatRequestMessage, _token: vscode.CancellationToken): Promise<number> {
		return estimateTokens(text);
	}
}
