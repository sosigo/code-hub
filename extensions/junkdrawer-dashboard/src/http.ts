/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Junk Drawer Dashboard - live HTTP data source. A card can declare a `source`
// { url, path }: the dashboard's variables are substituted into the URL (so the
// variables literally inform the query), the endpoint is fetched, and a value is
// extracted from the JSON response by a dot/bracket path. Results are cached
// briefly and keyed by the resolved URL so changing a variable refetches.

export interface HttpSource {
	url: string;
	/** Dot/bracket path into the JSON response, e.g. "data.mrr" or "results[0].count". */
	path?: string;
}

interface CacheEntry {
	value: unknown;
	at: number;
}

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, CacheEntry>();

/**
 * Substitute {var} placeholders in a template with the current variable values.
 * Values are URL-encoded but forward slashes are preserved, so a value like
 * "microsoft/vscode" works in a path segment while spaces/&/? are still escaped.
 */
export function substituteVariables(template: string, variables: Record<string, string>): string {
	return template.replace(/\{(\w+)\}/g, (match, name: string) =>
		Object.prototype.hasOwnProperty.call(variables, name) ? encodeURIComponent(variables[name]).replace(/%2F/gi, '/') : match);
}

/** Read a dot/bracket path out of a parsed JSON value. */
function readPath(root: unknown, path: string | undefined): unknown {
	if (!path) {
		return root;
	}
	const parts = path.replace(/\[(\w+)\]/g, '.$1').split('.').filter(Boolean);
	let current: unknown = root;
	for (const part of parts) {
		if (current && typeof current === 'object') {
			current = (current as Record<string, unknown>)[part];
		} else {
			return undefined;
		}
	}
	return current;
}

export interface HttpResult {
	ok: boolean;
	/** Raw extracted value when ok. */
	value?: unknown;
	/** Short error label when not ok. */
	error?: string;
}

export async function fetchSource(source: HttpSource, variables: Record<string, string>): Promise<HttpResult> {
	const url = substituteVariables(source.url, variables);

	const cached = cache.get(url);
	if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
		return { ok: true, value: readPath(cached.value, source.path) };
	}

	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 8000);
		const response = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
		clearTimeout(timeout);
		if (!response.ok) {
			return { ok: false, error: `HTTP ${response.status}` };
		}
		const json = await response.json();
		cache.set(url, { value: json, at: Date.now() });
		return { ok: true, value: readPath(json, source.path) };
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			return { ok: false, error: 'timeout' };
		}
		return { ok: false, error: 'unreachable' };
	}
}
