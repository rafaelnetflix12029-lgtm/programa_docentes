// =====================================================================
// app.js — Lógica de interfaz (Fase 1).
// No habla con Supabase directamente: todo pasa por window.DB (db.js).
// =====================================================================

const { Auth, Catalogo, Asignaciones, Alumnos, Seguimiento } = window.DB;

// Atajos DOM
const $ = (id) => document.getElementById(id);
const el = (sel) => document.querySelector(sel);
const slug = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Estado en memoria de la sesión de trabajo.
const estado = {
  modoRegistro: false,
  asignaciones: [],   // asignaciones activas del profesor (con joins)
};

function msg(contenedorId, texto, tipo = "error") {
  const c = $(contenedorId);
  if (!texto) { c.innerHTML = ""; return; }
  c.innerHTML = `<div class="msg ${tipo}">${texto}</div>`;
  if (tipo === "ok") setTimeout(() => { c.innerHTML = ""; }, 3500);
}

function pillLogro(nivel) {
  const map = {
    "En inicio": "inicio", "En proceso": "proceso",
    "Logrado": "logrado", "Destacado": "destacado",
  };
  if (!nivel) return `<span class="pill vacio">—</span>`;
  return `<span class="pill ${map[nivel] || "vacio"}">${nivel}</span>`;
}

// Texto legible de una asignación.
function rotuloAsig(a) {
  const nivel = a.grados?.niveles?.nombre ?? "";
  const grado = a.grados?.nombre ?? "";
  const curso = a.subcursos?.cursos?.nombre ?? "";
  const sub = a.subcursos?.nombre ?? "";
  const subTxt = sub && sub !== curso ? ` · ${sub}` : "";
  return `${curso}${subTxt} — ${grado} ${nivel} · Secc. ${a.seccion}`;
}

// ===================== AUTENTICACIÓN =====================

function pintarModoAuth() {
  $("auth-titulo").textContent = estado.modoRegistro ? "Crear cuenta" : "Iniciar sesión";
  $("btn-auth").textContent = estado.modoRegistro ? "Registrarme" : "Entrar";
  $("auth-cambiar-txt").textContent = estado.modoRegistro ? "¿Ya tienes cuenta?" : "¿No tienes cuenta?";
  $("auth-cambiar").textContent = estado.modoRegistro ? "Iniciar sesión" : "Crear cuenta";
}

$("auth-cambiar").addEventListener("click", (e) => {
  e.preventDefault();
  estado.modoRegistro = !estado.modoRegistro;
  msg("auth-msg", "");
  pintarModoAuth();
});

$("btn-auth").addEventListener("click", async () => {
  const email = $("auth-email").value.trim();
  const pass = $("auth-pass").value;
  if (!email || !pass) return msg("auth-msg", "Completa correo y contraseña.");
  $("btn-auth").disabled = true;
  try {
    if (estado.modoRegistro) {
      await Auth.registrar(email, pass);
      msg("auth-msg", "Cuenta creada. Si pide confirmar correo, revísalo; si no, ya puedes entrar.", "ok");
      estado.modoRegistro = false;
      pintarModoAuth();
    } else {
      await Auth.iniciarSesion(email, pass);
      // onAuthStateChange se encarga de mostrar la app.
    }
  } catch (e) {
    msg("auth-msg", e.message);
  } finally {
    $("btn-auth").disabled = false;
  }
});

$("btn-salir").addEventListener("click", async () => {
  await Auth.cerrarSesion();
});

// Reacciona a login/logout.
Auth.alCambiarSesion(async (user) => {
  if (user) {
    $("vista-auth").classList.add("hidden");
    $("vista-app").classList.remove("hidden");
    $("lbl-user").textContent = user.email;
    await iniciarApp();
  } else {
    $("vista-app").classList.add("hidden");
    $("vista-auth").classList.remove("hidden");
  }
});

// ===================== NAVEGACIÓN POR PESTAÑAS =====================

document.querySelectorAll(".tabs button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.remove("activo"));
    b.classList.add("activo");
    ["asignaciones", "alumnos", "seguimiento", "dashboard"].forEach((t) => {
      $("tab-" + t).classList.toggle("hidden", t !== b.dataset.tab);
    });
    if (b.dataset.tab === "alumnos") cargarSelectoresAsig("sel-asig-alumnos", refrescarAlumnos);
    if (b.dataset.tab === "seguimiento") cargarSelectoresAsig("sel-asig-seg", refrescarSeguimiento);
    if (b.dataset.tab === "dashboard") cargarSelectoresAsig("sel-asig-dash", refrescarDashboard);
  });
});

// ===================== INICIO DE LA APP =====================

async function iniciarApp() {
  $("inp-anio").value = ANIO_ESCOLAR_DEFAULT;
  await cargarNiveles();
  await refrescarAsignaciones();
}

// ---------- Wizard: cascada nivel -> grado/curso -> subcurso ----------

async function cargarNiveles() {
  const niveles = await Catalogo.niveles();
  $("sel-nivel").innerHTML = niveles.map((n) => `<option value="${n.id}">${n.nombre}</option>`).join("");
  await onNivelCambia();
}

async function onNivelCambia() {
  const nivelId = +$("sel-nivel").value;
  const [grados, cursos] = await Promise.all([Catalogo.grados(nivelId), Catalogo.cursos(nivelId)]);
  $("sel-grado").innerHTML = grados.map((g) => `<option value="${g.id}">${g.nombre}</option>`).join("");
  $("sel-curso").innerHTML = cursos.map((c) => `<option value="${c.id}">${c.nombre}</option>`).join("");
  await onCursoCambia();
}

async function onCursoCambia() {
  const cursoId = +$("sel-curso").value;
  if (!cursoId) { $("sel-subcurso").innerHTML = ""; return; }
  const subs = await Catalogo.subcursos(cursoId);
  $("sel-subcurso").innerHTML = subs.map((s) =>
    `<option value="${s.id}">${s.nombre}${s.es_global ? "" : " (propio)"}</option>`).join("");
}

$("sel-nivel").addEventListener("change", onNivelCambia);
$("sel-curso").addEventListener("change", onCursoCambia);

$("btn-nuevo-subcurso").addEventListener("click", async () => {
  const cursoId = +$("sel-curso").value;
  if (!cursoId) return msg("app-msg", "Primero selecciona un curso.");
  const nombre = prompt("Nombre del nuevo subcurso:");
  if (!nombre || !nombre.trim()) return;
  try {
    await Catalogo.crearSubcursoPropio(cursoId, nombre);
    await onCursoCambia();
    msg("app-msg", "Subcurso creado.", "ok");
  } catch (e) { msg("app-msg", e.message); }
});

$("btn-crear-asig").addEventListener("click", async () => {
  const subcursoId = +$("sel-subcurso").value;
  const gradoId = +$("sel-grado").value;
  const seccion = $("inp-seccion").value.trim();
  const anio = +$("inp-anio").value;
  if (!subcursoId || !gradoId || !seccion || !anio) return msg("app-msg", "Completa todos los campos.");
  $("btn-crear-asig").disabled = true;
  try {
    await Asignaciones.crear({ subcursoId, gradoId, seccion, anioEscolar: anio });
    await refrescarAsignaciones();
    msg("app-msg", "Curso agregado.", "ok");
  } catch (e) { msg("app-msg", e.message); }
  finally { $("btn-crear-asig").disabled = false; }
});

async function refrescarAsignaciones() {
  estado.asignaciones = await Asignaciones.listar(true);
  const tb = $("tbody-asig");
  if (estado.asignaciones.length === 0) {
    tb.innerHTML = `<tr><td colspan="6" class="muted">Aún no has agregado cursos.</td></tr>`;
    return;
  }
  tb.innerHTML = estado.asignaciones.map((a) => {
    const curso = a.subcursos?.cursos?.nombre ?? "";
    const sub = a.subcursos?.nombre ?? "";
    const subTxt = sub && sub !== curso ? `${curso} · ${sub}` : curso;
    return `<tr>
      <td>${a.grados?.niveles?.nombre ?? ""}</td>
      <td>${a.grados?.nombre ?? ""}</td>
      <td>${subTxt}</td>
      <td>${a.seccion}</td>
      <td>${a.anio_escolar}</td>
      <td class="no-print"><button class="danger" data-desactivar="${a.id}">Quitar</button></td>
    </tr>`;
  }).join("");
  tb.querySelectorAll("[data-desactivar]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Quitar este curso de tu lista activa?")) return;
      try {
        await Asignaciones.desactivar(btn.dataset.desactivar);
        await refrescarAsignaciones();
      } catch (e) { msg("app-msg", e.message); }
    });
  });
}

// Rellena un <select> con las asignaciones activas y dispara un callback.
function cargarSelectoresAsig(selectId, callback) {
  const sel = $(selectId);
  if (estado.asignaciones.length === 0) {
    sel.innerHTML = `<option value="">— Configura un curso primero —</option>`;
    if (callback) callback();
    return;
  }
  sel.innerHTML = estado.asignaciones.map((a) => `<option value="${a.id}">${rotuloAsig(a)}</option>`).join("");
  if (!sel.dataset.bound) {
    sel.addEventListener("change", callback);
    sel.dataset.bound = "1";
  }
  if (callback) callback();
}

function asigSeleccionada(selectId) {
  const id = $(selectId).value;
  return estado.asignaciones.find((a) => a.id === id) || null;
}

// ===================== ALUMNOS =====================

async function refrescarAlumnos() {
  const a = asigSeleccionada("sel-asig-alumnos");
  const tb = $("tbody-alumnos");
  if (!a) { tb.innerHTML = `<tr><td colspan="4" class="muted">Selecciona un curso.</td></tr>`; return; }
  $("ttl-alumnos").textContent = `Alumnos — ${a.grados?.nombre ?? ""} Secc. ${a.seccion}`;
  try {
    const alumnos = await Alumnos.listarPorAsignacion(a.grado_id, a.seccion);
    if (alumnos.length === 0) {
      tb.innerHTML = `<tr><td colspan="4" class="muted">Sin alumnos todavía.</td></tr>`;
      return;
    }
    tb.innerHTML = alumnos.map((al, i) => `<tr>
      <td>${i + 1}</td>
      <td>${al.nombre}</td>
      <td>${al.codigo ?? ""}</td>
      <td class="no-print"><button class="danger" data-del="${al.id}">Quitar</button></td>
    </tr>`).join("");
    tb.querySelectorAll("[data-del]").forEach((btn) => btn.addEventListener("click", async () => {
      if (!confirm("¿Dar de baja a este alumno? Su histórico se conserva.")) return;
      try { await Alumnos.desactivar(btn.dataset.del); await refrescarAlumnos(); }
      catch (e) { msg("app-msg", e.message); }
    }));
  } catch (e) { msg("app-msg", e.message); }
}

$("btn-add-alumno").addEventListener("click", async () => {
  const a = asigSeleccionada("sel-asig-alumnos");
  if (!a) return msg("app-msg", "Selecciona un curso.");
  const nombre = $("inp-alumno-nombre").value.trim();
  if (!nombre) return msg("app-msg", "Escribe el nombre del alumno.");
  try {
    await Alumnos.crear({ nombre, codigo: $("inp-alumno-codigo").value, gradoId: a.grado_id, seccion: a.seccion });
    $("inp-alumno-nombre").value = ""; $("inp-alumno-codigo").value = "";
    await refrescarAlumnos();
    msg("app-msg", "Alumno agregado.", "ok");
  } catch (e) { msg("app-msg", e.message); }
});

$("btn-masivo").addEventListener("click", async () => {
  const a = asigSeleccionada("sel-asig-alumnos");
  if (!a) return msg("app-msg", "Selecciona un curso.");
  const nombres = $("inp-masivo").value.split("\n");
  try {
    const creados = await Alumnos.crearMasivo(nombres, a.grado_id, a.seccion);
    $("inp-masivo").value = "";
    await refrescarAlumnos();
    msg("app-msg", `${creados.length} alumno(s) cargado(s).`, "ok");
  } catch (e) { msg("app-msg", e.message); }
});

// ===================== SEGUIMIENTO =====================

async function refrescarSeguimiento() {
  const a = asigSeleccionada("sel-asig-seg");
  const cont = $("seg-contenedor");
  if (!a) { cont.innerHTML = `<div class="card muted">Selecciona un curso.</div>`; return; }
  cont.innerHTML = `<div class="card muted">Cargando…</div>`;
  try {
    const [alumnos, comps] = await Promise.all([
      Alumnos.listarPorAsignacion(a.grado_id, a.seccion),
      Catalogo.competencias(a.subcurso_id, a.grado_id),
    ]);
    if (comps.length === 0) {
      cont.innerHTML = `<div class="card"><p class="muted">Este subcurso y grado aún no tiene competencias cargadas en el catálogo.
        El contenido del Currículo Nacional debe cargarlo el cliente (ver db/02_seed.sql).</p></div>`;
      return;
    }
    if (alumnos.length === 0) {
      cont.innerHTML = `<div class="card muted">No hay alumnos en este curso. Agrégalos en la pestaña "Alumnos".</div>`;
      return;
    }
    const registros = await Seguimiento.deAlumnos(alumnos.map((x) => x.id));
    const idx = {}; // alumno_id|comp_id -> nivel_logro
    registros.forEach((r) => { idx[`${r.alumno_id}|${r.competencia_id}`] = r.nivel_logro; });

    const opciones = (sel) => ["", ...NIVELES_LOGRO].map((n) =>
      `<option value="${n}" ${n === (sel || "") ? "selected" : ""}>${n || "—"}</option>`).join("");

    cont.innerHTML = comps.map((c) => `
      <div class="card">
        <h3>${c.nombre}</h3>
        ${c.descripcion ? `<p class="muted">${c.descripcion}</p>` : ""}
        <table>
          <thead><tr><th>Alumno</th><th style="width:170px">Nivel de logro</th></tr></thead>
          <tbody>
            ${alumnos.map((al) => `<tr>
              <td>${al.nombre}</td>
              <td><select data-alumno="${al.id}" data-comp="${c.id}">${opciones(idx[`${al.id}|${c.id}`])}</select></td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>`).join("");

    cont.querySelectorAll("select[data-alumno]").forEach((sel) => {
      sel.addEventListener("change", async () => {
        sel.disabled = true;
        try {
          await Seguimiento.registrar(sel.dataset.alumno, +sel.dataset.comp, sel.value, null);
          sel.style.outline = "2px solid var(--verde)";
          setTimeout(() => { sel.style.outline = ""; }, 800);
        } catch (e) { msg("app-msg", e.message); }
        finally { sel.disabled = false; }
      });
    });
  } catch (e) { cont.innerHTML = ""; msg("app-msg", e.message); }
}

// ===================== DASHBOARD / REPORTE =====================

$("sel-vista-dash").addEventListener("change", () => {
  $("wrap-sel-alumno").style.display = $("sel-vista-dash").value === "alumno" ? "" : "none";
  refrescarDashboard();
});
$("sel-alumno-dash").addEventListener("change", refrescarDashboard);

async function refrescarDashboard() {
  const a = asigSeleccionada("sel-asig-dash");
  const cont = $("dash-contenedor");
  $("wrap-sel-alumno").style.display = $("sel-vista-dash").value === "alumno" ? "" : "none";
  if (!a) { cont.innerHTML = `<p class="muted">Selecciona un curso.</p>`; return; }
  cont.innerHTML = `<p class="muted">Cargando…</p>`;
  try {
    const [alumnos, comps] = await Promise.all([
      Alumnos.listarPorAsignacion(a.grado_id, a.seccion),
      Catalogo.competencias(a.subcurso_id, a.grado_id),
    ]);
    if (comps.length === 0) { cont.innerHTML = `<p class="muted">Sin competencias cargadas para este subcurso/grado.</p>`; return; }
    if (alumnos.length === 0) { cont.innerHTML = `<p class="muted">Sin alumnos en este curso.</p>`; return; }

    const registros = await Seguimiento.deAlumnos(alumnos.map((x) => x.id));
    const idx = {};
    registros.forEach((r) => { idx[`${r.alumno_id}|${r.competencia_id}`] = r.nivel_logro; });

    // Llenar selector de alumno (vista por alumno).
    const selAl = $("sel-alumno-dash");
    selAl.innerHTML = alumnos.map((al) => `<option value="${al.id}">${al.nombre}</option>`).join("");

    const encabezado = `<h2>${rotuloAsig(a)}</h2><p class="muted">Año escolar ${a.anio_escolar} · Reporte de seguimiento por competencias</p>`;

    if ($("sel-vista-dash").value === "alumno") {
      const alId = selAl.value || alumnos[0].id;
      const al = alumnos.find((x) => x.id === alId);
      cont.innerHTML = encabezado + `<h3>${al.nombre}</h3>
        <table><thead><tr><th>Competencia</th><th>Nivel de logro</th></tr></thead><tbody>
        ${comps.map((c) => `<tr><td>${c.nombre}</td><td>${pillLogro(idx[`${al.id}|${c.id}`])}</td></tr>`).join("")}
        </tbody></table>`;
    } else {
      // Matriz: filas = alumnos, columnas = competencias.
      cont.innerHTML = encabezado + `<div style="overflow:auto"><table>
        <thead><tr><th>Alumno</th>${comps.map((c) => `<th>${c.nombre}</th>`).join("")}</tr></thead>
        <tbody>${alumnos.map((al) => `<tr><td>${al.nombre}</td>
          ${comps.map((c) => `<td>${pillLogro(idx[`${al.id}|${c.id}`])}</td>`).join("")}</tr>`).join("")}
        </tbody></table></div>`;
    }
  } catch (e) { cont.innerHTML = ""; msg("app-msg", e.message); }
}

// Exportar a Word: empaqueta el HTML del reporte en un .doc abrible por Word.
$("btn-word").addEventListener("click", () => {
  const a = asigSeleccionada("sel-asig-dash");
  const cuerpo = $("dash-contenedor").innerHTML;
  const estilos = `<style>
    body{font-family:Calibri,Arial,sans-serif;color:#1f2937}
    table{border-collapse:collapse;width:100%} th,td{border:1px solid #999;padding:6px 8px;font-size:12px;text-align:left}
    .pill{padding:2px 8px;border-radius:10px;color:#fff;font-size:11px}
    .pill.inicio{background:#ef4444}.pill.proceso{background:#f59e0b}
    .pill.logrado{background:#22c55e}.pill.destacado{background:#2563eb}.pill.vacio{background:#9ca3af}
  </style>`;
  const html = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8">${estilos}</head><body>${cuerpo}</body></html>`;
  const blob = new Blob(["﻿", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const nombre = a ? slug(rotuloAsig(a)).replace(/[^a-z0-9]+/g, "_") : "reporte";
  link.href = url;
  link.download = `reporte_${nombre}.doc`;
  link.click();
  URL.revokeObjectURL(url);
});

// ===================== ARRANQUE =====================
pintarModoAuth();
(async () => {
  // Si ya hay sesión activa (recarga de página), alCambiarSesion la detecta;
  // forzamos una comprobación inicial por si el evento no dispara.
  const user = await Auth.usuarioActual();
  if (user) {
    $("vista-auth").classList.add("hidden");
    $("vista-app").classList.remove("hidden");
    $("lbl-user").textContent = user.email;
    await iniciarApp();
  }
})();
