import { useState, useMemo } from 'react';
import { fmtCLP } from '../utils.js';
import { APPS_SCRIPT_URL } from '../config.js';

export default function TabAnteriores({
  fechas, setFechas,
  loadingNomina, loadNominaFromSheet,
  loadingSheets, nominasGuardadas, fetchNominasGuardadas,
  apiStatus = { status:'ok' },
  S,
}) {
  const [filterText, setFilterText] = useState('');
  const [rangeFrom, setRangeFrom]   = useState('');
  const [rangeTo, setRangeTo]       = useState('');

  const filtered = useMemo(() => {
    let list = nominasGuardadas;
    const q = filterText.trim().toLowerCase();
    if(q) {
      list = list.filter(n =>
        (n.FECHA_PAGO || '').toLowerCase().includes(q) ||
        (n.LUNES || '').toLowerCase().includes(q) ||
        (n.DOMINGO || '').toLowerCase().includes(q)
      );
    }
    if(rangeFrom) list = list.filter(n => (n.FECHA_PAGO || '') >= rangeFrom);
    if(rangeTo)   list = list.filter(n => (n.FECHA_PAGO || '') <= rangeTo);
    // Orden descendente por FECHA_PAGO
    return [...list].sort((a, b) => (b.FECHA_PAGO || '').localeCompare(a.FECHA_PAGO || ''));
  }, [nominasGuardadas, filterText, rangeFrom, rangeTo]);

  const totalFiltered = useMemo(
    () => filtered.reduce((s, n) => s + (parseFloat(n.TOTAL) || 0), 0),
    [filtered]
  );

  const hayFiltro = filterText || rangeFrom || rangeTo;

  // Guía contextual cuando el token está inválido
  const showAuthHelp = apiStatus.status === 'auth';
  const showNetHelp = apiStatus.status === 'network';

  return (
    <div className="fade-in">
      {showAuthHelp && (
        <div style={{ ...S.card, background:'#FFFBEB', border:'1px solid #FCD34D' }}>
          <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
            <span style={{ fontSize:24 }}>🔐</span>
            <div style={{ flex:1 }}>
              <p style={{ fontSize:14, fontWeight:700, color:'#92400E', margin:0 }}>
                Token inválido — pasos para recuperar el acceso
              </p>
              <p style={{ fontSize:12, color:'#78350F', marginTop:6, lineHeight:1.5 }}>
                <strong>Tus nóminas guardadas no se perdieron</strong> — están seguras en Google Sheets. Solo hay que volver a sincronizar el token entre Vercel y el Apps Script.
              </p>
              <ol style={{ fontSize:12, color:'#78350F', marginTop:10, paddingLeft:22, lineHeight:1.7 }}>
                <li>Abre <a href="https://script.google.com" target="_blank" rel="noreferrer" style={{ color:'#B45309', fontWeight:700 }}>script.google.com</a>, abre el script de la nómina y copia el valor de <code style={{ background:'#FEF3C7', padding:'1px 5px', borderRadius:3 }}>VALID_TOKEN</code>.</li>
                <li>Abre <a href="https://vercel.com" target="_blank" rel="noreferrer" style={{ color:'#B45309', fontWeight:700 }}>vercel.com</a> → tu proyecto → <strong>Settings → Environment Variables</strong>.</li>
                <li>Edita la variable <code style={{ background:'#FEF3C7', padding:'1px 5px', borderRadius:3 }}>VITE_APPS_SCRIPT_TOKEN</code> y pega el mismo valor (Production, Preview y Development).</li>
                <li>En la pestaña <strong>Deployments</strong>, en el último deploy: menú <code>…</code> → <strong>Redeploy</strong>.</li>
                <li>Cuando termine (1–2 min), recarga esta página y pulsa <strong>Reintentar</strong> arriba.</li>
              </ol>
              <p style={{ fontSize:11, color:'#78350F', marginTop:10, fontStyle:'italic' }}>
                La guía completa está en el archivo <strong>SECURITY_SETUP.md</strong> del repositorio.
              </p>
              <div style={{ display:'flex', gap:8, marginTop:12 }}>
                <button onClick={fetchNominasGuardadas}
                  style={{ padding:'6px 14px', background:'#D97706', color:'#fff', border:'none',
                    borderRadius:6, fontSize:12, fontWeight:700, cursor:'pointer' }}>
                  🔄 Probar conexión nuevamente
                </button>
                <a href="https://github.com/msobarzo23/nomina-semanal-v2/blob/main/SECURITY_SETUP.md"
                  target="_blank" rel="noreferrer"
                  style={{ padding:'6px 14px', background:'#fff', color:'#92400E',
                    border:'1px solid #FCD34D', borderRadius:6, fontSize:12, fontWeight:700,
                    textDecoration:'none', display:'inline-flex', alignItems:'center' }}>
                  📖 Abrir guía completa
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {showNetHelp && (
        <div style={{ ...S.card, background:'#FEF2F2', border:'1px solid #FECACA' }}>
          <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
            <span style={{ fontSize:24 }}>📡</span>
            <div style={{ flex:1 }}>
              <p style={{ fontSize:14, fontWeight:700, color:'#991B1B', margin:0 }}>
                Sin conexión con el Apps Script
              </p>
              <p style={{ fontSize:12, color:'#7F1D1D', marginTop:6 }}>
                Verifica tu conexión a internet. Si el problema persiste, revisa que el Apps Script siga desplegado en Google.
              </p>
              <button onClick={fetchNominasGuardadas}
                style={{ marginTop:10, padding:'6px 14px', background:'#DC2626', color:'#fff', border:'none',
                  borderRadius:6, fontSize:12, fontWeight:700, cursor:'pointer' }}>
                🔄 Reintentar
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={S.card}>
        <div style={S.sectionTitle}>Cargar nómina por fecha</div>
        <div style={{ display:'flex', gap:10, alignItems:'flex-end' }}>
          <div style={{ flex:1 }}>
            <label style={S.fieldLabel}>Fecha de pago</label>
            <input type="date" value={fechas.viernes}
              onChange={e => setFechas(p => ({ ...p, viernes:e.target.value }))} style={S.input}/>
          </div>
          <button onClick={() => loadNominaFromSheet(fechas.viernes)} disabled={loadingNomina}
            style={{ padding:'10px 24px', background: loadingNomina ? '#bbb' : '#1D9E75', color:'#fff',
              border:'none', borderRadius:8, fontWeight:700, fontSize:13, cursor: loadingNomina ? 'default' : 'pointer' }}>
            {loadingNomina ? 'Cargando…' : 'Cargar →'}
          </button>
        </div>
        {APPS_SCRIPT_URL.startsWith('PEGA_') && (
          <p style={{ fontSize:11, color:'#DC2626', marginTop:8 }}>
            ⚠️ Apps Script no configurado. Sigue los pasos en README_SETUP.md
          </p>
        )}
      </div>

      {nominasGuardadas.length > 0 && (
        <>
          {/* Filtros */}
          <div style={{ ...S.card, padding:'10px 14px' }}>
            <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
              <input value={filterText}
                onChange={e => setFilterText(e.target.value)}
                placeholder="Buscar por fecha (ej: 2026-04)…"
                style={{ ...S.input, flex:'1 1 220px', minWidth:180 }}/>
              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                <span style={{ fontSize:11, color:'#888' }}>Desde</span>
                <input type="date" value={rangeFrom}
                  onChange={e => setRangeFrom(e.target.value)}
                  style={{ ...S.input, padding:'7px 10px', fontSize:12 }}/>
                <span style={{ fontSize:11, color:'#888' }}>Hasta</span>
                <input type="date" value={rangeTo}
                  onChange={e => setRangeTo(e.target.value)}
                  style={{ ...S.input, padding:'7px 10px', fontSize:12 }}/>
              </div>
              {hayFiltro && (
                <button onClick={() => { setFilterText(''); setRangeFrom(''); setRangeTo(''); }}
                  style={{ padding:'5px 10px', fontSize:11, color:'#888', background:'transparent',
                    border:'none', cursor:'pointer', textDecoration:'underline' }}>
                  Limpiar filtros
                </button>
              )}
              <span style={{ marginLeft:'auto', fontSize:11, color:'#888' }}>
                {filtered.length}/{nominasGuardadas.length} nóminas
                {hayFiltro && filtered.length > 0 && (
                  <span style={{ marginLeft:8, fontWeight:700, color:'#0D3B2E' }}>
                    · Total: {fmtCLP(totalFiltered)}
                  </span>
                )}
              </span>
            </div>
          </div>

          <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
            <div style={{ padding:'12px 20px', borderBottom:'1px solid #E0E0D8', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={S.sectionTitle}>Nóminas guardadas ({nominasGuardadas.length})</span>
              <button onClick={fetchNominasGuardadas}
                style={{ padding:'4px 10px', fontSize:10, background:'#F3F4F6', border:'1px solid #E5E7EB',
                  borderRadius:6, cursor:'pointer', color:'#666', fontWeight:600 }}>
                🔄 Refrescar
              </button>
            </div>
            <div style={{ overflowX:'auto', maxHeight:'60vh', overflowY:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead style={{ position:'sticky', top:0, background:'#fff', zIndex:1 }}>
                  <tr style={{ borderBottom:'2px solid #E0E0D8' }}>
                    {['FECHA DE PAGO','SEMANA','TOTAL','DOCS','GUARDADA',''].map((h, i) => (
                      <th key={i} style={{ padding:'10px', textAlign: i===2?'right':'left',
                        fontSize:10, fontWeight:700, color:'#666', textTransform:'uppercase', letterSpacing:'.04em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((n, i) => (
                    <tr key={i} style={{ borderBottom:'1px solid #f0f0ec',
                      background: i % 2 ? '#FAFAF7' : '#fff' }}>
                      <td style={{ padding:'10px', fontWeight:700, color:'#0D3B2E', ...S.mono }}>{n.FECHA_PAGO}</td>
                      <td style={{ padding:'10px', color:'#888', fontSize:11 }}>
                        {n.LUNES} → {n.DOMINGO}
                      </td>
                      <td style={{ padding:'10px', textAlign:'right', fontWeight:700, ...S.mono }}>
                        {fmtCLP(parseFloat(n.TOTAL) || 0)}
                      </td>
                      <td style={{ padding:'10px', ...S.mono, color:'#666' }}>{n.TOTAL_DOCS}</td>
                      <td style={{ padding:'10px', fontSize:10, color:'#999' }}>
                        {n.TIMESTAMP ? String(n.TIMESTAMP).replace('T',' ').slice(0,16) : ''}
                      </td>
                      <td style={{ padding:'10px' }}>
                        <button onClick={() => loadNominaFromSheet(n.FECHA_PAGO)}
                          style={{ padding:'5px 14px', background:'#1D9E75', color:'#fff', border:'none',
                            borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer' }}>
                          Abrir →
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} style={{ padding:24, textAlign:'center', color:'#aaa', fontSize:12 }}>
                      Ninguna nómina coincide con el filtro
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!loadingSheets && nominasGuardadas.length === 0 && !APPS_SCRIPT_URL.startsWith('PEGA_') && (
        <div style={{ ...S.card, textAlign:'center', padding:40, color:'#aaa' }}>
          <p style={{ fontSize:14 }}>No hay nóminas guardadas todavía.</p>
          <p style={{ fontSize:12, marginTop:4 }}>
            Procesa una nómina y pulsa "Guardar en Sheet" en la pestaña Confirmar.
          </p>
        </div>
      )}
    </div>
  );
}
