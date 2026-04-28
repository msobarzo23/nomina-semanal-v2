import { useMemo } from 'react';
import { fmtCLP, parseMonto } from '../utils.js';

export default function ProveedorDetalle({ proveedor, historico, onClose }) {
  const stats = useMemo(() => {
    if(!proveedor) return null;
    const facturas = historico
      .filter(h => h.DETALLE === proveedor)
      .map(h => ({
        fecha: h.FECHA_PAGO || '',
        nDoc: h.N_DOCUMENTO || '',
        rut: h.RUT || '',
        monto: parseMonto(h.MONTO),
        autorizador: h.AUTORIZADOR || '',
        cuotas: h.CUOTAS || '',
      }))
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

    const total = facturas.reduce((s, f) => s + f.monto, 0);
    const promedio = facturas.length > 0 ? total / facturas.length : 0;
    const ultimaFecha = facturas[0]?.fecha || '';
    const primeraFecha = facturas[facturas.length - 1]?.fecha || '';

    // Total por mes (últimos 12 meses)
    const porMes = {};
    facturas.forEach(f => {
      const mes = f.fecha.slice(0, 7); // YYYY-MM
      if(!mes) return;
      porMes[mes] = (porMes[mes] || 0) + f.monto;
    });
    const mesesOrdenados = Object.entries(porMes).sort((a,b) => a[0].localeCompare(b[0])).slice(-12);

    // Frecuencia: facturas por mes promedio
    const totalMeses = Object.keys(porMes).length || 1;
    const frecuencia = facturas.length / totalMeses;

    return { facturas, total, promedio, ultimaFecha, primeraFecha, frecuencia, mesesOrdenados };
  }, [proveedor, historico]);

  if(!proveedor || !stats) return null;

  return (
    <div onClick={onClose}
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:200,
        display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'4vh 16px',
        animation:'fadeIn .15s ease-out' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:'#fff', borderRadius:14, maxWidth:780, width:'100%', maxHeight:'92vh',
          overflow:'auto', boxShadow:'0 20px 60px rgba(0,0,0,.3)' }}>
        {/* Header */}
        <div style={{ padding:'18px 22px', borderBottom:'1px solid #E0E0D8',
          display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10,
          position:'sticky', top:0, background:'#fff', zIndex:1 }}>
          <div>
            <p style={{ fontSize:11, color:'#888', fontWeight:600 }}>PROVEEDOR</p>
            <h2 style={{ fontSize:16, fontWeight:800, color:'#0D3B2E', marginTop:2, lineHeight:1.3 }}>{proveedor}</h2>
            {stats.facturas[0]?.rut && (
              <p style={{ fontSize:11, color:'#888', marginTop:2, fontFamily:"'DM Mono',monospace" }}>{stats.facturas[0].rut}</p>
            )}
          </div>
          <button onClick={onClose}
            style={{ background:'transparent', border:'none', fontSize:24, color:'#888', cursor:'pointer', lineHeight:1, padding:'0 6px' }}>
            ×
          </button>
        </div>

        {stats.facturas.length === 0 ? (
          <div style={{ padding:48, textAlign:'center', color:'#aaa' }}>
            <p style={{ fontSize:14 }}>Sin historial para este proveedor</p>
          </div>
        ) : (
          <div style={{ padding:'18px 22px' }}>
            {/* Métricas */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:10, marginBottom:18 }}>
              {[
                { label:'Total histórico', value:fmtCLP(stats.total), color:'#0D3B2E' },
                { label:'Facturas',         value:`${stats.facturas.length}` },
                { label:'Monto promedio',   value:fmtCLP(stats.promedio) },
                { label:'Frecuencia',       value:`${stats.frecuencia.toFixed(1)}/mes` },
              ].map(m => (
                <div key={m.label} style={{ background:'#FAFAF7', border:'1px solid #E0E0D8', borderRadius:8, padding:'10px 12px' }}>
                  <p style={{ fontSize:10, color:'#888', fontWeight:600 }}>{m.label}</p>
                  <p style={{ fontSize:15, fontWeight:700, marginTop:3, color: m.color || '#222', fontFamily:"'DM Mono',monospace" }}>{m.value}</p>
                </div>
              ))}
            </div>

            <p style={{ fontSize:11, color:'#666', marginBottom:10 }}>
              <span style={{ color:'#aaa' }}>Primera: </span>
              <strong>{stats.primeraFecha}</strong>
              <span style={{ color:'#aaa', marginLeft:14 }}>Última: </span>
              <strong>{stats.ultimaFecha}</strong>
            </p>

            {/* Tabla de facturas */}
            <div style={{ border:'1px solid #E0E0D8', borderRadius:8, overflow:'hidden' }}>
              <div style={{ overflowX:'auto', maxHeight:'40vh', overflowY:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                  <thead style={{ position:'sticky', top:0, background:'#F3F4F6', zIndex:1 }}>
                    <tr>
                      {['FECHA','Nº DOC','MONTO','CUOTAS','AUTH'].map((h, i) => (
                        <th key={h} style={{ padding:'8px 10px', textAlign:i===2?'right':'left',
                          fontSize:10, fontWeight:700, color:'#555', borderBottom:'2px solid #E5E7EB',
                          letterSpacing:'.04em', textTransform:'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.facturas.map((f, i) => (
                      <tr key={i} style={{ borderBottom:'1px solid #f0f0ec', background: i % 2 ? '#FAFAF7' : '#fff' }}>
                        <td style={{ padding:'6px 10px', fontFamily:"'DM Mono',monospace" }}>{f.fecha}</td>
                        <td style={{ padding:'6px 10px', fontFamily:"'DM Mono',monospace", color:'#666' }}>{f.nDoc}</td>
                        <td style={{ padding:'6px 10px', textAlign:'right', fontWeight:600,
                          fontFamily:"'DM Mono',monospace", color: f.monto < 0 ? '#DC2626' : '#1a1a1a' }}>
                          {fmtCLP(f.monto)}
                        </td>
                        <td style={{ padding:'6px 10px', textAlign:'center', color:'#1D4ED8', fontWeight:600 }}>{f.cuotas}</td>
                        <td style={{ padding:'6px 10px', textAlign:'center', fontWeight:700 }}>{f.autorizador}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
