// Generates src/generated/operations.ts from the API's OpenAPI document (ADR-0009, ADR-0034):
// one typed request function per operationId, plus a URL builder per operation. The facade
// files under src/ map these onto the client's public methods and @hotel/contracts types.
//
//   pnpm --filter @hotel/api-client generate
//
// The output depends only on docs/api/openapi.json and this script, so it is deterministic;
// CI regenerates it after regenerating the OpenAPI document and fails on any diff.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const specPath = resolve(here, '../../../docs/api/openapi.json');
const outPath = resolve(here, '../src/generated/operations.ts');

/** Every route is served under the API's version prefix; the client's baseUrl supplies it. */
const PREFIX = '/api/v1';

/**
 * What the API accepts but does not (yet) declare in the OpenAPI document. Each entry is
 * checked: generation fails if the operation is gone or the document starts declaring it,
 * so this list only ever shrinks. Fix at the source by adding @ApiHeader / @ApiBody in
 * apps/api, regenerate the document, then remove the entry here.
 */
const UNDECLARED = {
  /** Controllers read @Headers('if-match') (optimistic concurrency, ADR-0009) without @ApiHeader. */
  ifMatch: [
    'AccessController_updateRole',
    'CalendarController_update',
    'FinanceController_closeShift',
    'FnbController_cancel',
    'FnbController_transition',
    'FnbController_updateOutlet',
    'GuestIdentityController_review',
    'GuestsController_update',
    'HrController_updateEmployee',
    'InventoryController_updateRoom',
    'InventoryController_updateRoomType',
    'LostFoundController_close',
    'MaintenanceController_act',
    'PricingController_updateRatePlan',
    'PropertiesController_update',
    'PropertyHrController_cancelShift',
    'PropertyHrController_decideCorrection',
    'PropertyHrController_decideLeave',
    'PropertyHrController_updateShift',
    'ServiceRequestsController_update',
  ],
  /** Request bodies the handler reads (or tolerates) that the document omits. */
  body: {
    // @ApiConsumes('text/csv') with an untyped @Body(): the CSV file itself.
    ImportsController_previewGuests: { kind: 'binary', required: true },
    ImportsController_previewRooms: { kind: 'binary', required: true },
    // The guest portal sends an empty JSON object; the handler ignores the body.
    GuestPaymentsController_hold: { kind: 'json', required: false },
  },
};

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const fail = (message) => {
  process.stderr.write(`api-client generate: ${message}\n`);
  process.exit(1);
};

const camel = (name) => name.toLowerCase().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const prop = (name) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name));
const scalar = (schema = {}) =>
  schema.type === 'integer' || schema.type === 'number'
    ? 'number'
    : schema.type === 'boolean'
      ? 'boolean'
      : 'string';
const objectType = (fields) =>
  `{ ${fields.map((f) => `${prop(f.name)}${f.required ? '' : '?'}: ${f.type}`).join('; ')} }`;

const operations = [];
for (const [route, item] of Object.entries(spec.paths)) {
  if (!route.startsWith(`${PREFIX}/`)) fail(`${route} is outside ${PREFIX}`);
  const path = route.slice(PREFIX.length);
  for (const [verb, op] of Object.entries(item)) {
    const id = op.operationId;
    if (!/^[A-Za-z_$][\w$]*$/.test(id ?? '')) fail(`${verb} ${route}: bad operationId ${id}`);
    const params = op.parameters ?? [];
    // Path parameters come from the template itself: the document omits some that a
    // controller reads through a guard (e.g. propertyId), and the template is what's sent.
    const pathParams = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    for (const p of params.filter((p) => p.in === 'path')) {
      if (!pathParams.includes(p.name)) fail(`${id}: path parameter ${p.name} not in ${path}`);
    }
    const query = params
      .filter((p) => p.in === 'query')
      .map((p) => ({ name: p.name, required: !!p.required, type: scalar(p.schema) }));
    const headers = params
      .filter((p) => p.in === 'header')
      .map((p) => ({ name: p.name.toLowerCase(), required: !!p.required }));
    let body = null;
    if (op.requestBody) {
      const types = Object.keys(op.requestBody.content ?? {});
      body = {
        kind: types.includes('application/json') ? 'json' : 'binary',
        required: !!op.requestBody.required,
      };
    }
    const success = Object.keys(op.responses ?? {}).filter((s) => /^2\d\d$/.test(s));
    operations.push({
      id,
      method: verb.toUpperCase(),
      path,
      pathParams,
      query,
      headers,
      body,
      empty: success.length > 0 && success.every((s) => s === '204'),
    });
  }
}

const byId = new Map();
for (const op of operations) {
  if (byId.has(op.id)) fail(`duplicate operationId ${op.id}`);
  byId.set(op.id, op);
}
for (const id of UNDECLARED.ifMatch) {
  const op = byId.get(id) ?? fail(`UNDECLARED.ifMatch: no operation ${id}`);
  if (op.headers.some((h) => h.name === 'if-match')) {
    fail(`${id} now declares If-Match; remove it from UNDECLARED.ifMatch`);
  }
  op.headers.push({ name: 'if-match', required: true });
}
for (const [id, body] of Object.entries(UNDECLARED.body)) {
  const op = byId.get(id) ?? fail(`UNDECLARED.body: no operation ${id}`);
  if (op.body) fail(`${id} now declares a request body; remove it from UNDECLARED.body`);
  op.body = body;
}
operations.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const pathType = (op) =>
  objectType(op.pathParams.map((name) => ({ name, required: true, type: 'string' })));
const queryOptional = (op) => op.query.every((q) => !q.required);

function urlBuilder(op) {
  const args = [];
  if (op.pathParams.length) args.push(`path: ${pathType(op)}`);
  if (op.query.length) args.push(`query${queryOptional(op) ? '?' : ''}: ${objectType(op.query)}`);
  const template = op.path.replace(/\{([^}]+)\}/g, (_, name) => `\${e(path${accessor(name)})}`);
  const suffix = op.query.length ? `\${qs(query${queryOptional(op) ? ' ?? {}' : ''})}` : '';
  return [
    `  /** ${op.method} ${op.path} */`,
    `  ${op.id}: (${args.join(', ')}): string => \`${template}${suffix}\`,`,
  ].join('\n');
}

function accessor(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`;
}

function requestFunction(op) {
  const params = ['call: Call'];
  const urlArgs = [];
  if (op.pathParams.length) {
    params.push(`path: ${pathType(op)}`);
    urlArgs.push('path');
  }
  if (op.query.length) {
    // Optional only as the last parameter; before a body or headers it's `{}` when unused.
    const optional = queryOptional(op) && !op.body && !op.headers.length;
    params.push(`query${optional ? '?' : ''}: ${objectType(op.query)}`);
    urlArgs.push('query');
  }
  const callArgs = [`'${op.method}'`, `paths.${op.id}(${urlArgs.join(', ')})`];
  const headersRequired = op.headers.some((h) => h.required);
  if (op.body) {
    const type = op.body.kind === 'binary' ? 'Blob' : 'unknown';
    // An optional body stays positional when headers follow it.
    const optional = !op.body.required && !(op.headers.length && headersRequired);
    params.push(
      `body${optional ? '?' : ''}: ${op.body.required || optional ? type : `${type} | undefined`}`,
    );
    callArgs.push('body');
  } else if (op.headers.length) {
    callArgs.push('undefined');
  }
  if (op.headers.length) {
    const fields = op.headers.map((h) => ({
      name: camel(h.name),
      required: h.required,
      type: 'string',
    }));
    params.push(`headers${headersRequired ? '' : '?'}: ${objectType(fields)}`);
    const entries = op.headers.map((h) =>
      h.required
        ? `'${h.name}': headers.${camel(h.name)}`
        : `...(headers?.${camel(h.name)} === undefined ? {} : { '${h.name}': headers.${camel(h.name)} })`,
    );
    callArgs.push(`{ ${entries.join(', ')} }`);
  }
  const generic = op.empty ? '' : '<T>';
  const result = op.empty ? 'void' : 'T';
  return [
    `/** ${op.method} ${op.path}${op.empty ? ' (204 No Content)' : ''} */`,
    `export function ${op.id}${generic}(${params.join(', ')}): Promise<Result<${result}>> {`,
    `  return call<${result}>(${callArgs.join(', ')});`,
    `}`,
  ].join('\n');
}

const out = [
  '// Generated by packages/api-client/scripts/generate.mjs from docs/api/openapi.json.',
  '// Do not edit: run `pnpm --filter @hotel/api-client generate` (ADR-0034).',
  '//',
  '// One function per API operation (operationId = <Controller>_<method>). Path, method,',
  '// path/query parameters, headers and whether a body is sent come from the document;',
  '// request and response types are supplied by the facade from @hotel/contracts.',
  "import { type Call, type Result, qs } from '../http.js';",
  '',
  'const e = encodeURIComponent;',
  '',
  "/** Each operation's URL below the client's baseUrl, path parameters URL-encoded. */",
  'export const paths = {',
  ...operations.map(urlBuilder),
  '} as const;',
  '',
  "/** Each operation's method and path template, for type-level checks of routes addressed by segment. */",
  'export interface Routes {',
  ...operations.map((op) => `  ${op.id}: '${op.method} ${op.path}';`),
  '}',
  '',
  ...operations.flatMap((op) => [requestFunction(op), '']),
].join('\n');

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out);
process.stdout.write(
  `api-client generate: ${operations.length} operations -> src/generated/operations.ts\n`,
);
