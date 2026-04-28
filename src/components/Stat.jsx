export default function Stat({ label, value, sub, highlight }) {
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
