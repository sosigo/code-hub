/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Junk Drawer Agent - @junk chat participant plus Ollama (local) and Anthropic
// (hosted) language model providers for the native model picker.

import * as vscode from 'vscode';
import { AnthropicChatProvider } from './anthropic';
import { OllamaChatProvider, cannotReachOllama, getOllamaConfig, listOllamaModels, streamOllamaChat } from './ollama';

const PARTICIPANT_ID = 'junkdrawer.agent';

function historyToMessages(context: vscode.ChatContext): { role: 'user' | 'assistant' | 'system'; content: string }[] {
	const messages: { role: 'user' | 'assistant' | 'system'; content: string }[] = [];
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

async function handleModelsCommand(stream: vscode.ChatResponseStream): Promise<void> {
	const { url } = getOllamaConfig();
	try {
		const models = await listOllamaModels(url);
		stream.markdown(models.length
			? `Installed Ollama models:\n${models.map(m => `- \`${m}\``).join('\n')}`
			: 'No models installed. Run `ollama pull <model>` to get one.');
	} catch {
		stream.markdown(cannotReachOllama(url));
	}
}

async function handleChat(request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<void> {
	const { url, model } = getOllamaConfig();
	const messages = historyToMessages(context);
	messages.push({ role: 'user', content: request.prompt });
	try {
		await streamOllamaChat(url, model, messages, text => stream.markdown(text), token);
	} catch (err) {
		if (err instanceof TypeError) {
			stream.markdown(cannotReachOllama(url));
			return;
		}
		stream.markdown(String(err instanceof Error ? err.message : err));
	}
}

export function activate(context: vscode.ExtensionContext) {
	const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, async (request, chatContext, stream, token) => {
		if (request.command === 'models') {
			await handleModelsCommand(stream);
			return;
		}
		await handleChat(request, chatContext, stream, token);
	});
	participant.iconPath = new vscode.ThemeIcon('archive');
	context.subscriptions.push(participant);

	const ollama = new OllamaChatProvider();
	context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider('ollama', ollama));

	const anthropic = new AnthropicChatProvider(context.secrets);
	context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider('anthropic', anthropic));

	context.subscriptions.push(
		vscode.commands.registerCommand('junkdrawer.anthropic.setApiKey', async () => {
			if (await anthropic.setApiKey()) {
				vscode.window.showInformationMessage('Anthropic API key saved to the OS keychain.');
			}
		}),
		vscode.commands.registerCommand('junkdrawer.anthropic.clearApiKey', async () => {
			await anthropic.clearApiKey();
			vscode.window.showInformationMessage('Anthropic API key removed.');
		}),
	);

	// Nudge the workbench to resolve our models right away so local models are
	// live in the model picker without any sign-in or setup flow.
	setTimeout(() => {
		ollama.refresh();
		anthropic.refresh();
	}, 0);
}

export function deactivate() { }
