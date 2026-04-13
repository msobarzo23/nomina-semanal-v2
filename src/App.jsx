import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { HISTORICO_URL, AUTORIZADORES_URL, COPEC_EXCLUSIONS, CUOTA_RULES, AUTH_LIST } from './config.js';
import { fmtCLP, fmtDate, fmtDateISO, parseDate, parseDateInput, normDoc, getWeekDates } from './utils.js';

export default function App() {
  const [tab, setTab] = useState("carga");
  const [fechas, setFechas] = useState(getWeekDates);
  const [dataNomina, setDataNomina] = useState(null);
  const [dataCopec, setDataCopec] = useState(null);
  const [fileNames, setFileNames] = useState({ nomina:'', copec:'' });
  const [nominaRows, setNominaRows] = useState([]);
  const [historico, setHistorico] = useState([]);
  const [authMap, setAuthMap] = useState({});
  const [loadingSheets, setLoadingSheets] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [toast, setToast] = useState("");
  const [processing, setProcessing] = useState(false);

  // ─── LOAD GOOGLE SHEETS ON MOUNT ───────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [hText, aText] = await Promise.all([
          fetch(HISTORICO_URL).then(r => r.text()),
          fetch(AUTORIZADORES_URL).then(r => r.text())
        ]);
        const hParsed = Papa.parse(hText, { header:true, skipEmptyLines:true });
        setHistorico(hParsed.data || []);
        const aParsed = Papa.parse(aText, { header:true, skipEmptyLines:true });
        const map = {};
        (aParsed.data || []).forEach(r => {
          if(r.DETALLE) map[r.DETALLE] = {
            auth: r.AUTORIZADOR_DEFAULT || '',
            cuotas: parseInt(r.CUOTAS_LBS) || 0
          };
        });
        setAuthMap(map);
      } catch(e) { console.error("Error cargando Google Sheets:", e); }
      setLoadingSheets(false);
    })();
  }, []);

  // ─── FILE READING ──────────────────────────────────────────────────
  const handleFile = (file, key) => {
    setFileNames(p => ({ ...p, [key]: file.name }));
    const reader = new FileReader();
    reader.onload = e => {
      const wb = XLSX.read(e.target.result, { type:'array', raw:true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:null });
      if(key === 'nomina') setDataNomina(raw);
      else setDataCopec(raw);
    };
    reader.readAsArrayBuffer(file);
  };

  // ─── PROCESS ───────────────────────────────────────────────────────
  const processNomina = useCallback(() => {
    if(!dataNomina || !dataCopec) return;
    setProcessing(true);
    const lunes = parseDateInput(fechas.lunes);
    const domingo = parseDateInput(fechas.domingo);
    const pago = parseDateInput(fechas.viernes);
    if(!lunes || !domingo || !pago) { setProcessing(false); return; }

    // Parse Defontana headers
    const hIdx = dataNomina.findIndex(r => r && r.some(c => typeof c === 'string' && c.includes('Vencimiento')));
    if(hIdx < 0) { setProcessing(false); return; }
    const headers = dataNomina[hIdx].map(h => h ? h.toString().trim() : '');
    const col = {}; headers.forEach((h, i) => { if(h) col[h] = i; });
    const dataRows = dataNomina.slice(hIdx + 1).filter(r => r && r.some(c => c !== null && c !== ''));

    // Parse COPEC
    const cHIdx = dataCopec.findIndex(r => r && r.some(c => c?.toString().includes('Documento')));
    const cH = cHIdx >= 0 ? dataCopec[cHIdx] : [];
    const cDocCol = cH.findIndex(c => c?.toString().includes('Documento'));
    const cCargoCol = cH.findIndex(c => /cargo/i.test(c?.toString() || ''));
    const copecByDoc = {};
    if(cHIdx >= 0) dataCopec.slice(cHIdx + 1).forEach(r => {
      if(!r) return;
      const doc = normDoc(r[cDocCol]); if(!doc) return;
      copecByDoc[doc] = (copecByDoc[doc] || 0) + (parseFloat(r[cCargoCol]) || 0);
    });
    const copecNums = new Set(Object.keys(copecByDoc));

    // Build historico doc count for cuota calc
    const histDocCount = {};
    historico.forEach(h => {
      if(h.AUTORIZADOR === 'LBS' && !COPEC_EXCLUSIONS.has(h.DETALLE)) {
        const key = `${h.N_DOCUMENTO}|||${h.DETALLE}`;
        histDocCount[key] = (histDocCount[key] || 0) + 1;
      }
    });

    const result = [];
    const localDocCount = {};

    dataRows.forEach(row => {
      const venc = parseDate(row[col['Vencimiento']]);
      const ficha = row[col['Ficha']]?.toString() || '';
      const esCopec = ficha.toUpperCase().includes('COPEC');
      const saldo = parseFloat(row[col['Saldo ($)']]) || 0;
      const numDoc = normDoc(row[col['Número Doc.']]);
      const rut = row[col['Rut']]?.toString() || '';
      const razon = row[col['Razón Social']]?.toString() || '';

      if(!esCopec && venc && venc < lunes) return;

      let enSemana = false;
      if(esCopec) {
        if(copecNums.has(numDoc)) enSemana = true;
      } else {
        enSemana = venc && venc >= lunes && venc <= domingo;
      }
      if(!enSemana) return;

      let defaultAuth = authMap[razon]?.auth || 'MBL';
      const isNC = saldo < 0;

      // Cuota calculation
      let cuotaText = '';
      if(defaultAuth === 'LBS' && !COPEC_EXCLUSIONS.has(razon)) {
        const docKey = `${numDoc}|||${razon}`;
        const histCount = histDocCount[docKey] || 0;
        localDocCount[docKey] = (localDocCount[docKey] || 0) + 1;
        const cuotaNum = histCount + localDocCount[docKey];
        const totalCuotas = CUOTA_RULES[razon] || authMap[razon]?.cuotas || 0;
        if(totalCuotas > 0) cuotaText = `${cuotaNum}/${totalCuotas}`;
        else if(cuotaNum > 0) cuotaText = `${cuotaNum}`;
      }

      result.push({
        id: `${numDoc}-${result.length}`,
        fecha: fmtDateISO(pago),
        nDoc: numDoc, rut, detalle: razon, monto: saldo,
        cuotas: cuotaText, autorizador: defaultAuth,
        isNC, esCopec,
      });
    });

    result.sort((a, b) => {
      if(a.esCopec !== b.esCopec) return a.esCopec ? 1 : -1;
      return a.detalle.localeCompare(b.detalle);
    });

    setNominaRows(result);
    setProcessing(false);
    setTab("revision");
  }, [dataNomina, dataCopec, fechas, historico, authMap]);

  // ─── EDIT ROW ──────────────────────────────────────────────────────
  const updateRow = (id, field, value) => {
    setNominaRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  // ─── STATS ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const copecRows = nominaRows.filter(r => r.esCopec);
    const otrosRows = nominaRows.filter(r => !r.esCopec);
    const copecTotal = copecRows.reduce((s, r) => s + r.monto, 0);
    const otrosTotal = otrosRows.reduce((s, r) => s + r.monto, 0);
    const byAuth = {};
    nominaRows.forEach(r => { byAuth[r.autorizador] = (byAuth[r.autorizador] || 0) + r.monto; });
    const topProvs = {};
    otrosRows.forEach(r => { topProvs[r.detalle] = (topProvs[r.detalle] || 0) + r.monto; });
    const top5 = Object.entries(topProvs).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { copecRows, otrosRows, copecTotal, otrosTotal, total: copecTotal + otrosTotal,
             byAuth, top5, totalDocs: nominaRows.length };
  }, [nominaRows]);

  // ─── SEARCH ────────────────────────────────────────────────────────
  const doSearch = useCallback(() => {
    if(!searchQuery.trim()) { setSearchResults([]); return; }
    const q = searchQuery.trim().toLowerCase();
    const results = historico.filter(r =>
      (r.N_DOCUMENTO || '').toLowerCase().includes(q) ||
      (r.RUT || '').toLowerCase().includes(q) ||
      (r.DETALLE || '').toLowerCase().includes(q)
    ).slice(0, 150);
    setSearchResults(results);
  }, [searchQuery, historico]);

  // ─── DOWNLOAD EXCEL ────────────────────────────────────────────────
  const downloadExcel = () => {
    const header = ['FECHA_PAGO','N_DOCUMENTO','RUT','DETALLE','MONTO','CUOTAS','AUTORIZADOR'];
    const data = nominaRows.map(r => [r.fecha, r.nDoc, r.rut, r.detalle, r.monto, r.cuotas, r.autorizador]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Nomina ${fechas.viernes}`);
    const out = XLSX.write(wb, { bookType:'xlsx', type:'array' });
    const blob = new Blob([out], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `nomina_${fechas.viernes}.xlsx`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ─── COPY FOR SHEETS ──────────────────────────────────────────────
  const copyForSheets = () => {
    const lines = nominaRows.map(r =>
      [r.fecha, r.nDoc, r.rut, r.detalle, r.monto, r.cuotas, r.autorizador].join('\t')
    );
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      showToast("✓ Copiado — pega en Google Sheets (Ctrl+V)");
    });
  };

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(""), 4000); };

  // ─── STYLES ────────────────────────────────────────────────────────
  const S = {
    header: { background:'linear-gradient(135deg,#0D3B2E 0%,#14614B 50%,#1D9E75 100%)', color:'#fff', padding:'14px 24px' },
    headerInner: { maxWidth:1100, margin:'0 auto', display:'flex', alignItems:'center', justifyContent:'space-between' },
    tabs: { background:'#fff', borderBottom:'1px solid #E0E0D8', position:'sticky', top:0, zIndex:20 },
    tabsInner: { maxWidth:1100, margin:'0 auto', display:'flex' },
    tabBtn: (active) => ({ padding:'12px 20px', fontSize:13, fontWeight:600, border:'none', background:active?'rgba(29,158,117,.04)':'none',
      cursor:'pointer', borderBottom:active?'2.5px solid #1D9E75':'2.5px solid transparent',
      color:active?'#14614B':'#999', transition:'all .2s', fontFamily:'var(--sans)' }),
    container: { maxWidth:1100, margin:'0 auto', padding:16 },
    card: { background:'#fff', borderRadius:12, border:'1px solid #E0E0D8', padding:20, marginBottom:12 },
    sectionTitle: { fontSize:11, fontWeight:700, color:'#aaa', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:14 },
    grid: (cols, gap=12) => ({ display:'grid', gridTemplateColumns:`repeat(${cols},1fr)`, gap }),
    input: { width:'100%', border:'1px solid #ccc', borderRadius:8, padding:'8px 12px', fontSize:13, fontFamily:'var(--sans)', outline:'none' },
    fieldLabel: { fontSize:11, color:'#888', display:'block', marginBottom:4, fontWeight:500 },
    btn: (bg, color='#fff', border) => ({ display:'block', width:'100%', padding:13, borderRadius:12, fontSize:14,
      fontWeight:700, cursor:'pointer', border:border||'none', background:bg, color, transition:'all .15s', fontFamily:'var(--sans)' }),
    mono: { fontFamily:"'DM Mono',monospace" },
  };

  const tabs = [
    { id:"carga", label:"① Carga", icon:"📁" },
    { id:"revision", label:"② Revisión", icon:"✏️" },
    { id:"confirmar", label:"③ Confirmar", icon:"✅" },
    { id:"buscar", label:"④ Histórico", icon:"🔍" },
  ];

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', fontFamily:'var(--sans)' }}>
      {/* HEADER */}
      <header style={S.header} className="no-print">
        <div style={S.headerInner}>
          <div>
            <h1 style={{ ...S.mono, fontSize:18, fontWeight:700, letterSpacing:'-.02em', margin:0 }}>NÓMINA SEMANAL</h1>
            <p style={{ fontSize:12, opacity:.7, marginTop:2 }}>Transportes Bello e Hijos Ltda.</p>
          </div>
          <div style={{ textAlign:'right' }}>
            {loadingSheets
              ? <span className="pulse" style={{ fontSize:11, opacity:.6 }}>Cargando Google Sheets…</span>
              : <span style={{ fontSize:11, opacity:.6 }}>{historico.length.toLocaleString('de-DE')} registros · {Object.keys(authMap).length} proveedores</span>}
          </div>
        </div>
      </header>

      {/* TABS */}
      <nav style={S.tabs} className="no-print">
        <div style={S.tabsInner}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={S.tabBtn(tab === t.id)}>
              <span style={{ marginRight:6 }}>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
      </nav>

      {/* TOAST */}
      {toast && (
        <div className="fade-in" style={{ position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)',
          background:'#0D3B2E', color:'#fff', padding:'12px 24px', borderRadius:12, fontSize:13, fontWeight:600, zIndex:100,
          boxShadow:'0 8px 32px rgba(0,0,0,.2)' }}>{toast}</div>
      )}

      <main style={S.container} className="no-print">

        {/* ═══ TAB 1: CARGA ═══ */}
        {tab === "carga" && (
          <div className="fade-in">
            <div style={S.card}>
              <div style={S.sectionTitle}>Semana de pago</div>
              <div style={S.grid(3)}>
                <div>
                  <label style={S.fieldLabel}>Lunes (inicio)</label>
                  <input type="date" value={fechas.lunes} onChange={e => setFechas(p => ({...p, lunes:e.target.value}))} style={S.input}/>
                </div>
                <div>
                  <label style={S.fieldLabel}>Domingo (fin)</label>
                  <input type="date" value={fechas.domingo} onChange={e => setFechas(p => ({...p, domingo:e.target.value}))} style={S.input}/>
                </div>
                <div>
                  <label style={S.fieldLabel}>Fecha de pago</label>
                  <input type="date" value={fechas.viernes} onChange={e => setFechas(p => ({...p, viernes:e.target.value}))} style={S.input}/>
                </div>
              </div>
            </div>

            <div style={S.grid(2)}>
              <DropZone label="Archivo Defontana" icon="📄" hint="Excel del sistema contable"
                fileName={fileNames.nomina} onFile={f => handleFile(f, 'nomina')}/>
              <DropZone label="Archivo COPEC" icon="⛽" hint="Facturas COPEC de la semana"
                fileName={fileNames.copec} onFile={f => handleFile(f, 'copec')}/>
            </div>

            <div style={{ marginTop:12 }}>
              <button onClick={processNomina} disabled={!dataNomina || !dataCopec || processing}
                style={{ ...S.btn(dataNomina && dataCopec && !processing ? '#1D9E75' : '#bbb'),
                  ...(dataNomina && dataCopec && !processing ? { boxShadow:'0 4px 16px rgba(29,158,117,.3)' } : {}) }}>
                {processing ? 'Procesando…' : 'Procesar y continuar →'}
              </button>
            </div>
          </div>
        )}

        {/* ═══ TAB 2: REVISIÓN ═══ */}
        {tab === "revision" && (
          <div className="fade-in">
            {nominaRows.length === 0 ? (
              <div style={{ ...S.card, textAlign:'center', padding:48, color:'#aaa' }}>
                <p style={{ fontSize:16, marginBottom:8 }}>Sin datos</p>
                <p style={{ fontSize:13 }}>Vuelve a la pestaña Carga y procesa los archivos primero.</p>
              </div>
            ) : (<>
              <div style={S.grid(4, 10)}>
                <Stat label="Total facturas" value={stats.totalDocs}/>
                <Stat label="Otros proveedores" value={fmtCLP(stats.otrosTotal)} sub={`${stats.otrosRows.length} docs`}/>
                <Stat label="COPEC" value={fmtCLP(stats.copecTotal)} sub={`${stats.copecRows.length} docs`}/>
                <Stat label="TOTAL GENERAL" value={fmtCLP(stats.total)} highlight/>
              </div>

              {nominaRows.some(r => r.isNC) && (
                <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:12, padding:'12px 16px',
                  display:'flex', alignItems:'center', gap:12, marginBottom:12, marginTop:4 }}>
                  <span style={{ fontSize:18 }}>⚠️</span>
                  <p style={{ fontSize:13, color:'#92400E' }}>
                    <strong>{nominaRows.filter(r => r.isNC).length}</strong> notas de crédito detectadas — Nº Doc y Detalle editables.
                  </p>
                </div>
              )}

              <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
                <div style={{ overflowX:'auto', maxHeight:'58vh', overflowY:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                    <thead style={{ position:'sticky', top:0, zIndex:5 }}>
                      <tr style={{ background:'#0D3B2E' }}>
                        {['Nº DOC','RUT','DETALLE','MONTO','CUOTAS','AUTORIZADOR'].map((h, i) => (
                          <th key={h} style={{ color:'#fff', padding:'8px 10px', fontSize:10, fontWeight:700,
                            letterSpacing:'.04em', textAlign:i===3?'right':i>=4?'center':'left', whiteSpace:'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {nominaRows.map((r, i) => (
                        <tr key={r.id} style={{ borderBottom:'1px solid #f0f0ec',
                          background: r.isNC ? '#FFF5F5' : i % 2 ? '#FAFAF7' : '#fff' }}>
                          <td style={{ padding:'6px 10px' }}>
                            {r.isNC ? (
                              <input value={r.nDoc} onChange={e => updateRow(r.id, 'nDoc', e.target.value)}
                                style={{ width:100, border:'1px solid #FCD34D', borderRadius:4, padding:'3px 6px',
                                  fontSize:11, background:'#FFFBEB', outline:'none', ...S.mono }}/>
                            ) : <span style={{ ...S.mono, fontSize:11 }}>{r.nDoc}</span>}
                          </td>
                          <td style={{ padding:'6px 10px', ...S.mono, fontSize:11, color:'#888' }}>{r.rut}</td>
                          <td style={{ padding:'6px 10px' }}>
                            {r.isNC ? (
                              <input value={r.detalle} onChange={e => updateRow(r.id, 'detalle', e.target.value)}
                                style={{ width:'100%', border:'1px solid #FCD34D', borderRadius:4, padding:'3px 6px',
                                  fontSize:11, background:'#FFFBEB', outline:'none' }}/>
                            ) : <span style={{ fontSize:11 }}>{r.detalle}</span>}
                          </td>
                          <td style={{ padding:'6px 10px', textAlign:'right', fontWeight:600, ...S.mono, fontSize:11,
                            color: r.monto < 0 ? '#DC2626' : '#1a1a1a' }}>{fmtCLP(r.monto)}</td>
                          <td style={{ padding:'6px 10px', textAlign:'center' }}>
                            {r.cuotas && <span style={{ display:'inline-block', background:'#DBEAFE', color:'#1D4ED8',
                              fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:99 }}>{r.cuotas}</span>}
                          </td>
                          <td style={{ padding:'6px 10px', textAlign:'center' }}>
                            <select value={r.autorizador} onChange={e => updateRow(r.id, 'autorizador', e.target.value)}
                              style={{ border:'1px solid #ccc', borderRadius:6, padding:'3px 6px', fontSize:11,
                                fontWeight:700, background:'#fff', cursor:'pointer', outline:'none' }}>
                              {AUTH_LIST.map(a => <option key={a} value={a}>{a}</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <button onClick={() => setTab("confirmar")}
                style={{ ...S.btn('#1D9E75'), boxShadow:'0 4px 16px rgba(29,158,117,.3)', marginTop:4 }}>
                Confirmar nómina →
              </button>
            </>)}
          </div>
        )}

        {/* ═══ TAB 3: CONFIRMAR ═══ */}
        {tab === "confirmar" && (
          <div className="fade-in">
            {nominaRows.length === 0 ? (
              <div style={{ ...S.card, textAlign:'center', padding:48, color:'#aaa' }}>
                Primero procesa los archivos en la pestaña Carga.
              </div>
            ) : (<>
              <div style={S.card}>
                <div style={S.sectionTitle}>Resumen nómina — Pago {fmtDate(parseDateInput(fechas.viernes))}</div>
                <div style={S.grid(3)}>
                  <div style={{ background:'#E8F5EF', borderRadius:12, padding:16, border:'1px solid #C5E8D5' }}>
                    <p style={{ fontSize:11, color:'#0D3B2E', fontWeight:600 }}>Total General</p>
                    <p style={{ fontSize:24, fontWeight:800, color:'#0D3B2E', marginTop:4, ...S.mono }}>{fmtCLP(stats.total)}</p>
                    <p style={{ fontSize:11, color:'#1D9E75', marginTop:4 }}>{stats.totalDocs} documentos</p>
                  </div>
                  <div style={{ background:'#F5F5F0', borderRadius:12, padding:16, border:'1px solid #E0E0D8' }}>
                    <p style={{ fontSize:11, color:'#666', fontWeight:600 }}>Otros Proveedores</p>
                    <p style={{ fontSize:20, fontWeight:700, color:'#333', marginTop:4, ...S.mono }}>{fmtCLP(stats.otrosTotal)}</p>
                    <p style={{ fontSize:11, color:'#aaa', marginTop:4 }}>{stats.otrosRows.length} documentos</p>
                  </div>
                  <div style={{ background:'#F5F5F0', borderRadius:12, padding:16, border:'1px solid #E0E0D8' }}>
                    <p style={{ fontSize:11, color:'#666', fontWeight:600 }}>COPEC</p>
                    <p style={{ fontSize:20, fontWeight:700, color:'#333', marginTop:4, ...S.mono }}>{fmtCLP(stats.copecTotal)}</p>
                    <p style={{ fontSize:11, color:'#aaa', marginTop:4 }}>{stats.copecRows.length} documentos</p>
                  </div>
                </div>

                <div style={{ ...S.sectionTitle, marginTop:20 }}>Gasto por autorizador</div>
                <div style={S.grid(3, 8)}>
                  {Object.entries(stats.byAuth).sort((a, b) => b[1] - a[1]).map(([auth, total]) => (
                    <div key={auth} style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                      background:'#F5F5F0', borderRadius:8, padding:'10px 14px', border:'1px solid #E0E0D8' }}>
                      <span style={{ fontSize:12, fontWeight:700, color:'#555' }}>{auth}</span>
                      <span style={{ fontSize:12, fontWeight:600, color:'#333', ...S.mono }}>{fmtCLP(total)}</span>
                    </div>
                  ))}
                </div>

                <div style={{ ...S.sectionTitle, marginTop:20 }}>Top 5 proveedores (sin COPEC)</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {stats.top5.map(([prov, total], i) => {
                    const pct = stats.otrosTotal > 0 ? (total / stats.otrosTotal) * 100 : 0;
                    return (
                      <div key={prov} style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <span style={{ fontSize:11, color:'#aaa', width:16, textAlign:'right' }}>{i + 1}</span>
                        <div style={{ flex:1 }}>
                          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                            <span style={{ fontSize:11, color:'#555', maxWidth:400, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{prov}</span>
                            <span style={{ fontSize:11, fontWeight:600, color:'#333', ...S.mono }}>{fmtCLP(total)}</span>
                          </div>
                          <div style={{ height:6, background:'#EEEEEA', borderRadius:3, overflow:'hidden' }}>
                            <div style={{ height:'100%', borderRadius:3, width:`${Math.min(pct, 100)}%`,
                              background:'linear-gradient(90deg,#1D9E75,#14614B)' }}/>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={S.grid(3, 10)}>
                <button onClick={copyForSheets} style={S.btn('#2563EB')}>📋 Copiar para Sheets</button>
                <button onClick={downloadExcel} style={S.btn('#fff', '#14614B', '2px solid #1D9E75')}>⬇ Descargar Excel</button>
                <button onClick={() => window.print()} style={S.btn('#0D3B2E')}>🖨 Imprimir nómina</button>
              </div>
            </>)}
          </div>
        )}

        {/* ═══ TAB 4: BÚSQUEDA HISTÓRICA ═══ */}
        {tab === "buscar" && (
          <div className="fade-in">
            <div style={S.card}>
              <div style={S.sectionTitle}>Buscar en histórico</div>
              <div style={{ display:'flex', gap:10 }}>
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doSearch()}
                  placeholder="Buscar por Nº documento, RUT o proveedor…" style={{ ...S.input, flex:1 }}/>
                <button onClick={doSearch}
                  style={{ padding:'8px 24px', borderRadius:8, background:'#1D9E75', color:'#fff',
                    fontWeight:600, fontSize:13, border:'none', cursor:'pointer' }}>Buscar</button>
              </div>
              {loadingSheets && <p className="pulse" style={{ fontSize:11, color:'#aaa', marginTop:8 }}>Cargando datos…</p>}
            </div>

            {searchResults.length > 0 && (
              <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
                <div style={{ padding:'10px 16px', background:'#FAFAF7', borderBottom:'1px solid #E0E0D8' }}>
                  <span style={{ fontSize:11, color:'#888', fontWeight:500 }}>{searchResults.length} resultados</span>
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
                      {searchResults.map((r, i) => (
                        <tr key={i} style={{ borderBottom:'1px solid #f0f0ec', background: i % 2 ? '#FAFAF7' : '#fff' }}>
                          <td style={{ padding:'5px 10px', fontSize:11 }}>{r.FECHA_PAGO}</td>
                          <td style={{ padding:'5px 10px', fontSize:11, ...S.mono }}>{r.N_DOCUMENTO}</td>
                          <td style={{ padding:'5px 10px', fontSize:11, ...S.mono, color:'#888' }}>{r.RUT}</td>
                          <td style={{ padding:'5px 10px', fontSize:11 }}>{r.DETALLE}</td>
                          <td style={{ padding:'5px 10px', fontSize:11, textAlign:'right', fontWeight:600, ...S.mono }}>
                            {fmtCLP(parseFloat(r.MONTO) || 0)}
                          </td>
                          <td style={{ padding:'5px 10px', fontSize:11, textAlign:'center' }}>
                            {r.CUOTAS && r.CUOTAS !== 'nan' && (
                              <span style={{ background:'#DBEAFE', color:'#1D4ED8', padding:'2px 6px', borderRadius:99, fontSize:9 }}>{r.CUOTAS}</span>
                            )}
                          </td>
                          <td style={{ padding:'5px 10px', fontSize:11, textAlign:'center', fontWeight:700 }}>{r.AUTORIZADOR}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {searchQuery && searchResults.length === 0 && !loadingSheets && (
              <div style={{ ...S.card, textAlign:'center', padding:48, color:'#aaa' }}>
                Sin resultados para "{searchQuery}"
              </div>
            )}
          </div>
        )}
      </main>

      {/* ═══ PRINT VIEW ═══ */}
      {nominaRows.length > 0 && (
        <div className="print-only" style={{ padding:'0 8mm' }}>
          {/* Print Header */}
          <div style={{ borderBottom:'3px solid #0D3B2E', paddingBottom:10, marginBottom:14 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end' }}>
              <div>
                <h1 style={{ fontSize:17, fontWeight:800, color:'#0D3B2E', letterSpacing:'-.02em', margin:0 }}>
                  NÓMINA DE PAGO — VALE VISTA
                </h1>
                <p style={{ fontSize:10, color:'#666', margin:'2px 0 0' }}>Transportes Bello e Hijos Ltda. · RUT 88.397.100-0</p>
              </div>
              <div style={{ textAlign:'right' }}>
                <p style={{ fontSize:14, fontWeight:700, color:'#0D3B2E', margin:0 }}>
                  Pago: {fmtDate(parseDateInput(fechas.viernes))}
                </p>
                <p style={{ fontSize:9, color:'#888', margin:'2px 0 0' }}>
                  Semana {fmtDate(parseDateInput(fechas.lunes))} al {fmtDate(parseDateInput(fechas.domingo))}
                </p>
              </div>
            </div>
          </div>

          {/* Print Summary Bar */}
          <div style={{ display:'flex', gap:6, marginBottom:12 }}>
            <div style={{ flex:'1.2', background:'#E8F5EF', borderRadius:5, padding:'7px 10px', border:'1px solid #C5E8D5' }}>
              <p style={{ fontSize:7, color:'#0D3B2E', fontWeight:700, margin:0, textTransform:'uppercase' }}>Total General</p>
              <p style={{ fontSize:15, fontWeight:800, color:'#0D3B2E', margin:'2px 0 0', fontFamily:"'DM Mono',monospace" }}>{fmtCLP(stats.total)}</p>
            </div>
            <div style={{ flex:1, background:'#F5F5F0', borderRadius:5, padding:'7px 10px', border:'1px solid #E0E0D8' }}>
              <p style={{ fontSize:7, color:'#666', fontWeight:700, margin:0, textTransform:'uppercase' }}>Otros ({stats.otrosRows.length})</p>
              <p style={{ fontSize:13, fontWeight:700, color:'#333', margin:'2px 0 0', fontFamily:"'DM Mono',monospace" }}>{fmtCLP(stats.otrosTotal)}</p>
            </div>
            <div style={{ flex:1, background:'#F5F5F0', borderRadius:5, padding:'7px 10px', border:'1px solid #E0E0D8' }}>
              <p style={{ fontSize:7, color:'#666', fontWeight:700, margin:0, textTransform:'uppercase' }}>COPEC ({stats.copecRows.length})</p>
              <p style={{ fontSize:13, fontWeight:700, color:'#333', margin:'2px 0 0', fontFamily:"'DM Mono',monospace" }}>{fmtCLP(stats.copecTotal)}</p>
            </div>
            {Object.entries(stats.byAuth).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([auth, total]) => (
              <div key={auth} style={{ background:'#F5F5F0', borderRadius:5, padding:'7px 10px', border:'1px solid #E0E0D8', minWidth:70 }}>
                <p style={{ fontSize:7, color:'#666', fontWeight:700, margin:0 }}>{auth}</p>
                <p style={{ fontSize:10, fontWeight:700, color:'#333', margin:'2px 0 0', fontFamily:"'DM Mono',monospace" }}>{fmtCLP(total)}</p>
              </div>
            ))}
          </div>

          {/* Print Table */}
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:8 }}>
            <thead>
              <tr style={{ background:'#0D3B2E' }}>
                {[{h:'Nº DOC',a:'left'},{h:'RUT',a:'left'},{h:'DETALLE',a:'left'},{h:'MONTO',a:'right'},{h:'CUOTAS',a:'center'},{h:'AUTH',a:'center'}].map(c => (
                  <th key={c.h} style={{ color:'#fff', padding:'4px 5px', textAlign:c.a, fontSize:7, fontWeight:700, letterSpacing:'.05em' }}>{c.h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nominaRows.map((r, i) => (
                <tr key={r.id} style={{ borderBottom:'1px solid #E8E8E3', background: r.isNC ? '#FFF5F5' : i % 2 ? '#FAFAF7' : '#fff' }}>
                  <td style={{ padding:'3px 5px', fontFamily:"'DM Mono',monospace" }}>{r.nDoc}</td>
                  <td style={{ padding:'3px 5px', fontFamily:"'DM Mono',monospace", color:'#888' }}>{r.rut}</td>
                  <td style={{ padding:'3px 5px', maxWidth:280, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.detalle}</td>
                  <td style={{ padding:'3px 5px', textAlign:'right', fontWeight:600, fontFamily:"'DM Mono',monospace",
                    color: r.monto < 0 ? '#DC2626' : '#1a1a1a' }}>{fmtCLP(r.monto)}</td>
                  <td style={{ padding:'3px 5px', textAlign:'center', color:'#2563EB', fontSize:7 }}>{r.cuotas}</td>
                  <td style={{ padding:'3px 5px', textAlign:'center', fontWeight:700 }}>{r.autorizador}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Print Footer */}
          <div style={{ marginTop:14, borderTop:'2px solid #0D3B2E', paddingTop:8, display:'flex', justifyContent:'space-between' }}>
            <p style={{ fontSize:7, color:'#999', margin:0 }}>
              Generado: {new Date().toLocaleDateString('es-CL')} · Nómina Semanal v2 · Transportes Bello e Hijos Ltda.
            </p>
            <p style={{ fontSize:7, color:'#999', margin:0 }}>
              Firma Autorización: ________________________________
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────
function DropZone({ label, icon, hint, fileName, onFile }) {
  const [over, setOver] = useState(false);
  const ref = useRef();
  return (
    <div onClick={() => ref.current?.click()}
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); if(e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }}
      style={{ background:'#fff', borderRadius:12, border: fileName ? '2px solid #1D9E75' : over ? '2px dashed #1D9E75' : '2px dashed #ccc',
        padding:'28px 16px', textAlign:'center', cursor:'pointer', transition:'all .15s',
        ...(fileName || over ? { background:'rgba(29,158,117,.03)' } : {}), marginBottom:12 }}>
      <input ref={ref} type="file" accept=".xlsx,.xls" style={{ display:'none' }}
        onChange={e => { if(e.target.files[0]) onFile(e.target.files[0]); }}/>
      <div style={{ fontSize:30, marginBottom:6 }}>{fileName ? '✅' : icon}</div>
      <p style={{ fontSize:13, fontWeight:500, color:'#666' }}>{label}</p>
      {fileName
        ? <p style={{ fontSize:11, fontWeight:700, color:'#1D9E75', marginTop:4, wordBreak:'break-all' }}>{fileName}</p>
        : <p style={{ fontSize:11, color:'#aaa', marginTop:3 }}>{hint}</p>}
    </div>
  );
}

function Stat({ label, value, sub, highlight }) {
  return (
    <div style={{ borderRadius:10, padding:14, border:'1px solid', marginBottom:12,
      ...(highlight
        ? { background:'#1D9E75', borderColor:'#1D9E75', color:'#fff' }
        : { background:'#fff', borderColor:'#E0E0D8' }) }}>
      <p style={{ fontSize:11, fontWeight:500, color: highlight ? 'rgba(255,255,255,.7)' : '#888' }}>{label}</p>
      <p style={{ fontSize:20, fontWeight:700, marginTop:3, fontFamily:"'DM Mono',monospace" }}>{value}</p>
      {sub && <p style={{ fontSize:11, marginTop:2, color: highlight ? 'rgba(255,255,255,.6)' : '#aaa' }}>{sub}</p>}
    </div>
  );
}
