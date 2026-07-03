/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Junk Drawer Agent - shared message conversion helpers.

import * as vscode from 'vscode';

export interface SimpleMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

export interface ConvertedToolCall {
	id: string;
	name: string;
	input: object;
}

export interface ConvertedToolResult {
	callId: string;
	content: string;
}

export interface ConvertedMessage {
	role: 'user' | 'assistant' | 'system';
	text: string;
	toolCalls: ConvertedToolCall[];
	toolResults: ConvertedToolResult[];
}

export function requestMessageToText(message: vscode.LanguageModelChatRequestMessage): string {
	return message.content
		.filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
		.map(part => part.value)
		.join('');
}

export function roleToString(role: vscode.LanguageModelChatMessageRole): SimpleMessage['role'] {
	switch (role) {
		case vscode.LanguageModelChatMessageRole.User: return 'user';
		case vscode.LanguageModelChatMessageRole.Assistant: return 'assistant';
		default: return 'system';
	}
}

function toolResultContentToText(content: readonly unknown[]): string {
	const chunks: string[] = [];
	for (const part of content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			chunks.push(part.value);
		} else if (part && typeof part === 'object') {
			try {
				chunks.push(JSON.stringify(part));
			} catch {
				// unserializable part - skip
			}
		}
	}
	return chunks.join('\n');
}

/**
 * Converts provider request messages into a provider-neutral shape that keeps
 * text, tool calls (assistant) and tool results (user) intact.
 */
export function convertMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): ConvertedMessage[] {
	const converted: ConvertedMessage[] = [];
	for (const message of messages) {
		const out: ConvertedMessage = { role: roleToString(message.role), text: '', toolCalls: [], toolResults: [] };
		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				out.text += part.value;
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				out.toolCalls.push({ id: part.callId, name: part.name, input: part.input ?? {} });
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
				out.toolResults.push({ callId: part.callId, content: toolResultContentToText(part.content) });
			}
		}
		if (out.text || out.toolCalls.length || out.toolResults.length) {
			converted.push(out);
		}
	}
	return converted;
}

export function toSimpleMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): SimpleMessage[] {
	return messages
		.map(m => ({ role: roleToString(m.role), content: requestMessageToText(m) }))
		.filter(m => m.content.length > 0);
}

export function estimateTokens(text: string | vscode.LanguageModelChatRequestMessage): number {
	const value = typeof text === 'string' ? text : requestMessageToText(text);
	return Math.ceil(value.length / 4);
}
