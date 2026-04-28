import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { HISTORICO_URL, AUTORIZADORES_URL, APPS_SCRIPT_URL, COPEC_EXCLUSIONS, CUOTA_RULES, AUTH_LIST } from './config.js';
import { fmtCLP, fmtDate, fmtDateISO, parseDate, parseDateInput, normDoc, getWeekDates, parseMonto, parseCuotas } from './utils.js';

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
  // Nuevos estados para persistencia
  const [nominasGuardadas, setNominasGuardadas] = useState([]);
  const [loadedFromSheet, setLoadedFromSheet] = useState(null); // fecha si viene cargada del sheet
  const [saving, setSaving] = useState(false);
  const [loadingNomina, setLoadingNomina] = useState(false);

  // ─── LOAD GOOGLE SHEETS ON MOUNT ───────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [hText, aText] = await Promise.all([
          fetch(HISTORICO_URL).then(r => r.text()),
          fetch(AUTORIZADORES_URL).then(r => r.text())
        ]);

        // Parseo robusto: normaliza headers (quita BOM/espacios) y valores (trim)
        const hParsed = Papa.parse(hText, {
          header: true,
          skipEmptyLines: true,
          transformHeader: h => (h || '').replace(/^\uFEFF/, '').trim(),
          transform: v => (typeof v === 'string' ? v.trim() : v),
        });
        setHistorico(hParsed.data || []);
        if (hParsed.data?.[0]) {
          console.log('[Histórico] Headers detectados:', Object.keys(hParsed.data[0]));
          console.log('[Histórico] Primera fila:', hParsed.data[0]);
          console.log('[Histórico] Total filas:', hParsed.data.length);
        } else {
          console.warn('[Histórico] No se cargaron filas');
        }

        const aParsed = Papa.parse(aText, {
          header: true,
          skipEmptyLines: true,
          transformHeader: h => (h || '').replace(/^\uFEFF/, '').trim(),
          transform: v => (typeof v === 'string' ? v.trim() : v),
        });
        const map = {};
        (aParsed.data || []).forEach(r => {
          if(r.DETALLE) map[r.DETALLE] = {
            auth: r.AUTORIZADOR_DEFAULT || '',
            cuotas: parseInt(r.CUOTAS_LBS) || 0
          };
        });
        setAuthMap(map);
      } catch(e) {
        console.error("Error cargando Google Sheets:", e);
        showToast("⚠️ No se pudieron cargar los datos históricos. Verifica tu conexión.");
      }
      setLoadingSheets(false);
      // Cargar listado de nóminas guardadas (en paralelo, no bloquea)
      fetchNominasGuardadas();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── APPS SCRIPT: LIST ─────────────────────────────────────────────
  const fetchNominasGuardadas = useCallback(async () => {
    if(!APPS_SCRIPT_URL || APPS_SCRIPT_URL.startsWith('PEGA_')) return;
    try {
      const r = await fetch(`${APPS_SCRIPT_URL}?action=list`);
      const j = await r.json();
      if(j.ok) setNominasGuardadas(j.nominas || []);
    } catch(e) { console.error("Error listando nóminas:", e); }
  }, []);

  // ─── APPS SCRIPT: LOAD ─────────────────────────────────────────────
  const loadNominaFromSheet = useCallback(async (fecha) => {
    if(!APPS_SCRIPT_URL || APPS_SCRIPT_URL.startsWith('PEGA_')) {
      showToast("⚠️ Apps Script no configurado — ver README_SETUP.md");
      return;
    }
    setLoadingNomina(true);
    try {
      const r = await fetch(`${APPS_SCRIPT_URL}?action=load&fecha=${encodeURIComponent(fecha)}`);
      const j = await r.json();
      if(!j.ok) { showToast(`❌ ${j.error || 'No se pudo cargar'}`); setLoadingNomina(false); return; }
      // Reconstruir estado
      const enc = j.encabezado;
      setFechas({
        lunes: enc.LUNES || '',
        domingo: enc.DOMINGO || '',
        viernes: enc.FECHA_PAGO || fecha,
      });
      const rows = (j.detalle || []).map((d, i) => ({
        id: `loaded-${i}`,
        fecha: d.FECHA_PAGO,
        nDoc: String(d.N_DOCUMENTO || ''),
        rut: String(d.RUT || ''),
        detalle: String(d.DETALLE || ''),
        monto: parseFloat(d.MONTO) || 0,
        cuotas: parseCuotas(d.CUOTAS),
        autorizador: String(d.AUTORIZADOR || 'MBL'),
        isNC: d.IS_NC === true || d.IS_NC === 'true' || d.IS_NC === 'TRUE',
        esCopec: d.ES_COPEC === true || d.ES_COPEC === 'true' || d.ES_COPEC === 'TRUE',
        isCombustible: d.ES_COPEC === true || d.ES_COPEC === 'true' || d.ES_COPEC === 'TRUE',
      }));
      setNominaRows(rows);
      setLoadedFromSheet(fecha);
      setTab("revision");
      showToast(`✓ Nómina del ${fecha} cargada (${rows.length} docs)`);
    } catch(e) {
      console.error(e);
      showToast("❌ Error cargando nómina");
    }
    setLoadingNomina(false);
  }, []);

  // ─── APPS SCRIPT: SAVE ─────────────────────────────────────────────
  const saveNominaToSheet = useCallback(async () => {
    if(!APPS_SCRIPT_URL || APPS_SCRIPT_URL.startsWith('PEGA_')) {
      showToast("⚠️ Apps Script no configurado — ver README_SETUP.md");
      return;
    }
    if(nominaRows.length === 0) { showToast("Sin datos para guardar"); return; }

    // Calcular totales (reusa la lógica del memo, pero recalculo directo para no depender del render)
    const esCombustibleActual = (r) => {
      const d = r.detalle.toUpperCase();
      if(d.includes('LUBRICANTES')) return false;
      return d.includes('COPEC S A') || d.includes('ESMAX DISTRIBUCION SPA');
    };
    const combRows = nominaRows.filter(r => esCombustibleActual(r));
    const provRows = nominaRows.filter(r => !esCombustibleActual(r));
    const totalComb = combRows.reduce((s,r) => s+r.monto, 0);
    const totalProv = provRows.reduce((s,r) => s+r.monto, 0);
    const total = totalComb + totalProv;

    const payload = {
      encabezado: {
        FECHA_PAGO: fechas.viernes,
        LUNES: fechas.lunes,
        DOMINGO: fechas.domingo,
        TOTAL: total,
        TOTAL_PROVEEDORES: totalProv,
        TOTAL_COPEC: totalComb,
        TOTAL_DOCS: nominaRows.length,
        APROBADOR: '',
        TIMESTAMP: new Date().toISOString(),
      },
      detalle: nominaRows.map(r => ({
        FECHA_PAGO: fechas.viernes,
        N_DOCUMENTO: r.nDoc,
        RUT: r.rut,
        DETALLE: r.detalle,
        MONTO: r.monto,
        CUOTAS: r.cuotas ? `'${r.cuotas}` : '',
        AUTORIZADOR: r.autorizador,
        ES_COPEC: !!r.esCopec,
        ES_LUBRICANTE: r.detalle.toUpperCase().includes('LUBRICANTES'),
        IS_NC: !!r.isNC,
      })),
    };

    setSaving(true);
    try {
      // Apps Script web apps no requieren headers especiales — usar text/plain para evitar preflight CORS
      const r = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'save', payload }),
      });
      const j = await r.json();
      if(j.ok) {
        showToast(`✓ Nómina ${fechas.viernes} guardada (${j.docs} docs)`);
        fetchNominasGuardadas();
        setLoadedFromSheet(fechas.viernes);
      } else {
        showToast(`❌ ${j.error || 'No se pudo guardar'}`);
      }
    } catch(e) {
      console.error(e);
      showToast("❌ Error guardando nómina");
    }
    setSaving(false);
  }, [nominaRows, fechas, fetchNominasGuardadas]);

  // ─── FILE READING ──────────────────────────────────────────────────
  const handleFile = (file, key) => {
    if(!file.name.match(/\.(xlsx|xls)$/i)) {
      showToast("❌ Solo se aceptan archivos Excel (.xlsx o .xls)");
      return;
    }
    if(file.size > 20 * 1024 * 1024) {
      showToast("❌ El archivo excede 20 MB");
      return;
    }
    setFileNames(p => ({ ...p, [key]: file.name }));
    const reader = new FileReader();
    reader.onerror = () => showToast("❌ No se pudo leer el archivo");
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type:'array', raw:true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:null });
        if(key === 'nomina') setDataNomina(raw);
        else setDataCopec(raw);
      } catch {
        showToast("❌ El archivo no es un Excel válido");
        setFileNames(p => ({ ...p, [key]: '' }));
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // ─── PROCESS ───────────────────────────────────────────────────────
  const processNomina = useCallback(() => {
    if(!dataNomina || !dataCopec) return;
    setProcessing(true);
    setLoadedFromSheet(null); // procesar una nueva siempre limpia el flag de "cargada"
    const lunes = parseDateInput(fechas.lunes);
    const domingo = parseDateInput(fechas.domingo);
    const pago = parseDateInput(fechas.viernes);
    if(!lunes || !domingo || !pago) { setProcessing(false); return; }

    const hIdx = dataNomina.findIndex(r => r && r.some(c => typeof c === 'string' && c.includes('Vencimiento')));
    if(hIdx < 0) { setProcessing(false); return; }
    const headers = dataNomina[hIdx].map(h => h ? h.toString().trim() : '');
    const col = {}; headers.forEach((h, i) => { if(h) col[h] = i; });
    const dataRows = dataNomina.slice(hIdx + 1).filter(r => r && r.some(c => c !== null && c !== ''));

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

    const pagoISO = fmtDateISO(pago);
    const histDocCount = {};
    historico.forEach(h => {
      if(h.AUTORIZADOR === 'LBS' && !COPEC_EXCLUSIONS.has(h.DETALLE)) {
        if(h.FECHA_PAGO && h.FECHA_PAGO >= pagoISO) return;
        const key = `${h.N_DOCUMENTO}|||${h.DETALLE}`;
        histDocCount[key] = (histDocCount[key] || 0) + 1;
      }
    });

    const result = [];
    const localDocCount = {};
    dataRows.forEach(row => {
      const venc = parseDate(row[col['Vencimiento']]);
      const fichaName = row[col['Ficha']]?.toString() || '';
      const razon = fichaName;
      const esCopec = fichaName.toUpperCase().includes('COPEC');
      const isCombustible = razon === 'COPEC S A' || razon === 'COPEC S A (NOTA DE CREDITO)' ||
                            razon === 'ESMAX DISTRIBUCION SPA' || razon === 'ESMAX DISTRIBUCION SPA (NOTA DE CREDITO)';
      const saldo = parseFloat(row[col['Saldo ($)']]) || 0;
      const numDoc = normDoc(row[col['Número Doc.']]);
      const rut = row[col['ID Ficha']]?.toString() || '';

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
        isNC, esCopec, isCombustible,
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

  const updateRow = (id, field, value) => {
    setNominaRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  // ─── STATS ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const esCombustibleActual = (r) => {
      const d = r.detalle.toUpperCase();
      if(d.includes('LUBRICANTES')) return false;
      return d.includes('COPEC S A') || d.includes('ESMAX DISTRIBUCION SPA');
    };
    const combustibleRows = nominaRows.filter(r => esCombustibleActual(r));
    const proveedorRows = nominaRows.filter(r => !esCombustibleActual(r));
    const combustibleTotal = combustibleRows.reduce((s, r) => s + r.monto, 0);
    const proveedorTotal = proveedorRows.reduce((s, r) => s + r.monto, 0);
    const total = combustibleTotal + proveedorTotal;
    const byAuth = {};
    nominaRows.forEach(r => { byAuth[r.autorizador] = (byAuth[r.autorizador] || 0) + r.monto; });
    const topProvs = {};
    proveedorRows.forEach(r => { topProvs[r.detalle] = (topProvs[r.detalle] || 0) + r.monto; });
    const top5 = Object.entries(topProvs).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const pagoISO = fechas.viernes;
    const weekTotals = {};
    historico.forEach(h => {
      const f = h.FECHA_PAGO;
      if(!f || f >= pagoISO) return;
      if(!weekTotals[f]) weekTotals[f] = { total:0, combustible:0, proveedores:0, docs:0 };
      const m = parseMonto(h.MONTO);
      const det = (h.DETALLE || '').toUpperCase();
      const esCombHist = (det.includes('COPEC S A') && !det.includes('LUBRICANTES')) || det.includes('ESMAX DISTRIBUCION SPA');
      weekTotals[f].total += m;
      weekTotals[f].docs += 1;
      if(esCombHist) weekTotals[f].combustible += m;
      else weekTotals[f].proveedores += m;
    });
    const sortedWeeks = Object.entries(weekTotals).sort((a,b) => a[0].localeCompare(b[0]));
    const prevWeek = sortedWeeks.length > 0 ? sortedWeeks[sortedWeeks.length - 1] : null;
    const varTotal = prevWeek && prevWeek[1].total ? ((total / prevWeek[1].total) - 1) * 100 : null;
    const varProveedores = prevWeek && prevWeek[1].proveedores ? ((proveedorTotal / prevWeek[1].proveedores) - 1) * 100 : null;
    const varCombustible = prevWeek && prevWeek[1].combustible ? ((combustibleTotal / prevWeek[1].combustible) - 1) * 100 : null;
    const last4 = sortedWeeks.slice(-4);
    const avg4Total = last4.length >= 2 ? last4.reduce((s,w) => s + w[1].total, 0) / last4.length : 0;
    const varVsAvg = avg4Total > 1000 ? ((total / avg4Total) - 1) * 100 : null;

    const alerts = [];
    if(varTotal !== null && Math.abs(varTotal) < 1000) {
      if(varTotal > 15) alerts.push({ type:'warn', text:`Nómina +${varTotal.toFixed(0)}% vs semana anterior` });
      if(varTotal < -15) alerts.push({ type:'good', text:`Nómina ${varTotal.toFixed(0)}% vs semana anterior` });
    }
    if(varProveedores !== null && Math.abs(varProveedores) < 1000) {
      if(varProveedores > 30) alerts.push({ type:'warn', text:`Proveedores +${varProveedores.toFixed(0)}% vs semana anterior` });
    }
    if(varVsAvg !== null && Math.abs(varVsAvg) < 1000) {
      if(varVsAvg > 15) alerts.push({ type:'warn', text:`+${varVsAvg.toFixed(0)}% sobre promedio mensual` });
    }
    const recentProvs = new Set();
    const recent8dates = new Set(sortedWeeks.slice(-8).map(w => w[0]));
    historico.forEach(h => {
      const det = (h.DETALLE || '').toUpperCase();
      const esCombHist2 = (det.includes('COPEC S A') && !det.includes('LUBRICANTES')) || det.includes('ESMAX DISTRIBUCION SPA');
      if(recent8dates.has(h.FECHA_PAGO) && !esCombHist2) recentProvs.add(h.DETALLE);
    });
    const newProvs = [...new Set(proveedorRows.filter(r => !recentProvs.has(r.detalle)).map(r => r.detalle))];
    if(newProvs.length > 0) alerts.push({ type:'info', text:`${newProvs.length} proveedor(es) nuevo(s): ${newProvs.slice(0,3).join(', ')}${newProvs.length>3?'…':''}` });

    return { combustibleRows, proveedorRows, combustibleTotal, proveedorTotal, total, byAuth, top5,
             totalDocs: nominaRows.length, prevWeek, varTotal, varProveedores, varCombustible,
             avg4Total, varVsAvg, alerts, sortedWeeks };
  }, [nominaRows, historico, fechas.viernes]);

  // ─── CORREO LBS ────────────────────────────────────────────────────
  const esPetroleo    = (detalle) => detalle.toUpperCase().includes('COPEC S A') && !detalle.toUpperCase().includes('LUBRICANTES');
  const esLubricante  = (detalle) => detalle.toUpperCase().includes('LUBRICANTES');

  const correoLBS = useMemo(() => {
    const petroleo    = nominaRows.filter(r => esPetroleo(r.detalle));
    const lubricantes = nominaRows.filter(r => esLubricante(r.detalle));
    const neumaticos  = nominaRows.filter(r =>
      r.autorizador === 'LBS' && !esPetroleo(r.detalle) && !esLubricante(r.detalle)
    );

    const totalPetroleo    = petroleo.reduce((s, r) => s + r.monto, 0);
    const totalLubricantes = lubricantes.reduce((s, r) => s + r.monto, 0);
    const totalNeumaticos  = neumaticos.reduce((s, r) => s + r.monto, 0);

    // Comparativo semana anterior + promedio 4 semanas desde histórico
    const pagoISO = fechas.viernes;
    const semanas = {};
    historico.forEach(h => {
      if(!h.FECHA_PAGO || h.FECHA_PAGO >= pagoISO) return;
      const f = h.FECHA_PAGO;
      if(!semanas[f]) semanas[f] = { petroleo:0, lubricantes:0, neumaticos:0 };
      const m = parseMonto(h.MONTO);
      const det = (h.DETALLE || '').toUpperCase();
      if(det.includes('LUBRICANTES')) semanas[f].lubricantes += m;
      else if(det.includes('COPEC S A')) semanas[f].petroleo += m;
      else if(h.AUTORIZADOR === 'LBS') semanas[f].neumaticos += m;
    });
    const semanasSorted = Object.entries(semanas).sort((a,b) => a[0].localeCompare(b[0]));
    const prevSemana = semanasSorted.length > 0 ? semanasSorted[semanasSorted.length - 1][1] : null;

    // Promedio 4 últimas semanas por categoría
    const last4 = semanasSorted.slice(-4).map(s => s[1]);
    const avg = (arr, key) => {
      const vals = arr.map(s => s[key]).filter(v => v > 0);
      return vals.length >= 2 ? vals.reduce((s,v) => s+v, 0) / vals.length : 0;
    };
    const avgP = avg(last4, 'petroleo');
    const avgL = avg(last4, 'lubricantes');
    const avgN = avg(last4, 'neumaticos');

    const varP = prevSemana?.petroleo    > 0 ? ((totalPetroleo    / prevSemana.petroleo)    - 1) * 100 : null;
    const varL = prevSemana?.lubricantes > 0 ? ((totalLubricantes / prevSemana.lubricantes) - 1) * 100 : null;
    const varN = prevSemana?.neumaticos  > 0 ? ((totalNeumaticos  / prevSemana.neumaticos)  - 1) * 100 : null;

    const varPavg = avgP > 0 ? ((totalPetroleo    / avgP) - 1) * 100 : null;
    const varLavg = avgL > 0 ? ((totalLubricantes / avgL) - 1) * 100 : null;
    const varNavg = avgN > 0 ? ((totalNeumaticos  / avgN) - 1) * 100 : null;

    // Alertas: una por categoría si variación supera umbrales
    const buildAlert = (label, vari, avgVar) => {
      const worst = [vari, avgVar].filter(v => v !== null).reduce((a,b) => Math.abs(b) > Math.abs(a||0) ? b : a, null);
      if(worst === null) return null;
      const absV = Math.abs(worst);
      if(absV < 15) return null;
      const level = absV >= 30 ? 'high' : 'medium';
      const direction = worst > 0 ? '▲' : '▼';
      const parts = [];
      if(vari !== null && Math.abs(vari) >= 15) parts.push(`${vari > 0 ? '+' : ''}${vari.toFixed(0)}% vs semana anterior`);
      if(avgVar !== null && Math.abs(avgVar) >= 15) parts.push(`${avgVar > 0 ? '+' : ''}${avgVar.toFixed(0)}% vs promedio 4 sem`);
      return { label, level, direction, parts };
    };
    const alerts = {
      petroleo:    buildAlert('Petróleo',    varP, varPavg),
      lubricantes: buildAlert('Lubricantes', varL, varLavg),
      neumaticos:  buildAlert('Neumáticos',  varN, varNavg),
    };

    return { petroleo, lubricantes, neumaticos,
             totalPetroleo, totalLubricantes, totalNeumaticos,
             prevSemana, varP, varL, varN,
             avgP, avgL, avgN, varPavg, varLavg, varNavg,
             alerts };
  }, [nominaRows, historico, fechas.viernes]);

  // ─── SEARCH ────────────────────────────────────────────────────────
  // Búsqueda robusta: concatena TODOS los valores de cada fila para no depender
  // de nombres exactos de columnas (en caso de BOM, espacios, o headers distintos)
  const doSearch = useCallback(() => {
    if(!searchQuery.trim()) { setSearchResults([]); return; }
    const q = searchQuery.trim().toLowerCase();
    const results = historico.filter(r => {
      if(!r || typeof r !== 'object') return false;
      const haystack = Object.values(r)
        .map(v => (v == null ? '' : v.toString()))
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    }).slice(0, 200);
    setSearchResults(results);
    console.log(`[Búsqueda] "${searchQuery}" → ${results.length} resultados`);
  }, [searchQuery, historico]);

  // Helper para acceder de forma tolerante a un campo que puede tener
  // varios nombres posibles (ej: FECHA_PAGO vs Fecha_Pago vs fecha_pago)
  const getField = (row, ...candidates) => {
    if(!row) return '';
    for(const c of candidates) {
      if(row[c] !== undefined && row[c] !== null && row[c] !== '') return row[c];
    }
    // fallback: busca case-insensitive
    const keys = Object.keys(row);
    for(const c of candidates) {
      const found = keys.find(k => k.toUpperCase() === c.toUpperCase());
      if(found && row[found] !== undefined && row[found] !== null && row[found] !== '') return row[found];
    }
    return '';
  };

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

  const copyForSheets = () => {
    const lines = nominaRows.map(r =>
      [r.fecha, r.nDoc, r.rut, r.detalle, r.monto, r.cuotas, r.autorizador].join('\t')
    );
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      showToast("✓ Copiado — pega en Google Sheets (Ctrl+V)");
    }).catch(() => {
      showToast("❌ No se pudo copiar al portapapeles");
    });
  };

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(""), 4000); };

  const S = {
    header: { background:'linear-gradient(135deg,#0D3B2E 0%,#14614B 50%,#1D9E75 100%)', color:'#fff', padding:'14px 24px' },
    headerInner: { maxWidth:1100, margin:'0 auto', display:'flex', alignItems:'center', justifyContent:'space-between', gap:16, flexWrap:'wrap' },
    tabs: { background:'#fff', borderBottom:'1px solid #E0E0D8', position:'sticky', top:0, zIndex:20 },
    tabsInner: { maxWidth:1100, margin:'0 auto', display:'flex', overflowX:'auto' },
    tabBtn: (active) => ({ padding:'12px 20px', fontSize:13, fontWeight:600, border:'none', background:active?'rgba(29,158,117,.04)':'none',
      cursor:'pointer', borderBottom:active?'2.5px solid #1D9E75':'2.5px solid transparent',
      color:active?'#14614B':'#999', transition:'all .2s', fontFamily:'var(--sans)', whiteSpace:'nowrap' }),
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
    { id:"carga",    label:"① Carga",       icon:"📁" },
    { id:"revision", label:"② Revisión",    icon:"✏️" },
    { id:"confirmar",label:"③ Confirmar",   icon:"✅" },
    { id:"anterior", label:"④ Anteriores",  icon:"📂" },
    { id:"buscar",   label:"⑤ Histórico",   icon:"🔍" },
    { id:"correo",   label:"⑥ Correo LBS",  icon:"✉️" },
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
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <div style={{ textAlign:'right' }}>
              {loadingSheets
                ? <span className="pulse" style={{ fontSize:11, opacity:.6 }}>Cargando…</span>
                : <span style={{ fontSize:11, opacity:.6 }}>
                    {historico.length.toLocaleString('de-DE')} registros · {nominasGuardadas.length} nóminas guardadas
                  </span>}
            </div>
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

      {/* Banner "cargada del sheet" */}
      {loadedFromSheet && nominaRows.length > 0 && (
        <div className="no-print" style={{ maxWidth:1100, margin:'12px auto 0', padding:'0 16px' }}>
          <div style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:10,
            padding:'10px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ fontSize:16 }}>📂</span>
              <div>
                <p style={{ fontSize:12, fontWeight:700, color:'#1E40AF' }}>Viendo nómina guardada · {loadedFromSheet}</p>
                <p style={{ fontSize:10, color:'#3B82F6', marginTop:2 }}>
                  Cambios hechos aquí no se guardan hasta que pulses "Guardar en Sheet" en la pestaña Confirmar
                </p>
              </div>
            </div>
            <button onClick={() => { setLoadedFromSheet(null); setNominaRows([]); setTab('carga'); }}
              style={{ padding:'6px 12px', background:'#fff', border:'1px solid #BFDBFE', borderRadius:6,
                fontSize:11, fontWeight:600, color:'#1E40AF', cursor:'pointer' }}>
              Limpiar y empezar nueva
            </button>
          </div>
        </div>
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
                <p style={{ fontSize:13 }}>Procesa archivos en la pestaña Carga, o abre una nómina anterior.</p>
              </div>
            ) : (<>
              <div style={S.grid(4, 10)}>
                <Stat label="Total facturas" value={stats.totalDocs}/>
                <Stat label="Otros proveedores" value={fmtCLP(stats.proveedorTotal)} sub={`${stats.proveedorRows.length} docs`}/>
                <Stat label="COPEC" value={fmtCLP(stats.combustibleTotal)} sub={`${stats.combustibleRows.length} docs`}/>
                <Stat label="TOTAL GENERAL" value={fmtCLP(stats.total)} highlight/>
              </div>
              {nominaRows.some(r => r.isNC) && (
                <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:12, padding:'12px 16px',
                  display:'flex', alignItems:'center', gap:12, marginBottom:12, marginTop:4 }}>
                  <span style={{ fontSize:18 }}>⚠️</span>
                  <p style={{ fontSize:13, color:'#92400E' }}>
                    <strong>{nominaRows.filter(r => r.isNC).length}</strong> notas de crédito detectadas — Nº Doc editable en NC. Detalle editable en todas las filas.
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
                            <input value={r.detalle} onChange={e => updateRow(r.id, 'detalle', e.target.value)}
                              style={{ width:'100%', border: r.isNC ? '1px solid #FCD34D' : '1px solid #E0E0D8', borderRadius:4, padding:'3px 6px',
                                fontSize:11, background: r.isNC ? '#FFFBEB' : '#FAFAF7', outline:'none',
                                transition:'all .15s', cursor:'text' }}
                              onFocus={e => { e.target.style.border='1px solid #1D9E75'; e.target.style.background='#fff'; e.target.style.boxShadow='0 0 0 2px rgba(29,158,117,.15)'; }}
                              onBlur={e => { e.target.style.border = r.isNC ? '1px solid #FCD34D' : '1px solid #E0E0D8'; e.target.style.background = r.isNC ? '#FFFBEB' : '#FAFAF7'; e.target.style.boxShadow='none'; }}/>
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
                Primero procesa los archivos en la pestaña Carga, o abre una anterior.
              </div>
            ) : (<>
              <div style={S.card}>
                <div style={S.sectionTitle}>Resumen nómina — Pago {fmtDate(parseDateInput(fechas.viernes))}</div>
                {stats.alerts.length > 0 && (
                  <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:16 }}>
                    {stats.alerts.map((a, i) => (
                      <div key={i} style={{ padding:'10px 14px', borderRadius:8, fontSize:12, fontWeight:600, display:'flex', alignItems:'center', gap:8,
                        background: a.type==='warn'?'#FFF7ED':a.type==='good'?'#F0FDF4':'#EFF6FF',
                        border: `1px solid ${a.type==='warn'?'#FED7AA':a.type==='good'?'#BBF7D0':'#BFDBFE'}`,
                        color: a.type==='warn'?'#9A3412':a.type==='good'?'#166534':'#1E40AF' }}>
                        <span>{a.type==='warn'?'⚠️':a.type==='good'?'✅':'ℹ️'}</span>{a.text}
                      </div>
                    ))}
                  </div>
                )}
                <div style={S.grid(3)}>
                  <div style={{ background:'#E8F5EF', borderRadius:12, padding:16, border:'1px solid #C5E8D5' }}>
                    <p style={{ fontSize:11, color:'#0D3B2E', fontWeight:600 }}>Total General</p>
                    <p style={{ fontSize:24, fontWeight:800, color:'#0D3B2E', marginTop:4, ...S.mono }}>{fmtCLP(stats.total)}</p>
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:6 }}>
                      <span style={{ fontSize:11, color:'#1D9E75' }}>{stats.totalDocs} documentos</span>
                      {stats.varTotal !== null && (
                        <span style={{ fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:4,
                          background: stats.varTotal > 0 ? '#FEF3C7' : '#D1FAE5',
                          color: stats.varTotal > 0 ? '#92400E' : '#065F46' }}>
                          {stats.varTotal > 0 ? '▲' : '▼'} {Math.abs(stats.varTotal).toFixed(1)}% vs anterior
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ background:'#F5F5F0', borderRadius:12, padding:16, border:'1px solid #E0E0D8' }}>
                    <p style={{ fontSize:11, color:'#666', fontWeight:600 }}>Proveedores</p>
                    <p style={{ fontSize:20, fontWeight:700, color:'#333', marginTop:4, ...S.mono }}>{fmtCLP(stats.proveedorTotal)}</p>
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:6 }}>
                      <span style={{ fontSize:11, color:'#aaa' }}>{stats.proveedorRows.length} docs</span>
                      {stats.varProveedores !== null && (
                        <span style={{ fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:4,
                          background: stats.varProveedores > 0 ? '#FEF3C7' : '#D1FAE5',
                          color: stats.varProveedores > 0 ? '#92400E' : '#065F46' }}>
                          {stats.varProveedores > 0 ? '▲' : '▼'} {Math.abs(stats.varProveedores).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ background:'#F5F5F0', borderRadius:12, padding:16, border:'1px solid #E0E0D8' }}>
                    <p style={{ fontSize:11, color:'#666', fontWeight:600 }}>Combustible (COPEC)</p>
                    <p style={{ fontSize:20, fontWeight:700, color:'#333', marginTop:4, ...S.mono }}>{fmtCLP(stats.combustibleTotal)}</p>
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:6 }}>
                      <span style={{ fontSize:11, color:'#aaa' }}>{stats.combustibleRows.length} docs</span>
                      {stats.varCombustible !== null && (
                        <span style={{ fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:4,
                          background: stats.varCombustible > 0 ? '#FEF3C7' : '#D1FAE5',
                          color: stats.varCombustible > 0 ? '#92400E' : '#065F46' }}>
                          {stats.varCombustible > 0 ? '▲' : '▼'} {Math.abs(stats.varCombustible).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {stats.avg4Total > 0 && (
                  <div style={{ marginTop:16, background:'#F9FAFB', borderRadius:10, padding:'12px 16px', border:'1px solid #E5E7EB' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <div>
                        <p style={{ fontSize:11, color:'#666', fontWeight:600 }}>Promedio últimas 4 semanas</p>
                        <p style={{ fontSize:16, fontWeight:700, color:'#333', marginTop:2, ...S.mono }}>{fmtCLP(stats.avg4Total)}</p>
                      </div>
                      <div style={{ textAlign:'right' }}>
                        <p style={{ fontSize:11, color:'#666' }}>Esta semana vs promedio</p>
                        <p style={{ fontSize:18, fontWeight:800, marginTop:2, ...S.mono,
                          color: stats.varVsAvg != null ? (stats.varVsAvg > 5 ? '#DC2626' : stats.varVsAvg < -5 ? '#059669' : '#333') : '#333' }}>
                          {stats.varVsAvg != null ? `${stats.varVsAvg > 0 ? '+' : ''}${stats.varVsAvg.toFixed(1)}%` : '—'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                <div style={{ ...S.sectionTitle, marginTop:20 }}>Principales proveedores de la semana</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {stats.top5.map(([prov, total], i) => {
                    const pct = stats.proveedorTotal > 0 ? (total / stats.proveedorTotal) * 100 : 0;
                    return (
                      <div key={prov} style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <span style={{ fontSize:11, color:'#aaa', width:16, textAlign:'right' }}>{i + 1}</span>
                        <div style={{ flex:1 }}>
                          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                            <span style={{ fontSize:11, color:'#555', maxWidth:400, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{prov}</span>
                            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                              <span style={{ fontSize:11, fontWeight:600, color:'#333', ...S.mono }}>{fmtCLP(total)}</span>
                              <span style={{ fontSize:10, color:'#999' }}>({pct.toFixed(0)}%)</span>
                            </div>
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
              {/* Botones de acción */}
              <div style={S.grid(2, 10)}>
                <button onClick={saveNominaToSheet} disabled={saving}
                  style={{ ...S.btn(saving ? '#bbb' : '#0D3B2E'),
                    boxShadow: saving ? 'none' : '0 4px 16px rgba(13,59,46,.3)' }}>
                  {saving ? 'Guardando…' : '💾 Guardar en Sheet'}
                </button>
                <button onClick={() => window.print()} style={S.btn('#1D9E75')}>
                  🖨 Imprimir nómina
                </button>
              </div>
              <div style={{ ...S.grid(2, 10), marginTop:10 }}>
                <button onClick={copyForSheets} style={S.btn('#2563EB')}>📋 Copiar para Sheets</button>
                <button onClick={downloadExcel} style={S.btn('#fff', '#14614B', '2px solid #1D9E75')}>⬇ Descargar Excel</button>
              </div>
            </>)}
          </div>
        )}

        {/* ═══ TAB 4: NÓMINAS ANTERIORES ═══ */}
        {tab === "anterior" && (
          <div className="fade-in">
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
                      {nominasGuardadas.map((n, i) => (
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
                    </tbody>
                  </table>
                </div>
              </div>
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
        )}

        {/* ═══ TAB 5: CORREO LBS ═══ */}
        {tab === "correo" && (
          <div className="fade-in">
            {nominaRows.length === 0 ? (
              <div style={{ ...S.card, textAlign:'center', padding:48, color:'#aaa' }}>
                <p style={{ fontSize:16, marginBottom:8 }}>Sin datos</p>
                <p style={{ fontSize:13 }}>Procesa una nómina o abre una anterior.</p>
              </div>
            ) : (<>
              {/* Cuadro comparativo con 4-week avg */}
              <div style={{ ...S.card, marginBottom:16 }}>
                <div style={S.sectionTitle}>Comparativo vs anterior y promedio 4 semanas — Pago {fechas.viernes}</div>
                <div style={S.grid(3, 10)}>
                  {[
                    { label:'Petróleo',    total: correoLBS.totalPetroleo,    prev: correoLBS.prevSemana?.petroleo,    avg: correoLBS.avgP, vari: correoLBS.varP, variAvg: correoLBS.varPavg, color:'#0D3B2E', bg:'#E8F5EF', border:'#C5E8D5' },
                    { label:'Lubricantes', total: correoLBS.totalLubricantes, prev: correoLBS.prevSemana?.lubricantes, avg: correoLBS.avgL, vari: correoLBS.varL, variAvg: correoLBS.varLavg, color:'#14614B', bg:'#F0FDF4', border:'#BBF7D0' },
                    { label:'Neumáticos',  total: correoLBS.totalNeumaticos,  prev: correoLBS.prevSemana?.neumaticos,  avg: correoLBS.avgN, vari: correoLBS.varN, variAvg: correoLBS.varNavg, color:'#1D4ED8', bg:'#EFF6FF', border:'#BFDBFE' },
                  ].map(({ label, total, prev, avg, vari, variAvg, color, bg, border }) => (
                    <div key={label} style={{ background:bg, borderRadius:10, padding:14, border:`1px solid ${border}` }}>
                      <p style={{ fontSize:11, fontWeight:700, color, textTransform:'uppercase', letterSpacing:'.04em' }}>{label}</p>
                      <p style={{ fontSize:20, fontWeight:800, color:'#1a1a1a', marginTop:4, fontFamily:"'DM Mono',monospace" }}>{fmtCLP(total)}</p>
                      <div style={{ display:'flex', flexDirection:'column', gap:3, marginTop:8 }}>
                        {prev != null && prev > 0 ? (
                          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                            <span style={{ fontSize:10, color:'#888' }}>Anterior: {fmtCLP(prev)}</span>
                            {vari !== null && (
                              <span style={{ fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:4,
                                background: vari > 0 ? '#FEF3C7' : '#D1FAE5',
                                color: vari > 0 ? '#92400E' : '#065F46' }}>
                                {vari > 0 ? '▲' : '▼'} {Math.abs(vari).toFixed(1)}%
                              </span>
                            )}
                          </div>
                        ) : <p style={{ fontSize:10, color:'#ccc' }}>Sin semana anterior</p>}
                        {avg > 0 ? (
                          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                            <span style={{ fontSize:10, color:'#888' }}>Promedio 4s: {fmtCLP(avg)}</span>
                            {variAvg !== null && (
                              <span style={{ fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:4,
                                background: variAvg > 0 ? '#FEF3C7' : '#D1FAE5',
                                color: variAvg > 0 ? '#92400E' : '#065F46' }}>
                                {variAvg > 0 ? '▲' : '▼'} {Math.abs(variAvg).toFixed(1)}%
                              </span>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Bloques de correo */}
              {[
                {
                  key: 'petroleo',
                  emoji: '⛽',
                  titulo: 'PETRÓLEO',
                  subtitulo: 'COPEC',
                  color: '#0D3B2E', colorLight: '#1D9E75',
                  bgHeader: '#E8F5EF', borderHeader: '#C5E8D5', bgStripe: '#F0FAF5',
                  rows: correoLBS.petroleo, total: correoLBS.totalPetroleo,
                  alert: correoLBS.alerts.petroleo,
                  prev: correoLBS.prevSemana?.petroleo, avg: correoLBS.avgP,
                  vari: correoLBS.varP, variAvg: correoLBS.varPavg,
                  showCuotas: false, showProveedor: false,
                },
                {
                  key: 'lubricantes',
                  emoji: '🛢️',
                  titulo: 'LUBRICANTES',
                  subtitulo: 'COPEC S A (LUBRICANTES)',
                  color: '#14614B', colorLight: '#22C55E',
                  bgHeader: '#F0FDF4', borderHeader: '#BBF7D0', bgStripe: '#F0FDF4',
                  rows: correoLBS.lubricantes, total: correoLBS.totalLubricantes,
                  alert: correoLBS.alerts.lubricantes,
                  prev: correoLBS.prevSemana?.lubricantes, avg: correoLBS.avgL,
                  vari: correoLBS.varL, variAvg: correoLBS.varLavg,
                  showCuotas: false, showProveedor: false,
                },
                {
                  key: 'neumaticos',
                  emoji: '🔧',
                  titulo: 'NEUMÁTICOS',
                  subtitulo: 'Neumáticos',
                  color: '#1D4ED8', colorLight: '#3B82F6',
                  bgHeader: '#EFF6FF', borderHeader: '#BFDBFE', bgStripe: '#F0F5FF',
                  rows: correoLBS.neumaticos, total: correoLBS.totalNeumaticos,
                  alert: correoLBS.alerts.neumaticos,
                  prev: correoLBS.prevSemana?.neumaticos, avg: correoLBS.avgN,
                  vari: correoLBS.varN, variAvg: correoLBS.varNavg,
                  showCuotas: true, showProveedor: true,
                },
              ].map(({ key, emoji, titulo, subtitulo, color, colorLight, bgHeader, borderHeader, bgStripe,
                       rows, total, alert, prev, avg, vari, variAvg, showCuotas, showProveedor }) => {
                const numCols = 3 + (showCuotas ? 1 : 0) + (showProveedor ? 1 : 0);

                // Color del banner de alerta embebido en correo
                const alertColors = alert ? (alert.level === 'high'
                  ? { bg:'#FEF2F2', border:'#FCA5A5', text:'#991B1B' }
                  : { bg:'#FFF7ED', border:'#FED7AA', text:'#9A3412' }) : null;

                // HTML del correo (incluye alerta si corresponde)
                const buildHTML = () => {
                  const alertHTML = alert ? `
                    <tr><td style="padding:0 28px 16px;">
                      <table width="100%" cellpadding="0" cellspacing="0" style="background:${alertColors.bg};border:1px solid ${alertColors.border};border-radius:8px;">
                        <tr><td style="padding:12px 14px;">
                          <p style="margin:0;font-size:12px;font-weight:700;color:${alertColors.text};">
                            ⚠️ Alerta: ${alert.label} ${alert.direction} — ${alert.parts.join(' · ')}
                          </p>
                        </td></tr>
                      </table>
                    </td></tr>` : '';

                  // Fila comparativa (siempre visible)
                  const cmpHTML = `
                    <tr><td style="padding:0 28px 14px;">
                      <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;">
                        <tr>
                          <td style="padding:10px 14px;font-size:11px;color:#6B7280;">Esta semana</td>
                          <td style="padding:10px 14px;font-size:11px;color:#6B7280;">Anterior</td>
                          <td style="padding:10px 14px;font-size:11px;color:#6B7280;">Prom. 4 sem</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 14px 10px;font-family:monospace;font-weight:700;font-size:13px;color:${color};">${fmtCLP(total)}</td>
                          <td style="padding:4px 14px 10px;font-family:monospace;font-size:12px;color:#444;">
                            ${prev ? fmtCLP(prev) : '—'}
                            ${vari !== null ? ` <span style="color:${vari > 0 ? '#B91C1C' : '#047857'};font-weight:700;">(${vari > 0 ? '▲' : '▼'}${Math.abs(vari).toFixed(0)}%)</span>` : ''}
                          </td>
                          <td style="padding:4px 14px 10px;font-family:monospace;font-size:12px;color:#444;">
                            ${avg > 0 ? fmtCLP(avg) : '—'}
                            ${variAvg !== null ? ` <span style="color:${variAvg > 0 ? '#B91C1C' : '#047857'};font-weight:700;">(${variAvg > 0 ? '▲' : '▼'}${Math.abs(variAvg).toFixed(0)}%)</span>` : ''}
                          </td>
                        </tr>
                      </table>
                    </td></tr>`;

                  const filasTR = rows.map((r, i) => {
                    const bg = i % 2 === 0 ? '#ffffff' : bgStripe;
                    const montoColor = r.monto < 0 ? '#DC2626' : '#1a1a1a';
                    const provTd = showProveedor
                      ? `<td style="padding:8px 12px;font-size:13px;color:#444;border-bottom:1px solid #E8E8E3;">${r.detalle}</td>` : '';
                    const cuotaTd = showCuotas
                      ? `<td style="padding:8px 12px;text-align:center;border-bottom:1px solid #E8E8E3;">
                          ${r.cuotas ? `<span style="background:#DBEAFE;color:#1D4ED8;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;">${r.cuotas}</span>` : ''}
                        </td>` : '';
                    return `<tr style="background:${bg};">
                      <td style="padding:8px 12px;font-family:monospace;font-size:13px;border-bottom:1px solid #E8E8E3;">${r.nDoc}</td>
                      <td style="padding:8px 12px;text-align:center;font-size:13px;color:#555;border-bottom:1px solid #E8E8E3;">${fechas.viernes}</td>
                      ${provTd}
                      <td style="padding:8px 12px;text-align:right;font-family:monospace;font-weight:600;font-size:13px;color:${montoColor};border-bottom:1px solid #E8E8E3;">${fmtCLP(r.monto)}</td>
                      ${cuotaTd}
                    </tr>`;
                  }).join('');

                  const provTh = showProveedor
                    ? `<th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#555;background:#F3F4F6;border-bottom:2px solid #E5E7EB;text-transform:uppercase;letter-spacing:.04em;">Proveedor</th>` : '';
                  const cuotaTh = showCuotas
                    ? `<th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#555;background:#F3F4F6;border-bottom:2px solid #E5E7EB;text-transform:uppercase;letter-spacing:.04em;">Cuota</th>` : '';
                  const totalTdExtra = showProveedor ? `<td style="padding:10px 12px;background:#F8F9FA;border-top:2px solid #dee2e6;"></td>` : '';
                  const totalCuotaTd = showCuotas ? `<td style="padding:10px 12px;background:#F8F9FA;border-top:2px solid #dee2e6;"></td>` : '';

                  return `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f4f4f0;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;margin:0 auto;background:#f4f4f0;">
                    <tr><td style="padding:32px 24px 16px;">
                      <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,${color} 0%,${colorLight} 100%);border-radius:12px 12px 0 0;">
                        <tr><td style="padding:24px 28px;">
                          <p style="margin:0;font-size:26px;line-height:1;">${emoji}</p>
                          <p style="margin:6px 0 0;font-size:20px;font-weight:800;color:#fff;letter-spacing:.04em;">${titulo}</p>
                          <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,.75);">Transportes Bello e Hijos Ltda. &nbsp;·&nbsp; Fecha de pago: <strong>${fechas.viernes}</strong></p>
                        </td></tr>
                      </table>
                      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:0 0 12px 12px;border:1px solid #E0E0D8;border-top:none;">
                        <tr><td style="padding:24px 28px 8px;">
                          <p style="margin:0;font-size:14px;color:#333;">Estimado Luis,</p>
                          <p style="margin:8px 0 0;font-size:14px;color:#333;font-weight:700;">Favor revisar y dar V° B° para pago.</p>
                        </td></tr>
                        ${alertHTML}
                        ${cmpHTML}
                        <tr><td style="padding:0 28px 28px;">
                          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #E0E0D8;">
                            <thead>
                              <tr style="background:${color};">
                                <th colspan="${numCols}" style="padding:10px 12px;text-align:center;font-size:13px;font-weight:800;color:#fff;letter-spacing:.06em;">${subtitulo}</th>
                              </tr>
                              <tr>
                                <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#555;background:#F3F4F6;border-bottom:2px solid #E5E7EB;text-transform:uppercase;letter-spacing:.04em;">N° Documento</th>
                                <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#555;background:#F3F4F6;border-bottom:2px solid #E5E7EB;text-transform:uppercase;letter-spacing:.04em;">Fecha pago</th>
                                ${provTh}
                                <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;color:#555;background:#F3F4F6;border-bottom:2px solid #E5E7EB;text-transform:uppercase;letter-spacing:.04em;">Monto</th>
                                ${cuotaTh}
                              </tr>
                            </thead>
                            <tbody>${filasTR}</tbody>
                            <tfoot>
                              <tr>
                                <td style="padding:10px 12px;font-weight:800;font-size:14px;color:#111;background:#F8F9FA;border-top:2px solid #dee2e6;">TOTAL</td>
                                <td style="padding:10px 12px;background:#F8F9FA;border-top:2px solid #dee2e6;"></td>
                                ${totalTdExtra}
                                <td style="padding:10px 12px;text-align:right;font-family:monospace;font-weight:800;font-size:15px;color:${color};background:#F8F9FA;border-top:2px solid #dee2e6;">${fmtCLP(total)}</td>
                                ${totalCuotaTd}
                              </tr>
                            </tfoot>
                          </table>
                        </td></tr>
                      </table>
                      <p style="text-align:center;font-size:11px;color:#aaa;margin:12px 0 0;">Generado por Sistema Nómina Semanal · Transportes Bello e Hijos Ltda.</p>
                    </td></tr>
                  </table></body></html>`;
                };

                return (
                <div key={key} style={{ ...S.card, marginBottom:16 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                    <div style={{ background:bgHeader, border:`1px solid ${borderHeader}`, borderRadius:8,
                      padding:'6px 16px', display:'inline-flex', alignItems:'center', gap:10 }}>
                      <span style={{ fontSize:18 }}>{emoji}</span>
                      <span style={{ fontSize:14, fontWeight:800, color, letterSpacing:'.05em' }}>{titulo}</span>
                      <span style={{ fontSize:11, color, opacity:.65 }}>
                        {rows.length} doc{rows.length !== 1 ? 's' : ''} · {fmtCLP(total)}
                      </span>
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      <button
                        onClick={() => {
                          const html = buildHTML().replace(
                            '</body>',
                            '<script>window.onload=function(){window.focus();window.print();};<\/script></body>'
                          );
                          const w = window.open('', '_blank', 'width=800,height=900');
                          if(!w) { showToast('⚠️ Permite ventanas emergentes para imprimir'); return; }
                          w.document.open();
                          w.document.write(html);
                          w.document.close();
                        }}
                        style={{ padding:'9px 18px', borderRadius:8, background:'#fff', color,
                          fontWeight:700, fontSize:12, border:`2px solid ${color}`, cursor:'pointer',
                          display:'flex', alignItems:'center', gap:6 }}>
                        🖨 Imprimir
                      </button>
                      <button
                        onClick={() => {
                          const html = buildHTML();
                          try {
                            const blob = new Blob([html], { type: 'text/html' });
                            const data = new ClipboardItem({ 'text/html': blob });
                            navigator.clipboard.write([data]).then(() =>
                              showToast(`✓ Correo ${titulo} copiado — pega directo en Outlook o Gmail`)
                            );
                          } catch {
                            const filas = rows.map(r => {
                              const base = [r.nDoc, fechas.viernes];
                              if(showProveedor) base.push(r.detalle);
                              base.push(r.monto.toLocaleString('de-DE'));
                              if(showCuotas) base.push(r.cuotas || '');
                              return base.join('\t');
                            });
                            navigator.clipboard.writeText(
                              [`Estimado Luis,`, ``, `Favor revisar y dar Vº Bº para pago.`, ``, subtitulo, ...filas,
                               `TOTAL\t\t${total.toLocaleString('de-DE')}`].join('\n')
                            ).then(() => showToast(`✓ Correo ${titulo} copiado`));
                          }
                        }}
                        style={{ padding:'9px 22px', borderRadius:8, background:color, color:'#fff',
                          fontWeight:700, fontSize:12, border:'none', cursor:'pointer',
                          display:'flex', alignItems:'center', gap:6,
                          boxShadow:`0 3px 10px ${color}55` }}>
                        📋 Copiar correo
                      </button>
                    </div>
                  </div>

                  {/* Alerta en la vista previa */}
                  {alert && (
                    <div style={{ background: alertColors.bg, border:`1px solid ${alertColors.border}`,
                      borderRadius:8, padding:'10px 14px', marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontSize:16 }}>⚠️</span>
                      <p style={{ fontSize:12, fontWeight:700, color: alertColors.text }}>
                        {alert.label} {alert.direction} — {alert.parts.join(' · ')}
                      </p>
                    </div>
                  )}

                  {rows.length === 0 ? (
                    <div style={{ background:'#FAFAF7', borderRadius:8, padding:24, textAlign:'center', color:'#bbb', fontSize:12 }}>
                      No hay documentos en esta categoría para la semana procesada.
                    </div>
                  ) : (
                    <div style={{ borderRadius:10, overflow:'hidden', border:`1px solid ${borderHeader}` }}>
                      <div style={{ background:`linear-gradient(135deg, ${color} 0%, ${colorLight} 100%)`, padding:'18px 22px' }}>
                        <div style={{ fontSize:22, marginBottom:4 }}>{emoji}</div>
                        <div style={{ fontSize:16, fontWeight:800, color:'#fff', letterSpacing:'.04em' }}>{titulo}</div>
                        <div style={{ fontSize:11, color:'rgba(255,255,255,.75)', marginTop:3 }}>
                          Transportes Bello e Hijos Ltda. · Fecha de pago: <strong>{fechas.viernes}</strong>
                        </div>
                      </div>
                      <div style={{ background:'#fff', padding:'20px 22px 4px' }}>
                        <p style={{ fontSize:13, color:'#333', margin:'0 0 6px' }}>Estimado Luis,</p>
                        <p style={{ fontSize:13, color:'#333', fontWeight:700, margin:'0 0 18px' }}>Favor revisar y dar V° B° para pago.</p>
                      </div>
                      {/* Comparativo compacto dentro de la vista previa */}
                      <div style={{ padding:'0 22px 14px', background:'#fff' }}>
                        <div style={{ background:'#F9FAFB', border:'1px solid #E5E7EB', borderRadius:8, padding:'10px 14px',
                          display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
                          <div>
                            <p style={{ fontSize:10, color:'#6B7280' }}>Esta semana</p>
                            <p style={{ ...S.mono, fontWeight:700, fontSize:13, color, marginTop:2 }}>{fmtCLP(total)}</p>
                          </div>
                          <div>
                            <p style={{ fontSize:10, color:'#6B7280' }}>Anterior</p>
                            <p style={{ ...S.mono, fontSize:12, color:'#444', marginTop:2 }}>
                              {prev ? fmtCLP(prev) : '—'}
                              {vari !== null && (
                                <span style={{ color: vari > 0 ? '#B91C1C' : '#047857', fontWeight:700, marginLeft:4 }}>
                                  ({vari > 0 ? '▲' : '▼'}{Math.abs(vari).toFixed(0)}%)
                                </span>
                              )}
                            </p>
                          </div>
                          <div>
                            <p style={{ fontSize:10, color:'#6B7280' }}>Prom. 4 sem</p>
                            <p style={{ ...S.mono, fontSize:12, color:'#444', marginTop:2 }}>
                              {avg > 0 ? fmtCLP(avg) : '—'}
                              {variAvg !== null && (
                                <span style={{ color: variAvg > 0 ? '#B91C1C' : '#047857', fontWeight:700, marginLeft:4 }}>
                                  ({variAvg > 0 ? '▲' : '▼'}{Math.abs(variAvg).toFixed(0)}%)
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div style={{ padding:'0 22px 22px', background:'#fff' }}>
                        <table style={{ width:'100%', borderCollapse:'collapse', borderRadius:8, overflow:'hidden', border:'1px solid #E0E0D8', fontSize:12 }}>
                          <thead>
                            <tr style={{ background:color }}>
                              <th colSpan={numCols}
                                style={{ color:'#fff', padding:'9px 12px', textAlign:'center',
                                  fontWeight:800, letterSpacing:'.06em', fontSize:12 }}>
                                {subtitulo}
                              </th>
                            </tr>
                            <tr style={{ background:'#F3F4F6' }}>
                              <th style={{ padding:'7px 12px', textAlign:'left',   fontSize:10, fontWeight:700, color:'#555', borderBottom:'2px solid #E5E7EB', textTransform:'uppercase', letterSpacing:'.04em' }}>N° Documento</th>
                              <th style={{ padding:'7px 12px', textAlign:'center', fontSize:10, fontWeight:700, color:'#555', borderBottom:'2px solid #E5E7EB', textTransform:'uppercase', letterSpacing:'.04em' }}>Fecha pago</th>
                              {showProveedor && <th style={{ padding:'7px 12px', textAlign:'left', fontSize:10, fontWeight:700, color:'#555', borderBottom:'2px solid #E5E7EB', textTransform:'uppercase', letterSpacing:'.04em' }}>Proveedor</th>}
                              <th style={{ padding:'7px 12px', textAlign:'right',  fontSize:10, fontWeight:700, color:'#555', borderBottom:'2px solid #E5E7EB', textTransform:'uppercase', letterSpacing:'.04em' }}>Monto</th>
                              {showCuotas && <th style={{ padding:'7px 12px', textAlign:'center', fontSize:10, fontWeight:700, color:'#555', borderBottom:'2px solid #E5E7EB', textTransform:'uppercase', letterSpacing:'.04em' }}>Cuota</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r, i) => (
                              <tr key={r.id} style={{ background: i % 2 ? bgStripe : '#fff', borderBottom:'1px solid #E8E8E3' }}>
                                <td style={{ padding:'7px 12px', fontFamily:"'DM Mono',monospace", fontSize:12 }}>{r.nDoc}</td>
                                <td style={{ padding:'7px 12px', textAlign:'center', fontSize:12, color:'#555' }}>{fechas.viernes}</td>
                                {showProveedor && (
                                  <td style={{ padding:'7px 12px', fontSize:12, color:'#444' }}>{r.detalle}</td>
                                )}
                                <td style={{ padding:'7px 12px', textAlign:'right', fontWeight:600,
                                  fontFamily:"'DM Mono',monospace", fontSize:12,
                                  color: r.monto < 0 ? '#DC2626' : '#1a1a1a' }}>
                                  {fmtCLP(r.monto)}
                                </td>
                                {showCuotas && (
                                  <td style={{ padding:'7px 12px', textAlign:'center' }}>
                                    {r.cuotas && (
                                      <span style={{ background:'#DBEAFE', color:'#1D4ED8',
                                        fontSize:10, fontWeight:700, padding:'3px 9px', borderRadius:99 }}>
                                        {r.cuotas}
                                      </span>
                                    )}
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr style={{ background:'#F8F9FA', borderTop:'2px solid #dee2e6' }}>
                              <td style={{ padding:'9px 12px', fontWeight:800, fontSize:13, color:'#111' }}>TOTAL</td>
                              <td />
                              {showProveedor && <td />}
                              <td style={{ padding:'9px 12px', textAlign:'right', fontWeight:800,
                                fontFamily:"'DM Mono',monospace", fontSize:14, color }}>
                                {fmtCLP(total)}
                              </td>
                              {showCuotas && <td />}
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                      <div style={{ background:'#FAFAF7', borderTop:`1px solid ${borderHeader}`, padding:'10px 22px', textAlign:'center' }}>
                        <span style={{ fontSize:10, color:'#aaa' }}>Sistema Nómina Semanal · Transportes Bello e Hijos Ltda.</span>
                      </div>
                    </div>
                  )}
                </div>
                );
              })}
            </>)}
          </div>
        )}

        {/* ═══ TAB: BÚSQUEDA HISTÓRICA ═══ */}
        {tab === "buscar" && (
          <div className="fade-in">
            <div style={S.card}>
              <div style={S.sectionTitle}>Buscar en histórico</div>
              <div style={{ display:'flex', gap:10 }}>
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doSearch()}
                  placeholder="Buscar por Nº documento, RUT, proveedor o fecha…" style={{ ...S.input, flex:1 }}/>
                <button onClick={doSearch}
                  style={{ padding:'8px 24px', borderRadius:8, background:'#1D9E75', color:'#fff',
                    fontWeight:600, fontSize:13, border:'none', cursor:'pointer' }}>Buscar</button>
              </div>
              {loadingSheets && <p className="pulse" style={{ fontSize:11, color:'#aaa', marginTop:8 }}>Cargando datos…</p>}
              {!loadingSheets && historico.length > 0 && (
                <p style={{ fontSize:10, color:'#bbb', marginTop:6 }}>
                  {historico.length.toLocaleString('de-DE')} registros cargados · {getField(historico[0], 'FECHA_PAGO')} a {getField(historico[historico.length-1], 'FECHA_PAGO')}
                </p>
              )}
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
        <div className="print-only" style={{ padding:'0 2mm' }}>
          <div style={{ borderBottom:'3px solid #0D3B2E', paddingBottom:10, marginBottom:12 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end' }}>
              <div>
                <h1 style={{ fontSize:20, fontWeight:800, color:'#0D3B2E', letterSpacing:'.08em', margin:0 }}>
                  NÓMINA SEMANAL
                </h1>
                <p style={{ fontSize:10, color:'#555', margin:'3px 0 0' }}>
                  Transportes Bello e Hijos Ltda. · RUT 88.397.100-0
                </p>
              </div>
              <div style={{ textAlign:'right' }}>
                <p style={{ fontSize:16, fontWeight:800, color:'#0D3B2E', margin:0 }}>
                  {fmtDate(parseDateInput(fechas.viernes))}
                </p>
                <p style={{ fontSize:9, color:'#888', margin:'2px 0 0' }}>
                  Semana {fmtDate(parseDateInput(fechas.lunes))} — {fmtDate(parseDateInput(fechas.domingo))}
                </p>
              </div>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:10 }}>
            <div style={{ background:'#E8F5EF', borderRadius:5, padding:'8px 10px', border:'1px solid #C5E8D5' }}>
              <p style={{ fontSize:8, color:'#0D3B2E', fontWeight:700, margin:0, textTransform:'uppercase', letterSpacing:'.04em' }}>Total General</p>
              <p style={{ fontSize:18, fontWeight:800, color:'#0D3B2E', margin:'3px 0 0', fontFamily:"'DM Mono',monospace" }}>{fmtCLP(stats.total)}</p>
              <p style={{ fontSize:8, color:'#0D3B2E', margin:'2px 0 0' }}>{stats.totalDocs} documentos
                {stats.varTotal !== null && <span style={{ marginLeft:8, fontWeight:700, color: stats.varTotal > 0 ? '#B91C1C' : '#047857' }}>
                  {stats.varTotal > 0 ? '▲' : '▼'} {Math.abs(stats.varTotal).toFixed(1)}% vs semana anterior
                </span>}
              </p>
            </div>
            <div style={{ background:'#F5F5F0', borderRadius:5, padding:'8px 10px', border:'1px solid #E0E0D8' }}>
              <p style={{ fontSize:8, color:'#555', fontWeight:700, margin:0, textTransform:'uppercase', letterSpacing:'.04em' }}>Proveedores ({stats.proveedorRows.length} docs)</p>
              <p style={{ fontSize:16, fontWeight:700, color:'#222', margin:'3px 0 0', fontFamily:"'DM Mono',monospace" }}>{fmtCLP(stats.proveedorTotal)}</p>
              {stats.varProveedores !== null && <p style={{ fontSize:8, margin:'2px 0 0', fontWeight:700, color: stats.varProveedores > 0 ? '#B91C1C' : '#047857' }}>
                {stats.varProveedores > 0 ? '▲' : '▼'} {Math.abs(stats.varProveedores).toFixed(1)}% vs semana anterior</p>}
            </div>
            <div style={{ background:'#F5F5F0', borderRadius:5, padding:'8px 10px', border:'1px solid #E0E0D8' }}>
              <p style={{ fontSize:8, color:'#555', fontWeight:700, margin:0, textTransform:'uppercase', letterSpacing:'.04em' }}>Combustible ({stats.combustibleRows.length} docs)</p>
              <p style={{ fontSize:16, fontWeight:700, color:'#222', margin:'3px 0 0', fontFamily:"'DM Mono',monospace" }}>{fmtCLP(stats.combustibleTotal)}</p>
              {stats.varCombustible !== null && <p style={{ fontSize:8, margin:'2px 0 0', fontWeight:700, color: stats.varCombustible > 0 ? '#B91C1C' : '#047857' }}>
                {stats.varCombustible > 0 ? '▲' : '▼'} {Math.abs(stats.varCombustible).toFixed(1)}% vs semana anterior</p>}
            </div>
            {stats.avg4Total > 0 && (
              <div style={{ background: stats.varVsAvg != null && Math.abs(stats.varVsAvg) > 10 ? '#FFF7ED' : '#F5F5F0', borderRadius:5, padding:'8px 10px',
                border: `1px solid ${stats.varVsAvg != null && Math.abs(stats.varVsAvg) > 10 ? '#FED7AA' : '#E0E0D8'}` }}>
                <p style={{ fontSize:8, color:'#555', fontWeight:700, margin:0, textTransform:'uppercase', letterSpacing:'.04em' }}>Promedio 4 semanas</p>
                <p style={{ fontSize:16, fontWeight:700, color:'#222', margin:'3px 0 0', fontFamily:"'DM Mono',monospace" }}>{fmtCLP(stats.avg4Total)}</p>
                {stats.varVsAvg != null && (
                  <p style={{ fontSize:8, margin:'2px 0 0', fontWeight:700, color: stats.varVsAvg > 5 ? '#B91C1C' : stats.varVsAvg < -5 ? '#047857' : '#555' }}>
                    {stats.varVsAvg > 0 ? '+' : ''}{stats.varVsAvg.toFixed(1)}% esta semana vs promedio</p>
                )}
              </div>
            )}
          </div>
          <div style={{ marginBottom:10, padding:'5px 0', borderTop:'1px solid #E0E0D8', borderBottom:'1px solid #E0E0D8' }}>
            <div style={{ display:'flex', alignItems:'center', gap:4, flexWrap:'wrap' }}>
              <span style={{ fontSize:7.5, color:'#888', fontWeight:700 }}>PRINCIPALES PROVEEDORES:</span>
              {stats.top5.map(([prov, total], i) => (
                <span key={prov} style={{ fontSize:7.5, color:'#444' }}>
                  <span style={{ fontWeight:700 }}>{i+1}.</span> {prov.length > 22 ? prov.slice(0,22)+'…' : prov}{' '}
                  <span style={{ fontWeight:700, fontFamily:"'DM Mono',monospace" }}>{fmtCLP(total)}</span>
                  {i < stats.top5.length - 1 ? <span style={{ color:'#ccc' }}> │ </span> : ''}
                </span>
              ))}
            </div>
          </div>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ background:'#0D3B2E' }}>
                <th style={{ color:'#fff', padding:'4px 5px', textAlign:'left', fontSize:8, fontWeight:700, letterSpacing:'.03em', width:'12%' }}>Nº DOC</th>
                <th style={{ color:'#fff', padding:'4px 5px', textAlign:'left', fontSize:8, fontWeight:700, letterSpacing:'.03em', width:'15%' }}>RUT</th>
                <th style={{ color:'#fff', padding:'4px 5px', textAlign:'left', fontSize:8, fontWeight:700, letterSpacing:'.03em' }}>DETALLE</th>
                <th style={{ color:'#fff', padding:'4px 5px', textAlign:'right', fontSize:8, fontWeight:700, letterSpacing:'.03em', width:'16%' }}>MONTO</th>
                <th style={{ color:'#fff', padding:'4px 5px', textAlign:'center', fontSize:8, fontWeight:700, letterSpacing:'.03em', width:'8%' }}>CUOTAS</th>
              </tr>
            </thead>
            <tbody>
              {nominaRows.map((r, i) => (
                <tr key={r.id} style={{ borderBottom:'1px solid #E8E8E3', background: r.isNC ? '#FFF5F5' : i % 2 ? '#FAFAF7' : '#fff' }}>
                  <td style={{ padding:'3px 5px', fontFamily:"'DM Mono',monospace", fontSize:8.5 }}>{r.nDoc}</td>
                  <td style={{ padding:'3px 5px', fontFamily:"'DM Mono',monospace", color:'#777', fontSize:8 }}>{r.rut}</td>
                  <td style={{ padding:'3px 5px', fontSize:8, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:200 }}>{r.detalle}</td>
                  <td style={{ padding:'3px 5px', textAlign:'right', fontWeight:600, fontFamily:"'DM Mono',monospace", fontSize:8.5,
                    color: r.monto < 0 ? '#DC2626' : '#1a1a1a' }}>{fmtCLP(r.monto)}</td>
                  <td style={{ padding:'3px 5px', textAlign:'center', color:'#1D4ED8', fontSize:8, fontWeight:600 }}>{r.cuotas}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop:30, paddingTop:10 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end' }}>
              <p style={{ fontSize:7.5, color:'#aaa', margin:0 }}>
                Generado: {new Date().toLocaleDateString('es-CL')} · Transportes Bello e Hijos Ltda.
              </p>
              <div style={{ textAlign:'center' }}>
                <div style={{ borderBottom:'1px solid #444', width:220, height:30 }}></div>
                <p style={{ fontSize:8, color:'#444', fontWeight:700, margin:'4px 0 0', letterSpacing:'.03em' }}>Firma Gerente General</p>
              </div>
            </div>
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
