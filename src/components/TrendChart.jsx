import { useState } from 'react';
import { fmtCLP } from '../utils.js';

export default function TrendChart({ data, lines, width=540, height=180, title }) {
  const [hover, setHover] = useState(null); // index hovered

  if(!data || data.length === 0) return null;

  const padding = { top:10, right:14, bottom:24, left:62 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;

  const allVals = lines.flatMap(l => data.map(d => d[l.key] || 0));
  const max = Math.max(...allVals, 1);

  const x = i => padding.left + (data.length === 1 ? w/2 : (i / (data.length - 1)) * w);
  const y = v => padding.top + h - (v / max) * h;

  const fmtAxis = v => {
    if(v >= 1e6) return Math.round(v/1e5)/10 + 'M';
    if(v >= 1e3) return Math.round(v/1e3) + 'k';
    return Math.round(v);
  };

  const labelEvery = Math.max(1, Math.ceil(data.length / 6));

  return (
    <div style={{ background:'#fff', border:'1px solid #E0E0D8', borderRadius:10, padding:'14px 16px' }}>
      {title && <p style={{ fontSize:11, fontWeight:700, color:'#aaa', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:8 }}>{title}</p>}
      <div style={{ overflowX:'auto' }}>
        <svg width={width} height={height} onMouseLeave={() => setHover(null)} style={{ display:'block' }}>
          {/* grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map(p => (
            <line key={p} x1={padding.left} x2={padding.left + w}
              y1={padding.top + h - p * h} y2={padding.top + h - p * h}
              stroke="#F0F0EC" strokeWidth="1"/>
          ))}
          {/* y-axis labels */}
          {[0, 0.5, 1].map(p => (
            <text key={p} x={padding.left - 6} y={padding.top + h - p * h}
              fontSize="9" fill="#999" textAnchor="end" dominantBaseline="middle">
              ${fmtAxis(max * p)}
            </text>
          ))}
          {/* x-axis labels (cada N puntos) */}
          {data.map((d, i) => i % labelEvery === 0 ? (
            <text key={d.fecha} x={x(i)} y={height - 6}
              fontSize="9" fill="#999" textAnchor="middle">
              {d.fecha.slice(5,10).replace('-','/')}
            </text>
          ) : null)}
          {/* lines */}
          {lines.map(l => {
            const path = data.map((d, i) =>
              (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ',' + y(d[l.key] || 0).toFixed(1)
            ).join(' ');
            return (
              <g key={l.key}>
                <path d={path} fill="none" stroke={l.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                {data.map((d, i) => (
                  <circle key={i} cx={x(i)} cy={y(d[l.key] || 0)} r={hover === i ? 4 : 2.5} fill={l.color}/>
                ))}
              </g>
            );
          })}
          {/* hover overlay invisible para tooltip */}
          {data.map((d, i) => (
            <rect key={i} x={x(i) - 12} y={padding.top} width={24} height={h}
              fill="transparent" onMouseEnter={() => setHover(i)}/>
          ))}
          {/* tooltip */}
          {hover !== null && (() => {
            const d = data[hover];
            const tw = 130, th = 18 + lines.length * 16;
            const tx = Math.min(Math.max(x(hover) - tw/2, padding.left), padding.left + w - tw);
            const ty = padding.top;
            return (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={padding.top} y2={padding.top + h}
                  stroke="#888" strokeWidth="1" strokeDasharray="2,2"/>
                <rect x={tx} y={ty} width={tw} height={th} rx={6}
                  fill="#0D3B2E" stroke="none" opacity={0.95}/>
                <text x={tx + 8} y={ty + 12} fontSize="10" fontWeight="700" fill="#fff">{d.fecha}</text>
                {lines.map((l, idx) => (
                  <g key={l.key}>
                    <circle cx={tx + 12} cy={ty + 24 + idx * 16} r={3.5} fill={l.color}/>
                    <text x={tx + 20} y={ty + 27 + idx * 16} fontSize="10" fill="#fff">
                      {l.label}: {fmtCLP(d[l.key] || 0)}
                    </text>
                  </g>
                ))}
              </g>
            );
          })()}
        </svg>
      </div>
      {/* Legend */}
      <div style={{ display:'flex', gap:14, marginTop:6, flexWrap:'wrap' }}>
        {lines.map(l => (
          <div key={l.key} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ width:14, height:3, background:l.color, borderRadius:1, display:'inline-block' }}/>
            <span style={{ fontSize:11, color:'#444', fontWeight:500 }}>{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
