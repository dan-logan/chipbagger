// Minimal RFC 4180 CSV parser (handles quotes, commas and newlines in fields).
window.CSV = {
  parse(text) {
    const rows = [];
    let row = [], field = '', i = 0, inQuotes = false;
    text = text.replace(/^﻿/, '');
    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    const header = (rows.shift() || []).map(h => h.trim().toLowerCase());
    return rows
      .filter(r => r.some(v => v.trim() !== ''))
      .map(r => Object.fromEntries(header.map((h, j) => [h, (r[j] || '').trim()])));
  }
};
