export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map((v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\r\n") + "\r\n";
}
export function csvResponse(name: string, body: string) {
  return new Response("﻿" + body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` } });
}
