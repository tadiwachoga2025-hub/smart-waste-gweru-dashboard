/** Shared client-side CSV export helpers. */

/** Guard against spreadsheet formula injection, then quote for CSV. */
export function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Download an array of row arrays (header first) as a UTF-8 CSV with BOM. */
export function downloadCsvLines(lines, filename) {
  const blob = new Blob([String.fromCharCode(0xfeff), lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
