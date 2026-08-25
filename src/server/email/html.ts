/**
 * HTML escape helper for values interpolated into email templates. Values in
 * emails include user-supplied strings (names, seat labels derived from admin
 * input, event titles from organisers), so we treat every interpolation as
 * untrusted.
 */
export function escapeHtml(input: string | null | undefined): string {
  if (input === null || input === undefined) return '';
  return String(input)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
