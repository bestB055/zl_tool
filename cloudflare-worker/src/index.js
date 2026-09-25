import { DEEPSEEK_OPERATIONS } from './deepseek-operations.js';

const DOUBAO_SEARCH_URL = 'https://open.feedcoopapi.com/search_api/web_search';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const MAX_DEEPSEEK_REQUEST_BYTES = 128 * 1024;
const DEEPSEEK_TIMEOUT_MS = 60000;

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === '/auth-check') {
            if (request.method !== 'GET') {
                return jsonResponse({ error: 'Method not allowed' }, 405);
            }
            return jsonResponse({ ok: true }, 200);
        }

        if (!['/doubao-search', '/deepseek-json'].includes(url.pathname)) {
            return jsonResponse({ error: 'Not found' }, 404);
        }

        const originCheck = validateOrigin(request, env);
        if (!originCheck.ok) {
            return jsonResponse(
                { error: originCheck.error },
                originCheck.status,
                originCheck.headers,
            );
        }
        const corsHeaders = originCheck.headers;

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }
        if (request.method !== 'POST') {
            return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
        }

        if (url.pathname === '/deepseek-json') {
            return handleDeepSeek(request, env, corsHeaders);
        }
        return handleDoubaoSearch(request, corsHeaders);
    },
};

async function handleDeepSeek(request, env, corsHeaders) {
    if (!String(env.DEEPSEEK_API_KEY || '').trim()) {
        return jsonResponse({ error: 'AI service is not configured' }, 503, corsHeaders);
    }

    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > MAX_DEEPSEEK_REQUEST_BYTES) {
        return jsonResponse({ error: 'Request body is too large' }, 413, corsHeaders);
    }

    let rawBody;
    try {
        rawBody = await request.text();
    } catch {
        return jsonResponse({ error: 'Unable to read request body' }, 400, corsHeaders);
    }
    if (new TextEncoder().encode(rawBody).byteLength > MAX_DEEPSEEK_REQUEST_BYTES) {
        return jsonResponse({ error: 'Request body is too large' }, 413, corsHeaders);
    }

    let payload;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders);
    }

    const operationName = String(payload.operation || '').trim();
    const operation = DEEPSEEK_OPERATIONS[operationName];
    if (!operation) {
        return jsonResponse({ error: 'Unsupported DeepSeek operation' }, 400, corsHeaders);
    }
    if (!payload.input || typeof payload.input !== 'object') {
        return jsonResponse({ error: 'Input must be a JSON object or array' }, 400, corsHeaders);
    }

    const userContent = JSON.stringify(payload.input);
    if (new TextEncoder().encode(userContent).byteLength > operation.maxInputBytes) {
        return jsonResponse({ error: `${operation.stage} input is too large` }, 413, corsHeaders);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);

    try {
        const response = await fetch(DEEPSEEK_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${String(env.DEEPSEEK_API_KEY).trim()}`,
            },
            body: JSON.stringify({
                model: operation.model,
                temperature: operation.temperature,
                max_tokens: operation.maxTokens,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: operation.systemPrompt },
                    { role: 'user', content: userContent },
                ],
            }),
            signal: controller.signal,
        });

        const upstreamPayload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = String(upstreamPayload.error?.message || `HTTP ${response.status}`).slice(0, 500);
            const status = response.status === 429 ? 429 : 502;
            return jsonResponse({
                error: `${operation.stage} failed`,
                message,
                upstreamStatus: response.status,
            }, status, corsHeaders);
        }

        const content = upstreamPayload.choices?.[0]?.message?.content || '';
        let result;
        try {
            result = extractJson(content);
        } catch {
            return jsonResponse({ error: `${operation.stage} returned invalid JSON` }, 502, corsHeaders);
        }
        return jsonResponse({ result }, 200, corsHeaders);
    } catch (error) {
        if (error?.name === 'AbortError') {
            return jsonResponse({ error: `${operation.stage} timed out` }, 504, corsHeaders);
        }
        return jsonResponse({ error: `${operation.stage} request failed` }, 502, corsHeaders);
    } finally {
        clearTimeout(timeoutId);
    }
}

async function handleDoubaoSearch(request, corsHeaders) {
    const authorization = request.headers.get('Authorization') || '';
    if (!authorization.startsWith('Bearer ')) {
        return jsonResponse({ error: 'Missing search API key' }, 401, corsHeaders);
    }

    let payload;
    try {
        payload = await request.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders);
    }

    const query = String(payload.Query || '').trim().slice(0, 100);
    if (!query) {
        return jsonResponse({ error: 'Query is required' }, 400, corsHeaders);
    }

    const body = {
        Query: query,
        SearchType: 'web',
        Count: Math.min(50, Math.max(1, Number(payload.Count) || 10)),
        Filter: {
            NeedContent: true,
            NeedUrl: true,
        },
        ContentFormats: 'text',
    };

    const timeRange = String(payload.TimeRange || '').trim();
    if (timeRange) body.TimeRange = timeRange;

    try {
        const response = await fetch(DOUBAO_SEARCH_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: authorization,
            },
            body: JSON.stringify(body),
        });

        const responseHeaders = new Headers(corsHeaders);
        responseHeaders.set(
            'Content-Type',
            response.headers.get('Content-Type') || 'application/json; charset=utf-8',
        );
        responseHeaders.set('Cache-Control', 'no-store');

        return new Response(await response.text(), {
            status: response.status,
            headers: responseHeaders,
        });
    } catch {
        return jsonResponse({ error: 'Doubao search request failed' }, 502, corsHeaders);
    }
}

function validateOrigin(request, env) {
    const allowedOrigin = String(env.ALLOWED_ORIGIN || '').trim();
    const requestOrigin = request.headers.get('Origin') || '';
    const headers = buildCorsHeaders(allowedOrigin);

    if (!allowedOrigin) {
        return {
            ok: false,
            status: 503,
            error: 'Allowed origin is not configured',
            headers,
        };
    }
    if (requestOrigin !== allowedOrigin) {
        return {
            ok: false,
            status: 403,
            error: 'Origin is not allowed',
            headers,
        };
    }
    return { ok: true, headers };
}

function buildCorsHeaders(allowedOrigin = '') {
    const headers = {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
    };
    if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
    return headers;
}

function extractJson(content) {
    const cleaned = String(content || '')
        .replace(/```(?:json)?/gi, '')
        .replace(/```/g, '')
        .trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('No JSON object found');
    return JSON.parse(cleaned.slice(start, end + 1));
}

function jsonResponse(body, status, corsHeaders = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...corsHeaders,
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
}
