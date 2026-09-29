import 'reflect-metadata';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { createRequire } from 'node:module';
import { RequestMethod, type Type } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CONTROLLERS, declarePathParameters } from './api-surface.js';
import { CONTEXT_MODULES } from './app.module.js';

function registeredControllers(): Type[] {
  const seen = new Set<Type>();
  const controllers: Type[] = [];
  const visit = (module: Type) => {
    if (seen.has(module)) return;
    seen.add(module);
    const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, module) ?? []) as Type[];
    imports.forEach(visit);
    controllers.push(
      ...((Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, module) ?? []) as Type[]),
    );
  };
  CONTEXT_MODULES.forEach(visit);
  return controllers;
}

const { API_CONTEXTS } = createRequire(import.meta.url)('../../../.dependency-cruiser.cjs') as {
  API_CONTEXTS: string[];
};

describe('API surface', () => {
  it('lists the context modules in the dependency order of API_CONTEXTS', () => {
    const folder = (module: Type) =>
      module.name
        .replace(/Module$/, '')
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase();
    expect(CONTEXT_MODULES.map(folder)).toEqual(API_CONTEXTS);
  });

  it('lists every controller the context modules register, once', () => {
    const registered = registeredControllers();
    expect(new Set(registered).size).toBe(registered.length);
    expect(new Set(CONTROLLERS).size).toBe(CONTROLLERS.length);
    expect(new Set(CONTROLLERS)).toEqual(new Set(registered));
  });

  it('serves every route from exactly one controller', () => {
    const routes = CONTROLLERS.flatMap((controller) => {
      const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
      const proto = controller.prototype as Record<string, unknown>;
      return Object.getOwnPropertyNames(proto).flatMap((name) => {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') return [];
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (path === undefined) return [];
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
        return [`${RequestMethod[method]} /${base}/${path}`.replace(/\/+/g, '/')];
      });
    });
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((route, index) => routes.indexOf(route) !== index)).toEqual([]);
  });
});

describe('declarePathParameters', () => {
  it('adds the path parameters a handler does not read, first and in path order', () => {
    const own = {
      name: 'folioId',
      required: true,
      in: 'path' as const,
      schema: { type: 'string' as const },
    };
    const doc = declarePathParameters({
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {
        '/properties/{propertyId}/folios/{folioId}': { get: { parameters: [own], responses: {} } },
        '/health': { get: { responses: {} } },
      },
    });
    expect(doc.paths['/properties/{propertyId}/folios/{folioId}']!.get!.parameters).toEqual([
      { name: 'propertyId', required: true, in: 'path', schema: { type: 'string' } },
      own,
    ]);
    expect(doc.paths['/health']!.get!.parameters).toBeUndefined();
  });
});
