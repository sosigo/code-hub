/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Junk Drawer Dashboard - the .dash document model. A dashboard is a single
// self-describing file: its typed variables, its cards (each either a static
// value or a live metric), title and subtitle. Everything the agent needs to
// read or change is here.

import { HttpSource } from './http';
import { VarType, VariableDef } from './types';

export type Accent = 'green' | 'blue' | 'red' | 'neutral';
export type CardFormat = 'currency' | 'number' | 'percent' | 'plain';

export interface DashCard {
	label: string;
	/** Static display value. Used when `metric` and `source` are absent. */
	value?: string;
	/** A live metric name resolved against the current variables (built-in mock source). */
	metric?: string;
	/** A live HTTP endpoint. Variables are substituted into the url. */
	source?: HttpSource;
	format?: CardFormat;
	hint?: string;
	/** Optional trend indicator, e.g. "+12%" or "-3%". */
	delta?: string;
	accent?: Accent;
}

export interface DashModel {
	title: string;
	subtitle?: string;
	variables: VariableDef[];
	cards: DashCard[];
}

export function emptyModel(): DashModel {
	return { title: 'Untitled Dashboard', variables: [], cards: [] };
}

const VAR_TYPES: VarType[] = ['period', 'currency', 'enum', 'number', 'boolean', 'string'];
const ACCENTS: Accent[] = ['green', 'blue', 'red', 'neutral'];
const FORMATS: CardFormat[] = ['currency', 'number', 'percent', 'plain'];

function parseVariable(raw: unknown): VariableDef | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const o = raw as Record<string, unknown>;
	const name = typeof o.name === 'string' ? o.name : undefined;
	const type = VAR_TYPES.includes(o.type as VarType) ? o.type as VarType : undefined;
	if (!name || !type) {
		return undefined;
	}
	const def: VariableDef = {
		name,
		type,
		value: o.value !== undefined ? String(o.value) : '',
		label: typeof o.label === 'string' ? o.label : undefined,
		options: Array.isArray(o.options)
			? o.options
				.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
				.map(x => ({ value: String(x.value ?? ''), label: String(x.label ?? x.value ?? '') }))
			: undefined,
		min: typeof o.min === 'number' ? o.min : undefined,
		max: typeof o.max === 'number' ? o.max : undefined,
		step: typeof o.step === 'number' ? o.step : undefined,
	};
	return def;
}

function parseCard(raw: unknown): DashCard | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const o = raw as Record<string, unknown>;
	let source: DashCard['source'];
	if (o.source && typeof o.source === 'object') {
		const s = o.source as Record<string, unknown>;
		if (typeof s.url === 'string') {
			source = { url: s.url, path: typeof s.path === 'string' ? s.path : undefined };
		}
	}
	return {
		label: String(o.label ?? ''),
		value: o.value !== undefined ? String(o.value) : undefined,
		metric: typeof o.metric === 'string' ? o.metric : undefined,
		source,
		format: FORMATS.includes(o.format as CardFormat) ? o.format as CardFormat : undefined,
		hint: typeof o.hint === 'string' ? o.hint : undefined,
		delta: typeof o.delta === 'string' ? o.delta : undefined,
		accent: ACCENTS.includes(o.accent as Accent) ? o.accent as Accent : undefined,
	};
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
		return { title: 'Invalid dashboard', subtitle: 'This .dash file is not valid JSON.', variables: [], cards: [] };
	}
	const obj = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
	return {
		title: typeof obj.title === 'string' ? obj.title : 'Untitled Dashboard',
		subtitle: typeof obj.subtitle === 'string' ? obj.subtitle : undefined,
		variables: (Array.isArray(obj.variables) ? obj.variables : []).map(parseVariable).filter((v): v is VariableDef => !!v),
		cards: (Array.isArray(obj.cards) ? obj.cards : []).map(parseCard).filter((c): c is DashCard => !!c),
	};
}

export function serializeModel(model: DashModel): string {
	// Emit only defined fields so the file stays clean and diff-friendly.
	const out: Record<string, unknown> = { title: model.title };
	if (model.subtitle) {
		out.subtitle = model.subtitle;
	}
	if (model.variables.length) {
		out.variables = model.variables.map(v => {
			const vo: Record<string, unknown> = { name: v.name, type: v.type, value: v.value };
			if (v.label) { vo.label = v.label; }
			if (v.options) { vo.options = v.options; }
			if (v.min !== undefined) { vo.min = v.min; }
			if (v.max !== undefined) { vo.max = v.max; }
			if (v.step !== undefined) { vo.step = v.step; }
			return vo;
		});
	}
	out.cards = model.cards.map(c => {
		const co: Record<string, unknown> = { label: c.label };
		if (c.metric) { co.metric = c.metric; }
		if (c.source) { co.source = c.source.path ? { url: c.source.url, path: c.source.path } : { url: c.source.url }; }
		if (c.value !== undefined) { co.value = c.value; }
		if (c.format) { co.format = c.format; }
		if (c.hint) { co.hint = c.hint; }
		if (c.delta) { co.delta = c.delta; }
		if (c.accent) { co.accent = c.accent; }
		return co;
	});
	return JSON.stringify(out, null, '\t') + '\n';
}

/** The current variable values as a flat map, for metric resolution. */
export function variableValues(model: DashModel): Record<string, string> {
	const map: Record<string, string> = {};
	for (const v of model.variables) {
		map[v.name] = v.value;
	}
	return map;
}
