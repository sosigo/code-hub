/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Junk Drawer Dashboard - resolve a card into its displayed value using the
// current variables and the metric source.

import { DashCard, DashModel, variableValues } from './model';
import { MetricSource } from './metrics';
import { formatCurrency, formatNumber, formatPercent } from './types';

export function resolveCardValue(card: DashCard, model: DashModel, source: MetricSource): string {
	// Static value wins when there's no live metric.
	if (!card.metric) {
		return card.value ?? '';
	}
	const vars = variableValues(model);
	const raw = source.resolve(card.metric, vars);
	const format = card.format ?? (source.isCurrency(card.metric) ? 'currency' : 'number');
	switch (format) {
		case 'currency':
			return formatCurrency(raw, vars['currency'] ?? 'USD');
		case 'percent':
			return formatPercent(raw);
		case 'plain':
			return String(raw);
		case 'number':
		default:
			return formatNumber(raw);
	}
}
