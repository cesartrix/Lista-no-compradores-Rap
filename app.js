// -------------------------------------------------------------------
// Helpers genéricos (compartidos por todas las páginas/secciones)
// -------------------------------------------------------------------

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = "";
      } else if (c === '\n') {
        row.push(field); field = "";
        rows.push(row); row = [];
      } else if (c === '\r') {
        // skip, handled by following \n
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

function normHeader(h) {
  return (h || "").trim().toLowerCase();
}

function fmtDate(d) {
  try {
    return new Intl.DateTimeFormat("es-AR", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "America/Argentina/Buenos_Aires"
    }).format(d);
  } catch (e) {
    return d.toLocaleString("es-AR");
  }
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// El Cliente muestra "CODIGO - NOMBRE". Se compara por coincidencia exacta
// (del código solo, o del texto completo) para que escribir "5" traiga
// únicamente al vendedor 5, y no 25, 54, 500, etc.
function vendorCode(v) {
  const idx = (v || "").indexOf(" - ");
  return idx === -1 ? (v || "").trim() : v.slice(0, idx).trim();
}

function matchesVendedor(rowVendedor, filterText) {
  if (!filterText) return true;
  const code = vendorCode(rowVendedor).toLowerCase();
  const full = (rowVendedor || "").toLowerCase();
  return code === filterText || full === filterText;
}

function flashButton(btn, message) {
  const original = btn.textContent;
  btn.textContent = message;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 1600);
}

// -------------------------------------------------------------------
// Fábrica de secciones: cada sección arma su propio HTML, mantiene su
// propio estado (allRows / selectedRutas) y consulta su propio endpoint.
// Cada página normalmente tiene una sola sección, pero la fábrica soporta
// varias en la misma página sin que se pisen entre sí.
// -------------------------------------------------------------------

function createSection(root) {
  const key = root.dataset.key;
  const title = root.dataset.title;
  const endpoint = root.dataset.endpoint;
  const id = (suffix) => key + "-" + suffix;

  root.innerHTML = `
    <h2>${escapeHtml(title)}</h2>
    <div class="meta-row">
      <span id="${id('last-updated')}">Cargando datos del Sheet…</span>
      <span class="dot">•</span>
      <span id="${id('fetched-at')}"></span>
      <button id="${id('refresh-btn')}" class="refresh-btn" type="button">Actualizar datos</button>
    </div>

    <div class="panel">
      <div class="filters">
        <div class="field">
          <label for="${id('f-vendedor')}">Nro Vendedor</label>
          <input type="text" id="${id('f-vendedor')}" list="${id('vendedor-list')}" placeholder="Todos (número exacto o elegí de la lista)" autocomplete="off">
          <datalist id="${id('vendedor-list')}"></datalist>
        </div>
        <div class="field">
          <label id="${id('ruta-label')}">Ruta</label>
          <div class="multiselect" id="${id('ruta-multiselect')}">
            <button type="button" id="${id('ruta-toggle')}" class="multiselect-toggle" aria-haspopup="true" aria-expanded="false">Todas</button>
            <div class="multiselect-panel" id="${id('ruta-panel')}" hidden>
              <div class="multiselect-actions">
                <button type="button" id="${id('ruta-select-all')}">Seleccionar todas</button>
                <button type="button" id="${id('ruta-select-none')}">Ninguna</button>
              </div>
              <div class="multiselect-options" id="${id('ruta-options')}"></div>
            </div>
          </div>
        </div>
        <div class="field grow">
          <label for="${id('f-search')}">Buscar cliente</label>
          <input type="text" id="${id('f-search')}" placeholder="Nombre o código de cliente...">
        </div>
        <button class="clear-btn" id="${id('clear-filters')}" type="button">Limpiar filtros</button>
      </div>
    </div>

    <div class="actions-row">
      <button class="action-btn" id="${id('export-pdf-btn')}" type="button">⬇ Exportar PDF</button>
      <button class="action-btn" id="${id('copy-btn')}" type="button">⧉ Copiar al portapapeles</button>
    </div>

    <div id="${id('content')}">
      <div class="empty-state">Cargando…</div>
    </div>
  `;

  const $ = (suffix) => document.getElementById(id(suffix));

  let allRows = [];
  let selectedRutas = new Set(); // vacío = "todas"

  function currentVendedorFilter() {
    return $('f-vendedor').value.trim().toLowerCase();
  }

  function relevantRutaRows() {
    const vendedorFilter = currentVendedorFilter();
    return vendedorFilter ? allRows.filter(r => matchesVendedor(r.vendedor, vendedorFilter)) : allRows;
  }

  function updateRutaOptions() {
    const rutas = [...new Set(relevantRutaRows().map(r => r.ruta).filter(v => v !== ""))]
      .sort((a, b) => a.localeCompare(b, "es", { numeric: true }));

    selectedRutas.forEach(r => { if (!rutas.includes(r)) selectedRutas.delete(r); });

    const optionsWrap = $('ruta-options');
    optionsWrap.innerHTML = "";
    if (rutas.length === 0) {
      optionsWrap.innerHTML = '<div class="empty">No hay rutas para este filtro.</div>';
    } else {
      rutas.forEach(r => {
        const optId = id('ruta-opt-' + r.replace(/[^a-zA-Z0-9]/g, "_"));
        const label = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = r;
        cb.id = optId;
        cb.checked = selectedRutas.has(r);
        cb.addEventListener("change", () => {
          if (cb.checked) selectedRutas.add(r); else selectedRutas.delete(r);
          updateRutaToggleLabel();
          render();
        });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(r));
        optionsWrap.appendChild(label);
      });
    }
    updateRutaToggleLabel();
  }

  function updateRutaToggleLabel() {
    const btn = $('ruta-toggle');
    if (selectedRutas.size === 0) btn.textContent = "Todas";
    else if (selectedRutas.size === 1) btn.textContent = [...selectedRutas][0];
    else btn.textContent = selectedRutas.size + " rutas seleccionadas";
  }

  function toggleRutaPanel(forceOpen) {
    const panel = $('ruta-panel');
    const btn = $('ruta-toggle');
    const shouldOpen = forceOpen !== undefined ? forceOpen : panel.hidden;
    panel.hidden = !shouldOpen;
    btn.setAttribute("aria-expanded", String(shouldOpen));
  }

  $('ruta-toggle').addEventListener("click", (e) => {
    e.stopPropagation();
    toggleRutaPanel();
  });
  document.addEventListener("click", (e) => {
    const ms = $('ruta-multiselect');
    if (!ms.contains(e.target)) toggleRutaPanel(false);
  });
  $('ruta-select-all').addEventListener("click", () => {
    const rutas = [...new Set(relevantRutaRows().map(r => r.ruta).filter(v => v !== ""))];
    selectedRutas = new Set(rutas);
    updateRutaOptions();
    render();
  });
  $('ruta-select-none').addEventListener("click", () => {
    selectedRutas.clear();
    updateRutaOptions();
    render();
  });

  function getFilteredRows() {
    const vendedorFilter = currentVendedorFilter();
    const search = $('f-search').value.trim().toLowerCase();

    return allRows
      .filter(r => {
        if (!matchesVendedor(r.vendedor, vendedorFilter)) return false;
        if (selectedRutas.size > 0 && !selectedRutas.has(r.ruta)) return false;
        if (search && !r.cliente.toLowerCase().includes(search)) return false;
        return true;
      })
      .slice()
      .sort((a, b) => a.cliente.localeCompare(b.cliente, "es"));
  }

  function render() {
    const content = $('content');

    if (allRows.length === 0) {
      content.innerHTML = '<div class="empty-state">No se encontraron datos en el Sheet.</div>';
      return;
    }

    const filtered = getFilteredRows();

    if (filtered.length === 0) {
      content.innerHTML = '<div class="empty-state">No hay clientes sin compra que coincidan con los filtros seleccionados.</div>';
      return;
    }

    let html = '<div class="status-line"><span><strong>' + filtered.length + '</strong> cliente(s) sin compra en el mes en curso</span></div>';
    html += '<table><thead><tr><th>Nro Vendedor</th><th>Ruta</th><th>Cliente</th></tr></thead><tbody>';
    filtered.forEach(r => {
      html += "<tr><td>" + (r.vendedor || "—") + "</td><td>" + (r.ruta || "—") + "</td><td>" + escapeHtml(r.cliente) + "</td></tr>";
    });
    html += "</tbody></table>";
    content.innerHTML = html;
  }

  function exportPDF() {
    const rows = getFilteredRows();
    const btn = $('export-pdf-btn');
    if (rows.length === 0) { flashButton(btn, "Sin datos para exportar"); return; }
    if (!window.jspdf) { flashButton(btn, "No se pudo cargar el generador de PDF"); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "pt" });

    doc.setFontSize(14);
    doc.text(title, 40, 40);

    doc.setFontSize(9);
    doc.setTextColor(110, 110, 110);
    const updatedText = $('last-updated').textContent.replace(/\s+/g, " ").trim();
    doc.text(updatedText, 40, 58);
    doc.text(rows.length + " cliente(s) sin compra (con los filtros aplicados)", 40, 72);

    doc.autoTable({
      startY: 88,
      head: [["Nro Vendedor", "Ruta", "Cliente"]],
      body: rows.map(r => [r.vendedor || "—", r.ruta || "—", r.cliente]),
      styles: { fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: [52, 87, 213], textColor: 255 },
      alternateRowStyles: { fillColor: [247, 248, 250] }
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const fileSlug = key === "main" ? "no-compradores" : "no-compradores-" + key;
    doc.save(fileSlug + "-" + stamp + ".pdf");
  }

  async function copyToClipboard() {
    const btn = $('copy-btn');
    const rows = getFilteredRows();
    if (rows.length === 0) { flashButton(btn, "Sin datos para copiar"); return; }

    const header = ["Nro Vendedor", "Ruta", "Cliente"].join("\t");
    const lines = rows.map(r => [r.vendedor || "", r.ruta || "", r.cliente].join("\t"));
    const text = [header, ...lines].join("\n");

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      flashButton(btn, "✓ Copiado");
    } catch (err) {
      flashButton(btn, "No se pudo copiar");
    }
  }

  $('export-pdf-btn').addEventListener("click", exportPDF);
  $('copy-btn').addEventListener("click", copyToClipboard);

  async function loadData() {
    const btn = $('refresh-btn');
    btn.disabled = true;
    $('last-updated').textContent = "Cargando datos del Sheet…";
    $('content').innerHTML = '<div class="empty-state">Cargando…</div>';

    try {
      const res = await fetch(endpoint + "?_ts=" + Date.now(), { cache: "no-store" });
      const payload = await res.json();

      if (!res.ok) {
        throw new Error(payload && payload.error ? payload.error : ("HTTP " + res.status));
      }

      const now = new Date();
      $('fetched-at').textContent = "Última consulta: " + fmtDate(now);

      if (payload.lastModified) {
        $('last-updated').innerHTML =
          'Última actualización del Sheet: <strong>' + fmtDate(new Date(payload.lastModified)) + "</strong>";
      } else {
        $('last-updated').innerHTML =
          'Última actualización del Sheet: <span title="El Sheet no expone esta fecha; se muestra la hora de la última consulta">no disponible</span>';
      }

      const rows = parseCSV(payload.csv || "");
      if (rows.length === 0) { allRows = []; render(); return; }

      // El Sheet puede traer filas extra arriba del encabezado real (por
      // ejemplo un bloque de "Filtros" con el período seleccionado). En vez
      // de asumir que la fila 0 es el encabezado, se busca la primera fila
      // que efectivamente contenga las columnas "vendedor" y "cliente".
      let headerRowIndex = rows.findIndex(r => {
        const norm = r.map(normHeader);
        return norm.some(h => h.includes("vendedor")) && norm.some(h => h.includes("cliente") && !h.includes("cartera"));
      });
      if (headerRowIndex === -1) headerRowIndex = 0;

      const header = rows[headerRowIndex].map(normHeader);
      const idxVendedor = header.findIndex(h => h.includes("vendedor"));
      const idxCliente = header.findIndex(h => h.includes("cliente") && !h.includes("cartera"));
      const idxRuta = header.findIndex(h => h.includes("ruta"));
      const idxCCC = header.findIndex(h => h.includes("ccc") || h.includes("bultos"));

      if (idxVendedor === -1 || idxCliente === -1 || idxCCC === -1) {
        throw new Error("No se encontraron las columnas esperadas (Nro Vendedor / Cliente / CCC x Bultos) en el Sheet.");
      }

      const data = rows.slice(headerRowIndex + 1).filter(r => r.some(c => (c || "").trim() !== ""));

      // En el Sheet, "Nro Vendedor" y "Ruta" solo aparecen en la primera fila
      // de cada bloque (como con celdas combinadas): las filas siguientes
      // pertenecen al mismo vendedor/ruta hasta que aparece un valor nuevo.
      // Por eso se "rellena hacia abajo" (forward-fill) cada columna por
      // separado, en el orden en que vienen las filas.
      let lastVendedor = "";
      let lastRuta = "";

      allRows = data
        .map(r => {
          const vendedorRaw = (r[idxVendedor] || "").trim();
          const rutaRaw = (r[idxRuta] || "").trim();
          if (vendedorRaw !== "") lastVendedor = vendedorRaw;
          if (rutaRaw !== "") lastRuta = rutaRaw;
          return {
            vendedor: lastVendedor,
            ruta: lastRuta,
            cliente: (r[idxCliente] || "").trim(),
            ccc: (r[idxCCC] || "").trim()
          };
        })
        .filter(r => r.cliente !== "" && r.ccc === "");

      const vendedores = [...new Set(allRows.map(r => r.vendedor).filter(v => v !== ""))]
        .sort((a, b) => a.localeCompare(b, "es", { numeric: true }));

      const list = $('vendedor-list');
      list.innerHTML = "";
      vendedores.forEach(v => {
        const opt = document.createElement("option");
        opt.value = v;
        list.appendChild(opt);
      });

      updateRutaOptions();
      render();
    } catch (err) {
      $('last-updated').textContent = "No se pudo cargar el Sheet.";
      $('content').innerHTML =
        '<div class="error-box">Ocurrió un error al obtener los datos del Sheet: ' + escapeHtml(err.message) +
        '. Probá "Actualizar datos". Si el error persiste, revisá que el Sheet siga publicado (Archivo → Compartir → Publicar en la Web) y que la función ' + escapeHtml(endpoint) + ' esté desplegada en Vercel.</div>';
    } finally {
      btn.disabled = false;
    }
  }

  $('f-vendedor').addEventListener("input", () => {
    updateRutaOptions();
    render();
  });
  $('f-search').addEventListener("input", render);
  $('clear-filters').addEventListener("click", () => {
    $('f-vendedor').value = "";
    $('f-search').value = "";
    selectedRutas.clear();
    updateRutaOptions();
    render();
  });
  $('refresh-btn').addEventListener("click", loadData);

  loadData();
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".data-section").forEach(createSection);
});
