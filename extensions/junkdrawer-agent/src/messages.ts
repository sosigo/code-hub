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

export function toSimpleMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): SimpleMessage[] {
	return messages
		.map(m => ({ role: roleToString(m.role), content: requestMessageToText(m) }))
		.filter(m => m.content.length > 0);
}

export function estimateTokens(text: string | vscode.LanguageModelChatRequestMessage): number {
	const value = typeof text === 'string' ? text : requestMessageToText(text);
	return Math.ceil(value.length / 4);
}
