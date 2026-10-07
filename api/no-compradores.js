// Vercel serverless function: GET /api/no-compradores
// Cruza las rutas de venta de Chess (clientes asignados a cada vendedor/ruta)
// contra las ventas del mes en curso y devuelve los clientes que todavía no compraron.
//
// Variables de entorno (Vercel → Settings → Environment Variables):
//   CHESS_USER      usuario de la API
//   CHESS_PASS      contraseña de la API
//   CHESS_API_URL   opcional, por defecto https://rap.chesserp.com/AR899/web/api/chess/v1
//   CHESS_EMPRESAS  opcional, ej "1" o "1,2" (si no se pone, todas las empresas)

const BASE = (process.env.CHESS_API_URL || 'https://rap.chesserp.com/AR899/web/api/chess/v1').replace(/\/+$/, '');
const TZ = 'America/Argentina/Buenos_Aires';

function hoyAR() {
  // YYYY-MM-DD en hora argentina
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function checkError(data, donde) {
  if (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.error) && data.error.length) {
    const e = data.error[0] || {};
    throw new Error(`Chess (${donde}): ${e.mensaje || e.tipo || JSON.stringify(e)}`);
  }
}

// Las respuestas de Chess a veces vienen envueltas en objetos; buscamos el primer array con objetos.
function findArray(obj, depth = 0) {
  if (Array.isArray(obj)) return obj;
  if (!obj || typeof obj !== 'object' || depth > 3) return [];
  const vals = Object.values(obj);
  for (const v of vals) if (Array.isArray(v) && (v.length === 0 || typeof v[0] === 'object')) return v;
  for (const v of vals) {
    if (v && typeof v === 'object') {
      const r = findArray(v, depth + 1);
      if (r.length) return r;
    }
  }
  return [];
}

function pick(o, ...keys) {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  return undefined;
}

function esVerdadero(v) {
  return v === true || v === 1 || /^(true|si|sí|s|1)$/i.test(String(v ?? '').trim());
}

// Interpreta fechas tipo "2026-10-07", "07/10/2026", "07-10-2026", "2026-10-07T00:00:00"
function parseFecha(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

async function login() {
  const usuario = process.env.CHESS_USER;
  const password = process.env.CHESS_PASS;
  if (!usuario || !password) throw new Error('Faltan las variables CHESS_USER / CHESS_PASS en Vercel');
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ usuario, password }),
  });
  const text = await r.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* puede no ser JSON */ }
  if (!r.ok) throw new Error(`Login Chess falló (HTTP ${r.status}): ${text.slice(0, 200)}`);
  checkError(data, 'login');
  let sid = data.sessionId || data.SessionId || data.sessionid;
  if (!sid) {
    const setCookie = r.headers.get('set-cookie') || '';
    const m = setCookie.match(/JSESSIONID=[^;]+/i);
    if (m) sid = m[0];
  }
  if (!sid) throw new Error('Login Chess no devolvió sessionId');
  return sid.includes('=') ? sid : `JSESSIONID=${sid}`;
}

async function chessGet(cookie, path, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const url = `${BASE}${path}${qs.toString() ? '?' + qs : ''}`;
  const r = await fetch(url, { headers: { Cookie: cookie, Accept: 'application/json' } });
  const text = await r.text();
  if (!r.ok) throw new Error(`Chess ${path} HTTP ${r.status}: ${text.slice(0, 200)}`);
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Chess ${path} no devolvió JSON`); }
  checkError(data, path);
  return data;
}

async function traerVentasMes(cookie, desde, hasta) {
  const ventas = [];
  for (let lote = 1; lote <= 60; lote++) {
    const data = await chessGet(cookie, '/ventas/', {
      fechaDesde: desde,
      fechaHasta: hasta,
      detallado: false,
      nroLote: lote,
      empresas: process.env.CHESS_EMPRESAS,
    });
    const arr = findArray(data);
    ventas.push(...arr);
    if (arr.length < 1000) break; // cada lote trae hasta 1000 comprobantes
  }
  return ventas;
}

module.exports = async (req, res) => {
  const debug = req.query && req.query.debug === '1';
  try {
    const hoy = hoyAR();
    const desde = hoy.slice(0, 8) + '01';
    const cookie = await login();

    const [rutasRaw, ventas] = await Promise.all([
      chessGet(cookie, '/rutasVenta/', { anulada: false }),
      traerVentasMes(cookie, desde, hoy),
    ]);
    const rutas = findArray(rutasRaw);

    if (debug) {
      // Muestra la forma de los datos (sin credenciales) para ajustar nombres de campos.
      const r0 = rutas[0] || {};
      const c0 = findArray(r0)[0] || {};
      return res.status(200).json({
        rutas: rutas.length, ejemploRuta: { ...r0, clienteRutas: undefined }, ejemploClienteRuta: c0,
        ventas: ventas.length, ejemploVenta: ventas[0] || null,
      });
    }

    // Neto comprado por cliente en el mes (facturas suman, notas de crédito restan)
    const netoPorCliente = new Map();
    for (const v of ventas) {
      if (esVerdadero(pick(v, 'anulado'))) continue;
      const id = String(pick(v, 'idCliente', 'idcliente') ?? '');
      if (!id) continue;
      const monto = Number(pick(v, 'subtotalFinal', 'subtotalNeto') ?? 0) || 0;
      netoPorCliente.set(id, (netoPorCliente.get(id) || 0) + monto);
    }
    const compro = (id) => (netoPorCliente.get(id) || 0) > 0;

    const vendedores = new Map();
    let totalClientes = 0;
    let totalNoCompradores = 0;

    for (const r of rutas) {
      if (esVerdadero(pick(r, 'anulado'))) continue;
      const fhRuta = parseFecha(pick(r, 'fechaHasta'));
      if (fhRuta && fhRuta < hoy) continue;

      const idVend = String(pick(r, 'idPersonal') ?? 'sin');
      const vendNombre = pick(r, 'desPersonal') || `Vendedor ${idVend}`;
      const ruta = {
        idRuta: pick(r, 'idRuta'),
        nombre: pick(r, 'desRuta') || `Ruta ${pick(r, 'idRuta')}`,
        fuerzaVentas: pick(r, 'desFuerzaVentas') || '',
        modoAtencion: pick(r, 'desModoAtencion') || '',
        sucursal: pick(r, 'desSucursal') || '',
        totalClientes: 0,
        noCompradores: [],
      };

      const vistos = new Set();
      for (const c of findArray(r)) {
        const fh = parseFecha(pick(c, 'fechaHasta'));
        if (fh && fh < hoy) continue; // cliente ya no está en la ruta
        const id = String(pick(c, 'idCliente') ?? '');
        if (!id || vistos.has(id)) continue;
        vistos.add(id);
        ruta.totalClientes++;
        if (!compro(id)) {
          ruta.noCompradores.push({
            idCliente: Number(id) || id,
            razonSocial: pick(c, 'razonSocial') || '',
            orden: Number(pick(c, 'intercalacionVisita')) || 99999,
          });
        }
      }
      if (!ruta.totalClientes) continue;
      ruta.noCompradores.sort((a, b) => a.orden - b.orden || String(a.razonSocial).localeCompare(b.razonSocial));
      totalClientes += ruta.totalClientes;
      totalNoCompradores += ruta.noCompradores.length;

      if (!vendedores.has(idVend)) vendedores.set(idVend, { idVendedor: idVend, nombre: vendNombre, rutas: [] });
      vendedores.get(idVend).rutas.push(ruta);
    }

    const lista = [...vendedores.values()]
      .map((v) => ({
        ...v,
        totalClientes: v.rutas.reduce((s, r) => s + r.totalClientes, 0),
        totalNoCompradores: v.rutas.reduce((s, r) => s + r.noCompradores.length, 0),
        rutas: v.rutas.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre))),
      }))
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
    return res.status(200).json({
      actualizado: new Date().toISOString(),
      periodo: { desde, hasta: hoy },
      comprobantesLeidos: ventas.length,
      totalClientes,
      totalNoCompradores,
      vendedores: lista,
    });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: err.message });
  }
};
