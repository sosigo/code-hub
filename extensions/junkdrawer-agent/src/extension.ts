/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Junk Drawer Agent - chat participant backed by a local Ollama server.

import * as vscode from 'vscode';

const PARTICIPANT_ID = 'junkdrawer.agent';

interface OllamaMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

interface OllamaChatChunk {
	message?: { role: string; content: string };
	done: boolean;
	error?: string;
}

function getConfig() {
	const cfg = vscode.workspace.getConfiguration('junkdrawer.ollama');
	return {
		url: cfg.get<string>('url', 'http://localhost:11434').replace(/\/+$/, ''),
		model: cfg.get<string>('model', 'llama3.2:3b'),
	};
}

async function listModels(url: string): Promise<string[]> {
	const res = await fetch(`${url}/api/tags`);
	if (!res.ok) {
		throw new Error(`Ollama responded with ${res.status}`);
	}
	const data = await res.json() as { models?: { name: string }[] };
	return (data.models ?? []).map(m => m.name);
}

function historyToMessages(context: vscode.ChatContext): OllamaMessage[] {
	const messages: OllamaMessage[] = [];
	for (const turn of context.history) {
		if (turn instanceof vscode.ChatRequestTurn) {
			messages.push({ role: 'user', content: turn.prompt });
		} else if (turn instanceof vscode.ChatResponseTurn) {
			const text = turn.response
				.filter((part): part is vscode.ChatResponseMarkdownPart => part instanceof vscode.ChatResponseMarkdownPart)
				.map(part => part.value.value)
				.join('');
			if (text) {
				messages.push({ role: 'assistant', content: text });
			}
		}
	}
	return messages;
}

function cannotReach(url: string): string {
	return `Can't reach Ollama at \`${url}\`. Is \`ollama serve\` running?`;
}

async function handleModelsCommand(url: string, stream: vscode.ChatResponseStream): Promise<void> {
	try {
		const models = await listModels(url);
		stream.markdown(models.length
			? `Installed Ollama models:\n${models.map(m => `- \`${m}\``).join('\n')}`
			: 'No models installed. Run `ollama pull <model>` to get one.');
	} catch {
		stream.markdown(cannotReach(url));
	}
}

async function handleChat(request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<void> {
	const { url, model } = getConfig();

	const messages = historyToMessages(context);
	messages.push({ role: 'user', content: request.prompt });

	let response: Response;
	try {
		response = await fetch(`${url}/api/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model, messages, stream: true }),
		});
	} catch {
		stream.markdown(cannotReach(url));
		return;
	}
	if (!response.ok || !response.body) {
		const detail = await response.text().catch(() => '');
		stream.markdown(`Ollama error ${response.status}: ${detail}`);
		return;
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
				stream.markdown(`\n\nOllama error: ${chunk.error}`);
				return;
			}
			if (chunk.message?.content) {
				stream.markdown(chunk.message.content);
			}
		}
	}
	if (token.isCancellationRequested) {
		await reader.cancel().catch(() => undefined);
	}
}

function requestMessageToText(message: vscode.LanguageModelChatRequestMessage): string {
	return message.content
		.filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
		.map(part => part.value)
		.join('');
}

function roleToOllama(role: vscode.LanguageModelChatMessageRole): OllamaMessage['role'] {
	switch (role) {
		case vscode.LanguageModelChatMessageRole.User: return 'user';
		case vscode.LanguageModelChatMessageRole.Assistant: return 'assistant';
		default: return 'system';
	}
}

class OllamaChatProvider implements vscode.LanguageModelChatProvider {

	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

	refresh(): void {
		this._onDidChange.fire();
	}

	async provideLanguageModelChatInformation(_options: vscode.PrepareLanguageModelChatModelOptions, _token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[]> {
		const { url } = getConfig();
		let models: string[];
		try {
			models = await listModels(url);
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
		const { url } = getConfig();
		const ollamaMessages: OllamaMessage[] = messages
			.map(m => ({ role: roleToOllama(m.role), content: requestMessageToText(m) }))
			.filter(m => m.content.length > 0);

		const response = await fetch(`${url}/api/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: model.id, messages: ollamaMessages, stream: true }),
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
					progress.report(new vscode.LanguageModelTextPart(chunk.message.content));
				}
			}
		}
		if (token.isCancellationRequested) {
			await reader.cancel().catch(() => undefined);
		}
	}

	async provideTokenCount(_model: vscode.LanguageModelChatInformation, text: string | vscode.LanguageModelChatRequestMessage, _token: vscode.CancellationToken): Promise<number> {
		const value = typeof text === 'string' ? text : requestMessageToText(text);
		return Math.ceil(value.length / 4);
	}
}

export function activate(context: vscode.ExtensionContext) {
	const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, async (request, chatContext, stream, token) => {
		if (request.command === 'models') {
			await handleModelsCommand(getConfig().url, stream);
			return;
		}
		await handleChat(request, chatContext, stream, token);
	});
	participant.iconPath = new vscode.ThemeIcon('archive');
	context.subscriptions.push(participant);

	const provider = new OllamaChatProvider();
	context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider('ollama', provider));
	// Nudge the workbench to resolve our models right away so local models are
	// live in the model picker without any sign-in or setup flow.
	setTimeout(() => provider.refresh(), 0);
}

export function deactivate() { }
