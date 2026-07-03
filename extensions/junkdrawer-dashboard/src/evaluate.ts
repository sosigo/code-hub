/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Junk Drawer Dashboard - resolve each card into its displayed value using the
// current variables. A card is one of: static value, a named mock metric, or a
// live HTTP source (variables substituted into the url).

import { fetchSource } from './http';
import { DashCard, DashModel, variableValues } from './model';
import { MetricSource } from './metrics';
import { formatCurrency, formatNumber, formatPercent } from './types';

function formatRaw(raw: number, format: string, currency: string): string {
	switch (format) {
		case 'currency': return formatCurrency(raw, currency);
		case 'percent': return formatPercent(raw);
		case 'plain': return String(raw);
		case 'number':
		default: return formatNumber(raw);
	}
}

/** Resolve one card to its display string. Async because a source may be fetched. */
export async function resolveCard(card: DashCard, model: DashModel, source: MetricSource): Promise<string> {
	const vars = variableValues(model);

	if (card.source) {
		const result = await fetchSource(card.source, vars);
		if (!result.ok) {
			return `— (${result.error})`;
		}
		const raw = result.value;
		if (typeof raw === 'number') {
			return formatRaw(raw, card.format ?? 'number', vars['currency'] ?? 'USD');
		}
		// Non-numeric payloads (strings, etc.) are shown as-is.
		return raw === undefined || raw === null ? '—' : String(raw);
	}

	if (card.metric) {
		const raw = source.resolve(card.metric, vars);
		const format = card.format ?? (source.isCurrency(card.metric) ? 'currency' : 'number');
		return formatRaw(raw, format, vars['currency'] ?? 'USD');
	}

	return card.value ?? '';
}

/** Resolve all card values in parallel; returns a value string per card, in order. */
export async function resolveCards(model: DashModel, source: MetricSource): Promise<string[]> {
	return Promise.all(model.cards.map(card => resolveCard(card, model, source)));
}
