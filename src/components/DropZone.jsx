import { useState, useRef } from 'react';

export default function DropZone({ label, icon, hint, fileName, onFile }) {
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
