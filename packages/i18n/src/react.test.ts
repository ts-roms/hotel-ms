import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createRich, richText } from './react.js';
import { createTranslator } from './translator.js';

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe('richText', () => {
  it('puts elements where the placeholders are', () => {
    const node = richText('Welcome back, {name}!', { name: createElement('strong', null, 'Ana') });
    expect(html(node)).toBe('Welcome back, <strong>Ana</strong>!');
  });

  it('keeps the word order of the message', () => {
    const node = richText('{b} before {a}', { a: 'A', b: createElement('em', null, 'B') });
    expect(html(node)).toBe('<em>B</em> before A');
  });

  it('leaves placeholders without a value visible', () => {
    expect(html(richText('Hi {name}', {}))).toBe('Hi {name}');
  });
});

describe('createRich', () => {
  it('binds a catalog translator', () => {
    const rich = createRich(createTranslator({ hello: 'Hello, {name}' }));
    expect(html(rich('hello', { name: createElement('b', null, 'Bo') }))).toBe('Hello, <b>Bo</b>');
  });
});
