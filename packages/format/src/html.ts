const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for HTML element content and quoted attribute values. */
export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => HTML_ENTITIES[c]!);
