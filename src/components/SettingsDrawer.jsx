export const DEFAULT_EMAIL_CONFIG = {
  saludo:    'Estimado Luis,',
  cuerpo:    'Favor revisar y dar V° B° para pago.',
  empresa:   'Transportes Bello e Hijos Ltda.',
  rut:       '88.397.100-0',
  pie:       'Sistema Nómina Semanal · Transportes Bello e Hijos Ltda.',
};

export default function SettingsDrawer({ open, config, setConfig, onClose }) {
  if(!open) return null;
  const update = (k, v) => setConfig(prev => ({ ...prev, [k]: v }));
  const reset = () => setConfig(DEFAULT_EMAIL_CONFIG);

  const labelStyle = { fontSize:11, color:'#666', fontWeight:600, marginBottom:4, display:'block' };
  const inputStyle = { width:'100%', border:'1px solid #ccc', borderRadius:8, padding:'8px 12px',
    fontSize:13, fontFamily:'inherit', outline:'none', background:'#fff' };

  return (
    <div onClick={onClose}
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:200,
        display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'4vh 16px' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:'#fff', borderRadius:14, maxWidth:560, width:'100%', maxHeight:'92vh',
          overflow:'auto', boxShadow:'0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ padding:'18px 22px', borderBottom:'1px solid #E0E0D8',
          display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, background:'#fff', zIndex:1 }}>
          <h2 style={{ fontSize:15, fontWeight:800, color:'#0D3B2E', margin:0 }}>⚙️ Plantilla de correo</h2>
          <button onClick={onClose}
            style={{ background:'transparent', border:'none', fontSize:24, color:'#888', cursor:'pointer', lineHeight:1, padding:'0 6px' }}>
            ×
          </button>
        </div>

        <div style={{ padding:'18px 22px' }}>
          <p style={{ fontSize:12, color:'#666', marginBottom:14 }}>
            Estos textos aparecen en los correos de la pestaña Correo LBS (Petróleo, Lubricantes, Neumáticos) y en el encabezado.
          </p>

          <div style={{ marginBottom:14 }}>
            <label style={labelStyle}>Saludo</label>
            <input value={config.saludo} onChange={e => update('saludo', e.target.value)} style={inputStyle}/>
          </div>

          <div style={{ marginBottom:14 }}>
            <label style={labelStyle}>Cuerpo del correo</label>
            <textarea value={config.cuerpo} onChange={e => update('cuerpo', e.target.value)}
              rows={2} style={{ ...inputStyle, resize:'vertical', minHeight:60 }}/>
          </div>

          <div style={{ marginBottom:14 }}>
            <label style={labelStyle}>Empresa (encabezado del correo)</label>
            <input value={config.empresa} onChange={e => update('empresa', e.target.value)} style={inputStyle}/>
          </div>

          <div style={{ marginBottom:14 }}>
            <label style={labelStyle}>RUT empresa</label>
            <input value={config.rut} onChange={e => update('rut', e.target.value)} style={inputStyle}/>
          </div>

          <div style={{ marginBottom:14 }}>
            <label style={labelStyle}>Pie del correo</label>
            <input value={config.pie} onChange={e => update('pie', e.target.value)} style={inputStyle}/>
          </div>

          <div style={{ display:'flex', justifyContent:'space-between', gap:10, marginTop:18 }}>
            <button onClick={reset}
              style={{ padding:'8px 14px', background:'transparent', border:'1px solid #ccc', borderRadius:8,
                fontSize:12, fontWeight:600, color:'#888', cursor:'pointer' }}>
              Restablecer valores por defecto
            </button>
            <button onClick={onClose}
              style={{ padding:'9px 22px', background:'#1D9E75', border:'none', borderRadius:8,
                fontSize:13, fontWeight:700, color:'#fff', cursor:'pointer' }}>
              Listo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
