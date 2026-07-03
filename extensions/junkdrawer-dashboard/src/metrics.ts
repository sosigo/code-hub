/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Junk Drawer Dashboard - the metric resolution layer. A card can name a
// `metric`; this module turns that name + the current variable values into a
// number. Today it's a deterministic mock so the loop is real (changing period
// or currency visibly changes the numbers) without a live backend. A real data
// source (Postgres, an API, etc.) slots in behind the same resolveMetric shape.

import { periodDays } from './types';

type MetricKind = 'flow' | 'stock' | 'rate';

interface MetricDef {
	readonly base: number;
	readonly kind: MetricKind;
	/** true when the metric is a money amount (USD-canonical) to be currency-formatted. */
	readonly currency?: boolean;
}

const METRICS: Record<string, MetricDef> = {
	mrr: { base: 2400, kind: 'flow', currency: true },
	arr: { base: 28800, kind: 'stock', currency: true },
	revenue: { base: 8200, kind: 'flow', currency: true },
	users: { base: 47, kind: 'flow' },
	signups: { base: 47, kind: 'flow' },
	sessions: { base: 1280, kind: 'flow' },
	mau: { base: 3100, kind: 'stock' },
	churn: { base: 3.2, kind: 'rate' },
	conversion: { base: 2.8, kind: 'rate' },
	nps: { base: 42, kind: 'rate' },
};

/** Stable pseudo-value for an unknown metric name, so any name resolves. */
function seededBase(metric: string): number {
	let hash = 0;
	for (let i = 0; i < metric.length; i++) {
		hash = (hash * 31 + metric.charCodeAt(i)) & 0xffffff;
	}
	return 100 + (hash % 9000);
}

export interface MetricSource {
	/** Resolve a metric to a USD-canonical / plain number given current variables. */
	resolve(metric: string, variables: Record<string, string>): number;
	/** Whether this metric should be currency-formatted by default. */
	isCurrency(metric: string): boolean;
}

/** The built-in deterministic mock source. */
export const mockMetricSource: MetricSource = {
	resolve(metric: string, variables: Record<string, string>): number {
		const def = METRICS[metric] ?? { base: seededBase(metric), kind: 'flow' as MetricKind };
		const period = variables['period'] ?? '30d';
		const days = periodDays(period);

		switch (def.kind) {
			case 'rate':
				// Rates (churn, conversion) don't scale with the window.
				return def.base;
			case 'stock': {
				// Stock metrics (ARR, MAU) grow slowly with the window.
				const factor = 0.7 + 0.3 * Math.sqrt(days / 30);
				return def.base * factor;
			}
			case 'flow':
			default:
				// Flow metrics (revenue, signups) scale roughly with the window.
				return def.base * (days / 30);
		}
	},
	isCurrency(metric: string): boolean {
		return METRICS[metric]?.currency ?? false;
	},
};
