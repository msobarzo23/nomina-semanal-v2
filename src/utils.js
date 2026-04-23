export const fmtCLP = n => {
  if(n == null || isNaN(n)) return "$0";
  const abs = Math.abs(Math.round(n));
  const s = abs.toLocaleString('de-DE');
  return n < 0 ? `-$${s}` : `$${s}`;
};

export const fmtDate = d => {
  if(!d || isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  return `${dd}/${mm}/${d.getFullYear()}`;
};

export const fmtDateISO = d => {
  if(!d || isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

export const parseDate = val => {
  if(!val) return null;
  if(typeof val === 'number'){
    const days = Math.round(val) - 25569;
    const d = new Date(1970, 0, 1);
    d.setDate(d.getDate() + days);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  if(val instanceof Date) return new Date(val.getFullYear(), val.getMonth(), val.getDate());
  if(typeof val === 'string'){
    const s = val.trim(); let m;
    if((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return new Date(+m[1], +m[2]-1, +m[3]);
    if((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return new Date(+m[3], +m[2]-1, +m[1]);
    if((m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/))) return new Date(+m[3], +m[2]-1, +m[1]);
  }
  return null;
};

export const parseDateInput = str => {
  if(!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m-1, d);
};

export const normDoc = v => {
  if(!v && v !== 0) return '';
  return v.toString().trim().replace(/\.0+$/, '');
};

// Parse MONTO robustly - Google Sheets Chilean format uses dots as thousand separators
export const parseMonto = (v) => {
  if(!v || v === 'nan' || v === '') return 0;
  let s = v.toString().replace(/[$\s]/g, '');
  const dotParts = s.split('.');
  if(dotParts.length > 2 || (dotParts.length === 2 && dotParts[dotParts.length-1].length === 3)) {
    s = s.replace(/\./g, '');
  }
  s = s.replace(',', '.');
  return parseFloat(s) || 0;
};

export const getWeekDates = () => {
  const today = new Date();
  const day = today.getDay();
  const diffToLunes = day === 0 ? -6 : 1 - day;
  const lunes = new Date(today); lunes.setDate(today.getDate() + diffToLunes);
  const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6);
  const viernes = new Date(lunes); viernes.setDate(lunes.getDate() + 4);
  return { lunes: fmtDateISO(lunes), domingo: fmtDateISO(domingo), viernes: fmtDateISO(viernes) };
};
