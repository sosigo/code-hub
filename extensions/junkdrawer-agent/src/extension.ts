/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Junk Drawer Agent - default chat participant with an agentic tool loop, plus
// Ollama (local) and Anthropic (hosted) language model providers.

import * as vscode from 'vscode';
import { AnthropicChatProvider } from './anthropic';
import { OllamaChatProvider, cannotReachOllama, getOllamaConfig, listOllamaModels, simpleToOllamaMessages, streamOllamaChat } from './ollama';

const PARTICIPANT_ID = 'junkdrawer.agent';
const MAX_TOOL_ROUNDS = 25;

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

function availableTools(): vscode.LanguageModelChatTool[] {
	return vscode.lm.tools.map(tool => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema,
	}));
}

async function invokeToolSafely(call: vscode.LanguageModelToolCallPart, request: vscode.ChatRequest, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResultPart> {
	try {
		const result = await vscode.lm.invokeTool(call.name, {
			input: call.input,
			toolInvocationToken: request.toolInvocationToken,
		}, token);
		return new vscode.LanguageModelToolResultPart(call.callId, [...result.content]);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart(`Tool failed: ${message}`)]);
	}
}

/**
 * The agentic loop: send the conversation to the selected model with all
 * registered tools; invoke any tool calls it makes and feed the results back
 * until the model answers with plain text.
 */
async function runAgentLoop(request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<void> {
	const lmMessages: vscode.LanguageModelChatMessage[] = historyToMessages(context)
		.filter(m => m.role !== 'system')
		.map(m => m.role === 'user'
			? vscode.LanguageModelChatMessage.User(m.content)
			: vscode.LanguageModelChatMessage.Assistant(m.content));
	lmMessages.push(vscode.LanguageModelChatMessage.User(request.prompt));

	const tools = availableTools();

	for (let round = 0; round < MAX_TOOL_ROUNDS && !token.isCancellationRequested; round++) {
		const response = await request.model.sendRequest(lmMessages, { tools, toolMode: vscode.LanguageModelChatToolMode.Auto }, token);

		let responseText = '';
		const toolCalls: vscode.LanguageModelToolCallPart[] = [];
		for await (const part of response.stream) {
			if (part instanceof vscode.LanguageModelTextPart) {
				responseText += part.value;
				stream.markdown(part.value);
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				toolCalls.push(part);
			}
		}

		if (!toolCalls.length) {
			return;
		}

		const assistantParts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
		if (responseText) {
			assistantParts.push(new vscode.LanguageModelTextPart(responseText));
		}
		assistantParts.push(...toolCalls);
		lmMessages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));

		const resultParts: vscode.LanguageModelToolResultPart[] = [];
		for (const call of toolCalls) {
			stream.progress(`Running \`${call.name}\``);
			resultParts.push(await invokeToolSafely(call, request, token));
		}
		lmMessages.push(vscode.LanguageModelChatMessage.User(resultParts));
	}

	if (!token.isCancellationRequested) {
		stream.markdown(`\n\n_Stopped after ${MAX_TOOL_ROUNDS} tool rounds._`);
	}
}

async function handleChat(request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<void> {
	if (request.model) {
		try {
			await runAgentLoop(request, context, stream, token);
			return;
		} catch (err) {
			stream.markdown(`Model \`${request.model.name}\` failed: ${err instanceof Error ? err.message : err}\n\nFalling back to local Ollama.\n\n`);
		}
	}

	// Fallback: talk to Ollama directly using the configured model (no tools).
	const { url, model } = getOllamaConfig();
	const messages = [...historyToMessages(context), { role: 'user' as const, content: request.prompt }];
	try {
		await streamOllamaChat(url, model, simpleToOllamaMessages(messages), { onText: text => stream.markdown(text) }, token);
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
