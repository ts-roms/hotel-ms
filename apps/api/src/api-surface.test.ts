import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants.js';
import type { Type } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CONTROLLERS } from './api-surface.js';
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

describe('API surface', () => {
  it('lists every controller the context modules register, once', () => {
    const registered = registeredControllers();
    expect(new Set(registered).size).toBe(registered.length);
    expect(new Set(CONTROLLERS).size).toBe(CONTROLLERS.length);
    expect(new Set(CONTROLLERS)).toEqual(new Set(registered));
  });
});
