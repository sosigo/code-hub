/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Junk Drawer Dashboard - the typed variable system. A dashboard variable
// declares a type; the type carries the set of allowed values (or the numeric
// constraints). This is what lets both the human (via dropdowns) and the agent
// (via the update tool) know exactly what a variable can be set to, and it's
// all declared in the .dash file itself so the agent reads it as context.

export type VarType = 'period' | 'currency' | 'enum' | 'number' | 'boolean' | 'string';

export interface Option {
	readonly value: string;
	readonly label: string;
}

/**
 * Time-window periods, minute-granularity through all-time. `days` is the
 * approximate window length used to scale flow metrics (e.g. revenue over the
 * window); calendar-relative entries use a representative average.
 */
export const PERIOD_OPTIONS: readonly (Option & { days: number })[] = [
	{ value: '5m', label: '5 minutes', days: 5 / 1440 },
	{ value: '15m', label: '15 minutes', days: 15 / 1440 },
	{ value: '1h', label: '1 hour', days: 1 / 24 },
	{ value: '6h', label: '6 hours', days: 6 / 24 },
	{ value: '24h', label: '24 hours', days: 1 },
	{ value: '7d', label: '7 days', days: 7 },
	{ value: '14d', label: '14 days', days: 14 },
	{ value: '30d', label: '30 days', days: 30 },
	{ value: '90d', label: '90 days', days: 90 },
	{ value: 'mtd', label: 'Month to date', days: 15 },
	{ value: 'qtd', label: 'Quarter to date', days: 45 },
	{ value: 'ytd', label: 'Year to date', days: 182 },
	{ value: '12mo', label: '12 months', days: 365 },
	{ value: 'all', label: 'All time', days: 1000 },
];

/**
 * Currencies with display symbol, decimal precision, and a static rate relative
 * to USD (the canonical unit metric values are stored in). Crypto entries carry
 * higher precision. Rates are illustrative, not live.
 */
export const CURRENCY_OPTIONS: readonly (Option & { symbol: string; decimals: number; rate: number })[] = [
	{ value: 'USD', label: 'US Dollar', symbol: '$', decimals: 2, rate: 1 },
	// allow-any-unicode-next-line
	{ value: 'EUR', label: 'Euro', symbol: '€', decimals: 2, rate: 0.92 },
	// allow-any-unicode-next-line
	{ value: 'GBP', label: 'British Pound', symbol: '£', decimals: 2, rate: 0.79 },
	// allow-any-unicode-next-line
	{ value: 'JPY', label: 'Japanese Yen', symbol: '¥', decimals: 0, rate: 157 },
	{ value: 'CAD', label: 'Canadian Dollar', symbol: 'C$', decimals: 2, rate: 1.37 },
	{ value: 'AUD', label: 'Australian Dollar', symbol: 'A$', decimals: 2, rate: 1.52 },
	{ value: 'CHF', label: 'Swiss Franc', symbol: 'Fr', decimals: 2, rate: 0.89 },
	// allow-any-unicode-next-line
	{ value: 'CNY', label: 'Chinese Yuan', symbol: '¥', decimals: 2, rate: 7.24 },
	// allow-any-unicode-next-line
	{ value: 'INR', label: 'Indian Rupee', symbol: '₹', decimals: 2, rate: 83.4 },
	{ value: 'BRL', label: 'Brazilian Real', symbol: 'R$', decimals: 2, rate: 5.1 },
	{ value: 'MXN', label: 'Mexican Peso', symbol: 'Mex$', decimals: 2, rate: 17.0 },
	// allow-any-unicode-next-line
	{ value: 'BTC', label: 'Bitcoin', symbol: '₿', decimals: 6, rate: 0.0000095 },
	// allow-any-unicode-next-line
	{ value: 'ETH', label: 'Ethereum', symbol: 'Ξ', decimals: 5, rate: 0.00028 },
];

export interface VariableDef {
	readonly name: string;
	readonly type: VarType;
	value: string;
	readonly label?: string;
	/** Options for a custom `enum` type. Ignored for built-in typed variables. */
	readonly options?: readonly Option[];
	/** Constraints for a `number` type. */
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
}

/** The allowed option set for a variable, or `null` for free numeric/string input. */
export function allowedOptions(def: VariableDef): readonly Option[] | null {
	switch (def.type) {
		case 'period':
			return PERIOD_OPTIONS.map(o => ({ value: o.value, label: o.label }));
		case 'currency':
			return CURRENCY_OPTIONS.map(o => ({ value: o.value, label: `${o.label} (${o.symbol})` }));
		case 'enum':
			return def.options ?? [];
		case 'boolean':
			return [{ value: 'true', label: 'On' }, { value: 'false', label: 'Off' }];
		default:
			return null;
	}
}

export interface ValidationResult {
	readonly ok: boolean;
	readonly value?: string;
	readonly error?: string;
	readonly allowed?: readonly string[];
}

export function validateValue(def: VariableDef, raw: string): ValidationResult {
	const value = String(raw).trim();
	if (def.type === 'number') {
		const n = Number(value);
		if (!Number.isFinite(n)) {
			return { ok: false, error: `"${value}" is not a number.` };
		}
		if (def.min !== undefined && n < def.min) {
			return { ok: false, error: `Must be >= ${def.min}.` };
		}
		if (def.max !== undefined && n > def.max) {
			return { ok: false, error: `Must be <= ${def.max}.` };
		}
		return { ok: true, value: String(n) };
	}
	if (def.type === 'string') {
		return { ok: true, value };
	}
	const options = allowedOptions(def);
	if (!options) {
		return { ok: true, value };
	}
	const match = options.find(o => o.value === value);
	if (!match) {
		return {
			ok: false,
			error: `"${value}" is not allowed for ${def.name} (type ${def.type}).`,
			allowed: options.map(o => o.value),
		};
	}
	return { ok: true, value: match.value };
}

/** How many days a `period` value represents (for scaling flow metrics). */
export function periodDays(value: string): number {
	return PERIOD_OPTIONS.find(o => o.value === value)?.days ?? 30;
}

export function currencyInfo(code: string) {
	return CURRENCY_OPTIONS.find(o => o.value === code) ?? CURRENCY_OPTIONS[0];
}

function groupThousands(intPart: string): string {
	const negative = intPart.startsWith('-');
	const digits = negative ? intPart.slice(1) : intPart;
	const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	return negative ? `-${grouped}` : grouped;
}

/** Format a USD-canonical amount into the given currency code. */
export function formatCurrency(amountUsd: number, code: string): string {
	const cur = currencyInfo(code);
	const converted = amountUsd * cur.rate;
	const fixed = converted.toFixed(cur.decimals);
	const [intPart, fracPart] = fixed.split('.');
	const grouped = groupThousands(intPart);
	return cur.symbol + grouped + (fracPart ? '.' + fracPart : '');
}

export function formatNumber(n: number): string {
	const rounded = Math.round(n * 100) / 100;
	const [intPart, fracPart] = String(rounded).split('.');
	return groupThousands(intPart) + (fracPart ? '.' + fracPart : '');
}

export function formatPercent(n: number): string {
	return `${Math.round(n * 100) / 100}%`;
}

/**
 * A human-readable catalog of the built-in typed variables and their allowed
 * values. Surfaced to the agent (in the tool description) and usable anywhere a
 * summary of "what can this be set to" is needed.
 */
export function typeCatalog(): string {
	const periods = PERIOD_OPTIONS.map(o => o.value).join(', ');
	const currencies = CURRENCY_OPTIONS.map(o => o.value).join(', ');
	return [
		`period (a time window) accepts: ${periods}.`,
		`currency accepts: ${currencies}.`,
		`enum accepts one of its declared options; number accepts any number within its min/max; boolean accepts true/false; string accepts free text.`,
	].join(' ');
}
