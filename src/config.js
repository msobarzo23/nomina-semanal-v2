export const SHEET_PUB_BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vT1ILHR8Hehw4FiGRKgTm__paCyusHvn5LcHlOeFtZAxENpO8GKr2MzV6s1iX7R8e1KbTJqYOCWIMTU/pub";
export const HISTORICO_URL = `${SHEET_PUB_BASE}?gid=1453444709&single=true&output=csv`;
export const AUTORIZADORES_URL = `${SHEET_PUB_BASE}?gid=1684740922&single=true&output=csv`;

// ⚠️ Pega aquí la URL del despliegue del Apps Script (termina en /exec)
// Instrucciones en README_SETUP.md
export const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx_Io6w5no_zdddc5q_uVYmzF7NGaMs-l8p0Sn_NaEl5KUSoXaCACaU-6LwCHlN-nsxEg/exec";

// Token compartido para autenticar peticiones al Apps Script.
// Se inyecta en build via variable de entorno VITE_APPS_SCRIPT_TOKEN.
// Si el Apps Script no esta configurado para validar token, deja vacio (fallback).
// Ver SECURITY_SETUP.md para configurar.
export const APPS_SCRIPT_TOKEN = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_APPS_SCRIPT_TOKEN) || '';

// Helpers para construir URLs y bodies con token
export const withToken = (url) => {
  if(!APPS_SCRIPT_TOKEN) return url;
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(APPS_SCRIPT_TOKEN);
};
export const withTokenBody = (body) => {
  if(!APPS_SCRIPT_TOKEN) return body;
  return { ...body, token: APPS_SCRIPT_TOKEN };
};

// Detecta si un error/respuesta del Apps Script corresponde a token inválido o ausente.
export const isAuthError = (text) => {
  if(!text) return false;
  const t = String(text).toLowerCase();
  return t.includes('token invalido') || t.includes('token inválido') || t.includes('token ausente') || t.includes('unauthorized');
};

// Diagnostica el estado de la conexión con el Apps Script.
// Devuelve uno de: 'ok' | 'auth' | 'network' | 'unconfigured' | 'unknown'
export const checkAppsScriptConnection = async () => {
  if(!APPS_SCRIPT_URL || APPS_SCRIPT_URL.startsWith('PEGA_')) {
    return { status:'unconfigured', message:'Apps Script no configurado en config.js' };
  }
  try {
    const r = await fetch(withToken(`${APPS_SCRIPT_URL}?action=list`));
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch { j = null; }
    if(j && j.ok) return { status:'ok', message:'Conexión correcta' };
    if(j && j.ok === false && isAuthError(j.error)) {
      return { status:'auth', message: j.error || 'Token inválido o ausente' };
    }
    if(isAuthError(text)) {
      return { status:'auth', message:'Token inválido o ausente' };
    }
    return { status:'unknown', message: (j && j.error) || 'Respuesta inesperada del Apps Script' };
  } catch(e) {
    return { status:'network', message: e?.message || 'Sin conexión' };
  }
};

export const COPEC_EXCLUSIONS = new Set([
  "COPEC S A","COPEC S A (LUBRICANTES)","COPEC S A (LUBRICANTES)(NOTA DE CREDITO)",
  "ESMAX DISTRIBUCION SPA","FLUX SOLAR ENERGIAS RENOVABLES SPA",
  "COPEC S A (NOTA DE CREDITO)","COPEC S A (NOTA DE CREDITO)(LUBRICANTES)",
  "ESMAX DISTRIBUCION SPA (NOTA DE CREDITO)","FLUX SOLAR ENERGIAS RENOVABLES SPA (NOTA DE CREDITO)"
]);

export const CUOTA_RULES = {
  "MICHELIN CHILE LTDA":2,"MICHELIN CHILE LTDA (NOTA DE CREDITO)":2,
  "AC COMERCIAL SPA":2,"COMERCIAL SP LTDA":2,
  "BOLSA DE PRODUCTOS DE CHILE (MILLA TIRES)":2,"SKC Servicios Automotrices S.A.":2,
  "Goodyear de Chile S.A.I.C":3,"Goodyear de Chile S.A.I.C (NOTA DE CREDITO)":3,
  "SALINAS Y FABRES S.A.":3,"SKC RED SPA":3,"SKC RED S.A.":3,
  "BPC SERVICIOS Y NEGOCIOS S.A. (MILLA TIRES)":3,
  "CAREN SPA":3,"COMERCIALIZADORA DE NEUMATICOS LIMITADA":3,
  "Supermercado del Neumático Ltda.":3,"Milla Tirers Co Limitada":3,
  "FACTOTAL S A (MILLA TIRES)":3,"RED CAPITAL S.A. (MILLA TIRES)":3,
  "BANPRO FACTORING S.A (MILLA TIRES)":3,
  "CAPITAL EXPRESS SERVICIOS FINANCIEROS S.A. (MILLA TIRES)":3,
  "LATAM TRADE CAPITAL S.A. (MILLA TIRES)":3,
  "TANNER SERVICIOS FINANCIEROS S.A. (MILLA TIRES)":3,
};

export const AUTH_LIST = ["MBL","LBS","LBL","PR","HB","NG","RB","LP","PB"];

export const REMOVE_COLS = [
  'Cuenta','Descripción','Clasificador 1 (NOMINA_PROV)',
  'Cód. Elemento 1','Desc. Elemento 1'
];
