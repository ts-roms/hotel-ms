import { Body, type PipeTransform, Query } from '@nestjs/common';
import { ApiBody, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';
import { Problems } from './problem.js';

/**
 * Zod is the single source of truth for request/response shapes (blueprint §4). These
 * helpers validate input and feed the same schemas to OpenAPI, so docs cannot drift from
 * what the server actually accepts.
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw Problems.validation(
        result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.') || '(root)',
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}

export function toOpenApiSchema(
  schema: z.ZodType,
  io: 'input' | 'output',
): Record<string, unknown> {
  const json = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

type ParamDecoratorFn = (target: object, key: string | symbol | undefined, index: number) => void;

function methodDescriptor(target: object, key: string | symbol | undefined): PropertyDescriptor {
  if (key === undefined) throw new Error('Zod parameter decorators are only supported on methods');
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor) throw new Error(`No descriptor for ${String(key)}`);
  return descriptor;
}

/** Validated JSON body. Also documents the body in OpenAPI. */
export function ZodBody(schema: z.ZodType): ParamDecoratorFn {
  return (target, key, index) => {
    Body(new ZodValidationPipe(schema))(target, key as string, index);
    ApiBody({ schema: toOpenApiSchema(schema, 'input') })(
      target,
      key as string,
      methodDescriptor(target, key),
    );
  };
}

/** Validated query string (must be a z.object). Also documents each parameter. */
export function ZodQuery(schema: z.ZodObject): ParamDecoratorFn {
  return (target, key, index) => {
    Query(new ZodValidationPipe(schema))(target, key as string, index);
    const descriptor = methodDescriptor(target, key);
    for (const [name, field] of Object.entries(schema.shape)) {
      ApiQuery({
        name,
        required: !(field as z.ZodType).safeParse(undefined).success,
        schema: toOpenApiSchema(field as z.ZodType, 'input'),
      })(target, key as string, descriptor);
    }
  };
}

export function ZodResponse(status: number, schema: z.ZodType, description = ''): MethodDecorator {
  return ApiResponse({ status, description, schema: toOpenApiSchema(schema, 'output') });
}
