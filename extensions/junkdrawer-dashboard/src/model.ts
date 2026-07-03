/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Junk Drawer Dashboard - the .dash document model.

export type Accent = 'green' | 'blue' | 'red' | 'neutral';

export interface DashCard {
	label: string;
	value: string;
	hint?: string;
	accent?: Accent;
}

export interface DashModel {
	title: string;
	subtitle?: string;
	cards: DashCard[];
}

export function emptyModel(): DashModel {
	return { title: 'Untitled Dashboard', cards: [] };
}

/** Parse .dash text into a model, tolerating an empty or malformed file. */
export function parseModel(text: string): DashModel {
	const trimmed = text.trim();
	if (!trimmed) {
		return emptyModel();
	}
	let raw: unknown;
	try {
		raw = JSON.parse(trimmed);
	} catch {
		return { title: 'Invalid dashboard', subtitle: 'This .dash file is not valid JSON.', cards: [] };
	}
	const obj = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
	const cards = Array.isArray(obj.cards) ? obj.cards : [];
	return {
		title: typeof obj.title === 'string' ? obj.title : 'Untitled Dashboard',
		subtitle: typeof obj.subtitle === 'string' ? obj.subtitle : undefined,
		cards: cards
			.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
			.map(c => ({
				label: String(c.label ?? ''),
				value: String(c.value ?? ''),
				hint: typeof c.hint === 'string' ? c.hint : undefined,
				accent: (['green', 'blue', 'red', 'neutral'].includes(c.accent as string) ? c.accent : undefined) as Accent | undefined,
			})),
	};
}

export function serializeModel(model: DashModel): string {
	return JSON.stringify(model, null, '\t') + '\n';
}
