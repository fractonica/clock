#!/usr/bin/env node
// A zero-dependency MCP server (stdio, JSON-RPC 2.0) that lets Claude and other agents read and write the hub.
//
//   node hub/bin/hub.mjs pair --name "Claude" --kind service --scopes read,write,search --token
//   claude mcp add fractonica-hub --env FXHUB_URL=http://localhost:8787 --env FXHUB_TOKEN=fxh_… -- node /path/to/hub/examples/mcp-server.mjs
//
// Tools: search_records, list_records, get_record, add_record.
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

const HUB = process.env.FXHUB_URL ?? 'http://localhost:8787';
const TOKEN = process.env.FXHUB_TOKEN;

async function hub(method, path, body) {
  if (!TOKEN) throw new Error('FXHUB_TOKEN is not set');
  const res = await fetch(HUB + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${res.status} ${data?.error?.message ?? res.statusText}`);
  return data;
}
/** Records without hub bookkeeping, times as ISO strings too: easier for a model to read. */
const slim = (r) => ({
  id: r.id, kind: r.kind, time: r.time, when: new Date(r.time * 1000).toISOString(), zone: r.zone, fractonica: r.fx?.stamp,
  data: r.data, text: r.text, tags: r.tags, attachments: r.blobs?.map((b) => ({ role: b.role, type: b.type, url: `${HUB}/v1/blobs/${b.hash}` })),
  source: r.source,
});

const TOOLS = [
  {
    name: 'search_records',
    description: 'Search the Fractonica Hub (journal entries from all devices, sensors, computer usage …) by meaning or by keyword. Returns the best matching records with scores.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for, in natural language' },
        mode: { type: 'string', enum: ['auto', 'semantic', 'keyword'], description: 'auto (default): semantic when an embedding worker is connected' },
        kinds: { type: 'array', items: { type: 'string' }, description: 'Record kinds or globs, e.g. ["journal.*"]' },
        limit: { type: 'number', description: '1–50, default 10' },
      },
      required: ['query'],
    },
    run: async (a) => {
      const r = await hub('POST', '/v1/search', { query: a.query, mode: a.mode ?? 'auto', kinds: a.kinds, limit: Math.min(50, a.limit ?? 10) });
      return { mode: r.mode, results: r.results.map((x) => ({ score: x.score, part: x.part, record: slim(x.record) })) };
    },
  },
  {
    name: 'list_records',
    description: 'List records newest first, optionally filtered by kind, source client, time range (Unix seconds), tag or keywords.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'A kind or glob, e.g. journal.entry or sensor.*' },
        source: { type: 'string', description: 'Client id of the writer' },
        since: { type: 'number' },
        until: { type: 'number' },
        tag: { type: 'string' },
        q: { type: 'string', description: 'Keyword filter' },
        limit: { type: 'number', description: '1–100, default 20' },
        cursor: { type: 'string', description: 'From a previous call, for the next page' },
      },
    },
    run: async (a) => {
      const p = new URLSearchParams({ limit: String(Math.min(100, a.limit ?? 20)) });
      for (const k of ['kind', 'source', 'since', 'until', 'tag', 'q', 'cursor']) if (a[k] !== undefined && a[k] !== '') p.set(k, String(a[k]));
      const r = await hub('GET', `/v1/records?${p}`);
      return { records: r.records.map(slim), cursor: r.cursor, more: r.more };
    },
  },
  {
    name: 'get_record',
    description: 'Get one record by id.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: async (a) => slim(await hub('GET', `/v1/records/${encodeURIComponent(a.id)}`)),
  },
  {
    name: 'add_record',
    description:
      'Write a record to the hub. For a journal post use kind "journal.entry" with data {emoji, title, markdown}; for anything else choose a dotted kind (e.g. "agent.note") and put the readable text in `text`.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'Dotted lowercase kind, e.g. journal.entry, agent.note' },
        text: { type: 'string', description: 'Searchable text (kinds other than journal.entry)' },
        data: { type: 'object', description: 'Kind-specific JSON' },
        time: { type: 'number', description: 'When it happened, Unix seconds (default now)' },
        tags: { type: 'array', items: { type: 'string' } },
        id: { type: 'string', description: 'Optional stable id; the same id replaces the record' },
      },
      required: ['kind'],
    },
    run: async (a) => {
      const now = Date.now() / 1000;
      const id = a.id ?? `mcp:${randomUUID()}`;
      const body = { kind: a.kind, time: a.time ?? now, created: now, updated: now, data: a.data ?? {}, text: a.text, tags: a.tags };
      return slim(await hub('PUT', `/v1/records/${encodeURIComponent(id)}`, body));
    },
  },
];

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

async function handle(m) {
  const { id, method, params } = m;
  if (id === undefined) return; // notifications (initialized, cancelled …)
  try {
    if (method === 'initialize') {
      return send({
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'fractonica-hub', version: '1.0.0' },
          instructions: 'Personal records from the Fractonica Hub: journal entries from the user’s devices and other data sources.',
        },
      });
    }
    if (method === 'ping') return send({ id, result: {} });
    if (method === 'tools/list') return send({ id, result: { tools: TOOLS.map(({ run, ...t }) => t) } });
    if (method === 'tools/call') {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return send({ id, error: { code: -32602, message: `unknown tool ${params?.name}` } });
      try {
        const out = await tool.run(params.arguments ?? {});
        return send({ id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] } });
      } catch (e) {
        return send({ id, result: { content: [{ type: 'text', text: String(e.message ?? e) }], isError: true } });
      }
    }
    send({ id, error: { code: -32601, message: `method not found: ${method}` } });
  } catch (e) {
    send({ id, error: { code: -32603, message: String(e.message ?? e) } });
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return send({ id: null, error: { code: -32700, message: 'parse error' } });
  }
  for (const x of Array.isArray(m) ? m : [m]) handle(x);
});
