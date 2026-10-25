import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { realpath, readFile } from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { courseSchema, contextRequestSchema, unitContextRequestSchema } from './contracts.js';
import { CurriculumRepository } from './repository.js';

const MAX_BODY_BYTES = 1_000_000;
const DEFAULT_PAGE_SIZE = 50;

export interface CurriculumServerOptions {
  repository: CurriculumRepository;
  assetRoot: string;
  apiToken?: string;
}

function jsonResponse(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function errorResponse(response: ServerResponse, status: number, message: string): void {
  jsonResponse(response, status, { error: { message } });
}

function authorized(request: IncomingMessage, apiToken?: string): boolean {
  if (!apiToken) return true;
  const header = request.headers.authorization;
  return header === `Bearer ${apiToken}` || request.headers['x-api-key'] === apiToken;
}

async function requestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large');
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new Error('Request body must be valid JSON');
  }
}

function pathPart(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const value = pathname.slice(prefix.length);
  if (!value || value.includes('/')) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function parseBoundedInteger(value: string | null, fallback: number, minimum: number, maximum: number): number {
  if (value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`Query value must be an integer between ${minimum} and ${maximum}`);
  return parsed;
}

async function confinedAssetPath(root: string, objectKey: string): Promise<string> {
  const rootPath = await realpath(root);
  if (path.isAbsolute(objectKey)) throw new Error('Asset path is not confined to the asset root');
  const candidate = path.resolve(rootPath, objectKey);
  const relative = path.relative(rootPath, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Asset path is not confined to the asset root');
  const resolvedCandidate = await realpath(candidate);
  const resolvedRelative = path.relative(rootPath, resolvedCandidate);
  if (resolvedRelative.startsWith('..') || path.isAbsolute(resolvedRelative)) throw new Error('Asset path is not confined to the asset root');
  return resolvedCandidate;
}

function mcpText(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function mcpError(message: string): { isError: true; content: Array<{ type: 'text'; text: string }> } {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export function createMcpServer(repository: CurriculumRepository): McpServer {
  const server = new McpServer({ name: 'kuwait-curriculum-kb', version: '0.1.0' });
  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool('kw_curriculum_list', {
    description: 'List the available curriculum catalog with course, unit, and lesson identifiers.',
    inputSchema: { offset: z.number().int().min(0).max(100_000).optional(), limit: z.number().int().min(1).max(100).optional() },
    annotations: readOnly,
  }, async ({ offset = 0, limit = DEFAULT_PAGE_SIZE }) => {
    const catalog = await repository.listCatalog();
    return mcpText({ items: catalog.slice(offset, offset + limit), offset, limit, total: catalog.length });
  });

  server.registerTool('kw_curriculum_resolve', {
    description: 'Resolve a partial course selection and return matched or ambiguous catalog choices.',
    inputSchema: {
      country: z.string().optional(), curriculum: z.string().optional(), academicYear: z.string().optional(),
      grade: z.number().int().optional(), track: z.enum(['general', 'scientific', 'literary']).optional(),
      subject: z.string().optional(), semester: z.union([z.literal(1), z.literal(2)]).optional(),
      edition: z.string().optional(), language: z.enum(['ar', 'en', 'fr']).optional(),
    },
    annotations: readOnly,
  }, async (selection) => {
    try {
      const parsed = courseSchema.partial().parse(selection);
      return mcpText(await repository.resolveSelection(parsed));
    } catch (error) {
      return mcpError(error instanceof Error ? error.message : String(error));
    }
  });

  server.registerTool('kw_unit_get', {
    description: 'Get the ordered lesson manifest for a course unit.',
    inputSchema: { courseId: z.string().min(1).max(200), unitId: z.string().min(1).max(200) },
    annotations: readOnly,
  }, async ({ courseId, unitId }) => {
    const unit = await repository.getUnit(courseId, unitId);
    return unit ? mcpText(unit) : mcpError('Unit is not available');
  });

  server.registerTool('kw_lesson_context_get', {
    description: 'Get the same grounded, cited lesson context returned by the HTTP API.',
    inputSchema: {
      courseId: z.string().min(1).max(200), lessonId: z.string().min(1).max(96),
      maxChars: z.number().int().min(500).max(100_000).optional(), offset: z.number().int().min(0).optional(),
      includeSupplementary: z.boolean().optional(), allowUnverified: z.boolean().optional(),
    },
    annotations: readOnly,
  }, async (request) => {
    try {
      const parsed = contextRequestSchema.parse(request);
      return mcpText(await repository.getLessonContext(parsed));
    } catch (error) {
      return mcpError(error instanceof Error ? error.message : String(error));
    }
  });

  server.registerTool('kw_unit_context_get', {
    description: 'Get grounded, cited context for every lesson in a course unit, grouped by lesson.',
    inputSchema: {
      courseId: z.string().min(1).max(200), unitId: z.string().min(1).max(96),
      lessonId: z.string().min(1).max(96).optional(),
      maxChars: z.number().int().min(500).max(200_000).optional(), offset: z.number().int().min(0).optional(),
      includeSupplementary: z.boolean().optional(), allowUnverified: z.boolean().optional(),
    },
    annotations: readOnly,
  }, async (request) => {
    try {
      const parsed = unitContextRequestSchema.parse(request);
      return mcpText(await repository.getUnitContext(parsed));
    } catch (error) {
      return mcpError(error instanceof Error ? error.message : String(error));
    }
  });

  server.registerTool('kw_resources_search', {
    description: 'Search active, authorized lesson content with citations.',
    inputSchema: { query: z.string().max(500), courseId: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).optional(), allowUnverified: z.boolean().optional() },
    annotations: readOnly,
  }, async ({ query, courseId, limit = DEFAULT_PAGE_SIZE, allowUnverified = false }) => {
    return mcpText({ items: await repository.searchResources({ query, courseId, limit, allowUnverified }), query });
  });

  server.registerTool('kw_source_page_get', {
    description: 'Get metadata and citation for an authorized visual source asset by its scoped asset ID.',
    inputSchema: z.union([
      z.object({ assetId: z.string().min(1).max(500) }),
      z.object({ resourceVersionId: z.string().min(1).max(300), page: z.number().int().positive(), allowUnverified: z.boolean().optional() }),
    ]),
    annotations: readOnly,
  }, async (request) => {
    if ('assetId' in request) {
      const asset = await repository.getAsset(request.assetId);
      return asset ? mcpText(asset) : mcpError('Source asset is not available');
    }
    const page = await repository.getSourcePage(request.resourceVersionId, request.page, request.allowUnverified ?? false);
    return page ? mcpText(page) : mcpError('Source page is not available');
  });

  server.registerTool('kw_coverage_get', {
    description: 'Report catalog, active-version, lesson, and asset coverage counts.',
    inputSchema: {},
    annotations: readOnly,
  }, async () => mcpText(await repository.getCoverage()));

  return server;
}

async function handleMcp(request: IncomingMessage, response: ServerResponse, repository: CurriculumRepository): Promise<void> {
  if (request.method !== 'POST') {
    errorResponse(response, 405, 'MCP endpoint accepts POST requests only');
    return;
  }
  const body = await requestJson(request);
  const server = createMcpServer(repository);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  response.on('close', () => {
    void transport.close();
    void server.close();
  });
  await transport.handleRequest(request, response, body);
}

export function createCurriculumServer(options: CurriculumServerOptions): Server {
  return createHttpServer(async (request, response) => {
    try {
      if (!authorized(request, options.apiToken)) {
        response.setHeader('www-authenticate', 'Bearer');
        errorResponse(response, 401, 'Authentication required');
        return;
      }
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname === '/mcp') {
        await handleMcp(request, response, options.repository);
        return;
      }
      if (url.pathname === '/healthz' && request.method === 'GET') {
        jsonResponse(response, 200, { status: 'ok' });
        return;
      }
      if (url.pathname === '/v1/catalog' && request.method === 'GET') {
        const offset = parseBoundedInteger(url.searchParams.get('offset'), 0, 0, 100_000);
        const limit = parseBoundedInteger(url.searchParams.get('limit'), DEFAULT_PAGE_SIZE, 1, 100);
        const catalog = await options.repository.listCatalog();
        jsonResponse(response, 200, { items: catalog.slice(offset, offset + limit), offset, limit, total: catalog.length });
        return;
      }
      if (url.pathname === '/v1/selections/resolve' && request.method === 'POST') {
        const body = await requestJson(request);
        const selection = body && typeof body === 'object' && 'selection' in body
          ? (body as { selection: unknown }).selection
          : body;
        const parsed = courseSchema.partial().parse(selection);
        jsonResponse(response, 200, await options.repository.resolveSelection(parsed));
        return;
      }
      if (url.pathname === '/v1/lesson-context' && request.method === 'POST') {
        const parsed = contextRequestSchema.parse(await requestJson(request));
        jsonResponse(response, 200, await options.repository.getLessonContext(parsed));
        return;
      }
      if (url.pathname === '/v1/unit-context' && request.method === 'POST') {
        const parsed = unitContextRequestSchema.parse(await requestJson(request));
        jsonResponse(response, 200, await options.repository.getUnitContext(parsed));
        return;
      }
      if (url.pathname === '/v1/search' && request.method === 'POST') {
        const body = await requestJson(request);
        if (!body || typeof body !== 'object') throw new Error('Search request must be an object');
        const input = body as { query?: unknown; courseId?: unknown; limit?: unknown; allowUnverified?: unknown };
        if (typeof input.query !== 'string' || input.query.length > 500) throw new Error('query must be a string of at most 500 characters');
        const limit = input.limit === undefined ? DEFAULT_PAGE_SIZE : parseBoundedInteger(String(input.limit), DEFAULT_PAGE_SIZE, 1, 100);
        const results = await options.repository.searchResources({
          query: input.query,
          courseId: typeof input.courseId === 'string' ? input.courseId : undefined,
          limit,
          allowUnverified: input.allowUnverified === true,
        });
        jsonResponse(response, 200, { items: results, total: results.length, query: input.query });
        return;
      }
      if (url.pathname === '/v1/coverage' && request.method === 'GET') {
        jsonResponse(response, 200, await options.repository.getCoverage());
        return;
      }
      const unitParts = url.pathname.split('/').filter(Boolean);
      if (request.method === 'GET' && unitParts.length === 4 && unitParts[0] === 'v1' && unitParts[1] === 'units') {
        const courseId = decodeURIComponent(unitParts[2]);
        const unitId = decodeURIComponent(unitParts[3]);
        const unit = await options.repository.getUnit(courseId, unitId);
        if (!unit) { errorResponse(response, 404, 'Unit is not available'); return; }
        jsonResponse(response, 200, unit);
        return;
      }
      if (request.method === 'GET' && unitParts.length === 5 && unitParts[0] === 'v1' && unitParts[1] === 'resources' && unitParts[3] === 'pages') {
        const resourceVersionId = decodeURIComponent(unitParts[2]);
        const page = parseBoundedInteger(unitParts[4], 0, 1, 100_000);
        const sourcePage = await options.repository.getSourcePage(resourceVersionId, page);
        if (!sourcePage) { errorResponse(response, 404, 'Source page is not available'); return; }
        jsonResponse(response, 200, sourcePage);
        return;
      }
      const assetId = pathPart(url.pathname, '/v1/assets/');
      if (request.method === 'GET' && assetId !== null) {
        const asset = await options.repository.getAsset(assetId, url.searchParams.get('allowUnverified') === 'true');
        if (!asset) { errorResponse(response, 404, 'Asset is not available'); return; }
        let assetPath: string;
        try {
          assetPath = await confinedAssetPath(options.assetRoot, asset.objectKey);
        } catch {
          errorResponse(response, 403, 'Asset path is not permitted');
          return;
        }
        const file = await readFile(assetPath);
        response.writeHead(200, {
          'content-type': asset.mimeType,
          'content-length': file.byteLength,
          'cache-control': 'private, no-store',
        });
        response.end(file);
        return;
      }
      errorResponse(response, 404, 'Route not found');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'Request body is too large') { errorResponse(response, 413, message); return; }
      if (message.includes('not found') || message.includes('ENOENT')) { errorResponse(response, 404, 'Requested resource is not available'); return; }
      if (error instanceof z.ZodError || message.includes('must be valid JSON') || message.includes('Query value')) {
        errorResponse(response, 400, message);
        return;
      }
      if (!response.headersSent) errorResponse(response, 500, 'Internal server error');
    }
  });
}
