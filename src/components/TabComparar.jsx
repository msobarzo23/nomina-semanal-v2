import { useState, useEffect, useMemo } from 'react';
import { fmtCLP } from '../utils.js';
import { APPS_SCRIPT_URL, withToken } from '../config.js';

export default function TabComparar({ nominasGuardadas, S }) {
  const [fechaA, setFechaA] = useState('');
  const [fechaB, setFechaB] = useState('');
  const [datosA, setDatosA] = useState(null);
  const [datosB, setDatosB] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Default: ultimas dos nominas guardadas
  useEffect(() => {
    const sorted = [...nominasGuardadas].sort((a,b) => (b.FECHA_PAGO || '').localeCompare(a.FECHA_PAGO || ''));
    if(sorted.length >= 1 && !fechaA) setFechaA(sorted[1]?.FECHA_PAGO || sorted[0]?.FECHA_PAGO || '');
    if(sorted.length >= 1 && !fechaB) setFechaB(sorted[0]?.FECHA_PAGO || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nominasGuardadas]);

  const cargar = async () => {
    if(!fechaA || !fechaB) { setError('Selecciona ambas fechas'); return; }
    if(fechaA === fechaB) { setError('Selecciona dos fechas distintas'); return; }
    if(APPS_SCRIPT_URL.startsWith('PEGA_')) { setError('Apps Script no configurado'); return; }
    setError(''); setLoading(true); setDatosA(null); setDatosB(null);
    try {
      const [rA, rB] = await Promise.all([
        fetch(withToken(`${APPS_SCRIPT_URL}?action=load&fecha=${encodeURIComponent(fechaA)}`)).then(r => r.json()),
        fetch(withToken(`${APPS_SCRIPT_URL}?action=load&fecha=${encodeURIComponent(fechaB)}`)).then(r => r.json()),
      ]);
      if(!rA.ok) { setError(`Error en A: ${rA.error || 'no disponible'}`); setLoading(false); return; }
      if(!rB.ok) { setError(`Error en B: ${rB.error || 'no disponible'}`); setLoading(false); return; }
      setDatosA({ fecha:fechaA, encabezado:rA.encabezado, detalle:rA.detalle || [] });
      setDatosB({ fecha:fechaB, encabezado:rB.encabezado, detalle:rB.detalle || [] });
    } catch(e) {
      setError('Error de red al cargar las nóminas');
    }
    setLoading(false);
  };

  const diff = useMemo(() => {
    if(!datosA || !datosB) return null;
    const totalA = parseFloat(datosA.encabezado?.TOTAL || 0);
    const totalB = parseFloat(datosB.encabezado?.TOTAL || 0);
    const docsA  = parseInt(datosA.encabezado?.TOTAL_DOCS || 0);
    const docsB  = parseInt(datosB.encabezado?.TOTAL_DOCS || 0);

    // Por proveedor
    const groupBy = (rows) => {
      const m = {};
      rows.forEach(r => {
        const key = r.DETALLE || '';
        if(!key) return;
        m[key] = (m[key] || 0) + (parseFloat(r.MONTO) || 0);
      });
      return m;
    };
    const provA = groupBy(datosA.detalle);
    const provB = groupBy(datosB.detalle);
    const allProvs = new Set([...Object.keys(provA), ...Object.keys(provB)]);

    const filas = [];
    for(const p of allProvs) {
      const a = provA[p] || 0;
      const b = provB[p] || 0;
      filas.push({ proveedor:p, a, b, delta:b - a, pct: a > 0 ? ((b - a) / a) * 100 : null });
    }
    filas.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

    const nuevosEnB    = filas.filter(f => f.a === 0 && f.b !== 0);
    const desaparecenB = filas.filter(f => f.a !== 0 && f.b === 0);
    const cambian      = filas.filter(f => f.a !== 0 && f.b !== 0 && f.delta !== 0);

    return { totalA, totalB, docsA, docsB,
             deltaTotal: totalB - totalA,
             pctTotal: totalA > 0 ? ((totalB - totalA) / totalA) * 100 : null,
             filas, nuevosEnB, desaparecenB, cambian };
  }, [datosA, datosB]);

  const renderDelta = (delta, pct) => {
    if(delta === 0) return <span style={{ color:'#888' }}>—</span>;
    const up = delta > 0;
    return (
      <span style={{ color: up ? '#B91C1C' : '#047857', fontWeight:700 }}>
        {up ? '▲' : '▼'} {fmtCLP(Math.abs(delta))}
        {pct !== null && <span style={{ fontWeight:500, marginLeft:4 }}>({up ? '+' : ''}{pct.toFixed(0)}%)</span>}
      </span>
    );
  };

  return (
    <div className="fade-in">
      <div style={S.card}>
        <div style={S.sectionTitle}>Comparar dos nóminas</div>
        <div style={{ display:'flex', gap:10, alignItems:'flex-end', flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:170 }}>
            <label style={S.fieldLabel}>Nómina A (anterior)</label>
            <select value={fechaA} onChange={e => setFechaA(e.target.value)} style={S.input}>
              <option value="">— Selecciona —</option>
              {nominasGuardadas.map(n => (
                <option key={n.FECHA_PAGO} value={n.FECHA_PAGO}>
                  {n.FECHA_PAGO} · {fmtCLP(parseFloat(n.TOTAL) || 0)}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex:1, minWidth:170 }}>
            <label style={S.fieldLabel}>Nómina B (más reciente)</label>
            <select value={fechaB} onChange={e => setFechaB(e.target.value)} style={S.input}>
              <option value="">— Selecciona —</option>
              {nominasGuardadas.map(n => (
                <option key={n.FECHA_PAGO} value={n.FECHA_PAGO}>
                  {n.FECHA_PAGO} · {fmtCLP(parseFloat(n.TOTAL) || 0)}
                </option>
              ))}
            </select>
          </div>
          <button onClick={cargar} disabled={loading}
            style={{ padding:'10px 20px', background: loading ? '#bbb' : '#1D9E75', color:'#fff',
              border:'none', borderRadius:8, fontWeight:700, fontSize:13, cursor:loading?'default':'pointer' }}>
            {loading ? 'Cargando…' : 'Comparar →'}
          </button>
        </div>
        {error && <p style={{ fontSize:12, color:'#DC2626', marginTop:8 }}>⚠️ {error}</p>}
      </div>

      {diff && (
        <>
          {/* Resumen totales */}
          <div style={S.card}>
            <div style={S.sectionTitle}>Resumen</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:10 }}>
              <div style={{ background:'#F5F5F0', border:'1px solid #E0E0D8', borderRadius:10, padding:14 }}>
                <p style={{ fontSize:11, color:'#888', fontWeight:600 }}>Nómina A · {datosA.fecha}</p>
                <p style={{ ...S.mono, fontSize:18, fontWeight:700, color:'#0D3B2E', marginTop:4 }}>{fmtCLP(diff.totalA)}</p>
                <p style={{ fontSize:11, color:'#888', marginTop:2 }}>{diff.docsA} documentos</p>
              </div>
              <div style={{ background:'#F5F5F0', border:'1px solid #E0E0D8', borderRadius:10, padding:14 }}>
                <p style={{ fontSize:11, color:'#888', fontWeight:600 }}>Nómina B · {datosB.fecha}</p>
                <p style={{ ...S.mono, fontSize:18, fontWeight:700, color:'#0D3B2E', marginTop:4 }}>{fmtCLP(diff.totalB)}</p>
                <p style={{ fontSize:11, color:'#888', marginTop:2 }}>{diff.docsB} documentos</p>
              </div>
              <div style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:10, padding:14 }}>
                <p style={{ fontSize:11, color:'#1E40AF', fontWeight:600 }}>Diferencia (B − A)</p>
                <p style={{ ...S.mono, fontSize:18, fontWeight:700, marginTop:4,
                  color: diff.deltaTotal > 0 ? '#B91C1C' : diff.deltaTotal < 0 ? '#047857' : '#0D3B2E' }}>
                  {diff.deltaTotal > 0 ? '+' : ''}{fmtCLP(diff.deltaTotal)}
                </p>
                {diff.pctTotal !== null && (
                  <p style={{ fontSize:11, color:'#1E40AF', marginTop:2, fontWeight:700 }}>
                    {diff.pctTotal > 0 ? '+' : ''}{diff.pctTotal.toFixed(1)}%
                  </p>
                )}
              </div>
              <div style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:10, padding:14 }}>
                <p style={{ fontSize:11, color:'#166534', fontWeight:600 }}>Cambios</p>
                <p style={{ fontSize:11, color:'#166534', marginTop:6 }}>
                  <strong>{diff.nuevosEnB.length}</strong> proveedor{diff.nuevosEnB.length === 1 ? '' : 'es'} nuevo{diff.nuevosEnB.length === 1 ? '' : 's'}<br/>
                  <strong>{diff.desaparecenB.length}</strong> ya no aparece{diff.desaparecenB.length === 1 ? '' : 'n'}<br/>
                  <strong>{diff.cambian.length}</strong> con monto distinto
                </p>
              </div>
            </div>
          </div>

          {/* Diferencias por proveedor */}
          <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
            <div style={{ padding:'12px 18px', borderBottom:'1px solid #E0E0D8' }}>
              <span style={S.sectionTitle}>Diferencias por proveedor (ordenadas por delta)</span>
            </div>
            <div style={{ overflowX:'auto', maxHeight:'58vh', overflowY:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead style={{ position:'sticky', top:0, background:'#F3F4F6', zIndex:1 }}>
                  <tr>
                    <th style={{ padding:'8px 12px', textAlign:'left', fontSize:10, fontWeight:700, color:'#555', borderBottom:'2px solid #E5E7EB' }}>PROVEEDOR</th>
                    <th style={{ padding:'8px 12px', textAlign:'right', fontSize:10, fontWeight:700, color:'#555', borderBottom:'2px solid #E5E7EB' }}>A</th>
                    <th style={{ padding:'8px 12px', textAlign:'right', fontSize:10, fontWeight:700, color:'#555', borderBottom:'2px solid #E5E7EB' }}>B</th>
                    <th style={{ padding:'8px 12px', textAlign:'right', fontSize:10, fontWeight:700, color:'#555', borderBottom:'2px solid #E5E7EB' }}>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.filas.map((f, i) => (
                    <tr key={f.proveedor} style={{ borderBottom:'1px solid #f0f0ec',
                      background: f.a === 0 ? '#F0FDF4' : f.b === 0 ? '#FEF2F2' : i % 2 ? '#FAFAF7' : '#fff' }}>
                      <td style={{ padding:'7px 12px', fontSize:11 }}>
                        {f.proveedor}
                        {f.a === 0 && <span style={{ marginLeft:6, fontSize:9, padding:'1px 6px', borderRadius:99, background:'#166534', color:'#fff', fontWeight:700 }}>NUEVO</span>}
                        {f.b === 0 && <span style={{ marginLeft:6, fontSize:9, padding:'1px 6px', borderRadius:99, background:'#991B1B', color:'#fff', fontWeight:700 }}>YA NO APARECE</span>}
                      </td>
                      <td style={{ padding:'7px 12px', textAlign:'right', ...S.mono, fontSize:11, color:'#666' }}>
                        {f.a > 0 ? fmtCLP(f.a) : '—'}
                      </td>
                      <td style={{ padding:'7px 12px', textAlign:'right', ...S.mono, fontSize:11, color:'#222', fontWeight:600 }}>
                        {f.b > 0 ? fmtCLP(f.b) : '—'}
                      </td>
                      <td style={{ padding:'7px 12px', textAlign:'right', ...S.mono, fontSize:11 }}>
                        {renderDelta(f.delta, f.pct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
