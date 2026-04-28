import { useState, useMemo, useCallback } from 'react';
import { fmtCLP, parseMonto } from '../utils.js';

const getField = (row, ...candidates) => {
  if(!row) return '';
  for(const c of candidates) {
    if(row[c] !== undefined && row[c] !== null && row[c] !== '') return row[c];
  }
  const keys = Object.keys(row);
  for(const c of candidates) {
    const found = keys.find(k => k.toUpperCase() === c.toUpperCase());
    if(found && row[found] !== undefined && row[found] !== null && row[found] !== '') return row[found];
  }
  return '';
};

export default function TabBuscar({ historico, loadingSheets, S }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [committedQuery, setCommittedQuery] = useState('');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [limit, setLimit] = useState(200);

  const allMatches = useMemo(() => {
    if(!committedQuery && !rangeFrom && !rangeTo) return [];
    const q = committedQuery.trim().toLowerCase();
    return historico.filter(r => {
      if(!r || typeof r !== 'object') return false;
      const fecha = (getField(r, 'FECHA_PAGO', 'Fecha_Pago', 'fecha_pago', 'FECHA') || '').toString();
      if(rangeFrom && fecha < rangeFrom) return false;
      if(rangeTo && fecha > rangeTo) return false;
      if(!q) return true;
      const haystack = Object.values(r)
        .map(v => (v == null ? '' : v.toString()))
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [committedQuery, historico, rangeFrom, rangeTo]);

  const visible = useMemo(() => allMatches.slice(0, limit), [allMatches, limit]);

  const totalMonto = useMemo(
    () => allMatches.reduce((s, r) => s + parseMonto(getField(r, 'MONTO', 'Monto')), 0),
    [allMatches]
  );

  const doSearch = useCallback(() => {
    setCommittedQuery(searchQuery);
    setLimit(200);
  }, [searchQuery]);

  const limpiar = () => {
    setSearchQuery(''); setCommittedQuery('');
    setRangeFrom(''); setRangeTo('');
    setLimit(200);
  };

  const hayFiltro = committedQuery || rangeFrom || rangeTo;

  return (
    <div className="fade-in">
      <div style={S.card}>
        <div style={S.sectionTitle}>Buscar en histórico</div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
            placeholder="Buscar por Nº documento, RUT, proveedor o fecha…" style={{ ...S.input, flex:'1 1 280px' }}/>
          <button onClick={doSearch}
            style={{ padding:'8px 24px', borderRadius:8, background:'#1D9E75', color:'#fff',
              fontWeight:600, fontSize:13, border:'none', cursor:'pointer' }}>Buscar</button>
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginTop:10 }}>
          <span style={{ fontSize:11, color:'#888' }}>Rango de fechas:</span>
          <span style={{ fontSize:11, color:'#888' }}>Desde</span>
          <input type="date" value={rangeFrom}
            onChange={e => setRangeFrom(e.target.value)}
            style={{ ...S.input, padding:'7px 10px', fontSize:12, width:160 }}/>
          <span style={{ fontSize:11, color:'#888' }}>Hasta</span>
          <input type="date" value={rangeTo}
            onChange={e => setRangeTo(e.target.value)}
            style={{ ...S.input, padding:'7px 10px', fontSize:12, width:160 }}/>
          {hayFiltro && (
            <button onClick={limpiar}
              style={{ padding:'5px 10px', fontSize:11, color:'#888', background:'transparent',
                border:'none', cursor:'pointer', textDecoration:'underline' }}>
              Limpiar
            </button>
          )}
        </div>
        {loadingSheets && <p className="pulse" style={{ fontSize:11, color:'#aaa', marginTop:8 }}>Cargando datos…</p>}
        {!loadingSheets && historico.length > 0 && (
          <p style={{ fontSize:10, color:'#bbb', marginTop:6 }}>
            {historico.length.toLocaleString('de-DE')} registros cargados · {getField(historico[0], 'FECHA_PAGO')} a {getField(historico[historico.length-1], 'FECHA_PAGO')}
          </p>
        )}
      </div>

      {allMatches.length > 0 && (
        <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
          <div style={{ padding:'10px 16px', background:'#FAFAF7', borderBottom:'1px solid #E0E0D8',
            display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <span style={{ fontSize:11, color:'#888', fontWeight:500 }}>
              {allMatches.length.toLocaleString('de-DE')} resultado{allMatches.length === 1 ? '' : 's'}
              {visible.length < allMatches.length && (
                <span style={{ color:'#aaa' }}> · mostrando {visible.length.toLocaleString('de-DE')}</span>
              )}
            </span>
            <span style={{ fontSize:13, fontWeight:700, color:'#0D3B2E', ...S.mono }}>
              Total: {fmtCLP(totalMonto)}
            </span>
          </div>
          <div style={{ overflowX:'auto', maxHeight:'50vh', overflowY:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead style={{ position:'sticky', top:0 }}>
                <tr style={{ background:'#fff', borderBottom:'2px solid #E0E0D8' }}>
                  {['FECHA','Nº DOC','RUT','DETALLE','MONTO','CUOTAS','AUTH'].map(h => (
                    <th key={h} style={{ padding:'8px 10px', textAlign:'left', fontSize:10, fontWeight:700, color:'#888' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => (
                  <tr key={i} style={{ borderBottom:'1px solid #f0f0ec', background: i % 2 ? '#FAFAF7' : '#fff' }}>
                    <td style={{ padding:'5px 10px', fontSize:11 }}>{getField(r, 'FECHA_PAGO', 'Fecha_Pago', 'fecha_pago', 'FECHA')}</td>
                    <td style={{ padding:'5px 10px', fontSize:11, ...S.mono }}>{getField(r, 'N_DOCUMENTO', 'N_Documento', 'N° DOCUMENTO', 'N DOCUMENTO')}</td>
                    <td style={{ padding:'5px 10px', fontSize:11, ...S.mono, color:'#888' }}>{getField(r, 'RUT', 'Rut')}</td>
                    <td style={{ padding:'5px 10px', fontSize:11 }}>{getField(r, 'DETALLE', 'Detalle')}</td>
                    <td style={{ padding:'5px 10px', fontSize:11, textAlign:'right', fontWeight:600, ...S.mono }}>
                      {fmtCLP(parseMonto(getField(r, 'MONTO', 'Monto')))}
                    </td>
                    <td style={{ padding:'5px 10px', fontSize:11, textAlign:'center' }}>
                      {(() => {
                        const c = getField(r, 'CUOTAS', 'Cuotas');
                        return c && c !== 'nan' ? (
                          <span style={{ background:'#DBEAFE', color:'#1D4ED8', padding:'2px 6px', borderRadius:99, fontSize:9 }}>{c}</span>
                        ) : null;
                      })()}
                    </td>
                    <td style={{ padding:'5px 10px', fontSize:11, textAlign:'center', fontWeight:700 }}>{getField(r, 'AUTORIZADOR', 'Autorizador')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visible.length < allMatches.length && (
            <div style={{ padding:'12px', textAlign:'center', borderTop:'1px solid #E0E0D8' }}>
              <button onClick={() => setLimit(l => l + 500)}
                style={{ padding:'7px 18px', fontSize:12, background:'#fff', border:'1px solid #1D9E75',
                  color:'#14614B', fontWeight:700, borderRadius:6, cursor:'pointer' }}>
                Mostrar más ({Math.min(500, allMatches.length - visible.length).toLocaleString('de-DE')} más)
              </button>
            </div>
          )}
        </div>
      )}

      {hayFiltro && allMatches.length === 0 && !loadingSheets && (
        <div style={{ ...S.card, textAlign:'center', padding:48, color:'#aaa' }}>
          Sin resultados para los filtros aplicados
        </div>
      )}
    </div>
  );
}
