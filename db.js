// =====================================================================
// db.js — Capa de datos. TODAS las llamadas a Supabase viven aquí.
//
// Patrón: funciones async pequeñas que devuelven datos ya limpios o
// lanzan Error con mensaje legible. La UI (index.html) nunca llama a
// Supabase directamente; siempre pasa por estas funciones.
//
// Depende de: config.js (SUPABASE_URL, SUPABASE_ANON_KEY) y del SDK
// @supabase/supabase-js v2 cargado por CDN antes que este archivo.
// =====================================================================

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Lanza un Error legible a partir de la respuesta de Supabase.
function _check(error, contexto) {
  if (error) {
    console.error(contexto, error);
    throw new Error(error.message || `Error en ${contexto}`);
  }
}

// ===================== AUTENTICACIÓN =====================

const Auth = {
  async registrar(email, password) {
    const { data, error } = await sb.auth.signUp({ email, password });
    _check(error, "registro");
    return data;
  },

  async iniciarSesion(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    _check(error, "inicio de sesión");
    return data;
  },

  async cerrarSesion() {
    const { error } = await sb.auth.signOut();
    _check(error, "cierre de sesión");
  },

  async usuarioActual() {
    const { data } = await sb.auth.getUser();
    return data?.user ?? null;
  },

  // Notifica cambios de sesión (login / logout) a la UI.
  alCambiarSesion(callback) {
    sb.auth.onAuthStateChange((_event, session) => callback(session?.user ?? null));
  },
};

// ===================== CATÁLOGO (solo lectura) =====================

const Catalogo = {
  async niveles() {
    const { data, error } = await sb.from("niveles").select("*").order("id");
    _check(error, "cargar niveles");
    return data;
  },

  async grados(nivelId) {
    const { data, error } = await sb
      .from("grados")
      .select("*")
      .eq("nivel_id", nivelId)
      .order("numero");
    _check(error, "cargar grados");
    return data;
  },

  async cursos(nivelId) {
    const { data, error } = await sb
      .from("cursos")
      .select("*")
      .eq("nivel_id", nivelId)
      .order("nombre");
    _check(error, "cargar cursos");
    return data;
  },

  async subcursos(cursoId) {
    const { data, error } = await sb
      .from("subcursos")
      .select("*")
      .eq("curso_id", cursoId)
      .order("orden")
      .order("nombre");
    _check(error, "cargar subcursos");
    return data;
  },

  // Competencias ligadas a un subcurso + grado específico (regla de negocio #2).
  async competencias(subcursoId, gradoId) {
    const { data, error } = await sb
      .from("competencias")
      .select("*")
      .eq("subcurso_id", subcursoId)
      .eq("grado_id", gradoId)
      .order("id");
    _check(error, "cargar competencias");
    return data;
  },

  // Crea un subcurso propio del profesor (es_global=false).
  async crearSubcursoPropio(cursoId, nombre) {
    const user = await Auth.usuarioActual();
    if (!user) throw new Error("Sesión no iniciada.");
    const { data, error } = await sb
      .from("subcursos")
      .insert({
        curso_id: cursoId,
        nombre: nombre.trim(),
        es_global: false,
        creado_por: user.id,
      })
      .select()
      .single();
    _check(error, "crear subcurso propio");
    return data;
  },
};

// ===================== ASIGNACIONES =====================

const Asignaciones = {
  // Devuelve las asignaciones del profesor con nombres legibles (joins).
  async listar(soloActivas = true) {
    let q = sb
      .from("asignaciones")
      .select(`
        id, seccion, anio_escolar, activo, grado_id, subcurso_id,
        grados ( numero, nombre, nivel_id, niveles ( nombre ) ),
        subcursos ( nombre, cursos ( nombre ) )
      `)
      .order("created_at", { ascending: false });
    if (soloActivas) q = q.eq("activo", true);
    const { data, error } = await q;
    _check(error, "listar asignaciones");
    return data;
  },

  async crear({ subcursoId, gradoId, seccion, anioEscolar }) {
    const user = await Auth.usuarioActual();
    if (!user) throw new Error("Sesión no iniciada.");
    const { data, error } = await sb
      .from("asignaciones")
      .insert({
        profesor_id: user.id,
        subcurso_id: subcursoId,
        grado_id: gradoId,
        seccion: seccion.trim(),
        anio_escolar: anioEscolar,
      })
      .select()
      .single();
    _check(error, "crear asignación");
    return data;
  },

  async desactivar(asignacionId) {
    const { error } = await sb
      .from("asignaciones")
      .update({ activo: false })
      .eq("id", asignacionId);
    _check(error, "desactivar asignación");
  },
};

// ===================== ALUMNOS =====================

const Alumnos = {
  async listarPorAsignacion(gradoId, seccion) {
    const { data, error } = await sb
      .from("alumnos")
      .select("*")
      .eq("grado_id", gradoId)
      .eq("seccion", seccion)
      .eq("activo", true)
      .order("nombre");
    _check(error, "listar alumnos");
    return data;
  },

  async crear({ nombre, codigo, gradoId, seccion }) {
    const user = await Auth.usuarioActual();
    if (!user) throw new Error("Sesión no iniciada.");
    const { data, error } = await sb
      .from("alumnos")
      .insert({
        profesor_id: user.id,
        nombre: nombre.trim(),
        codigo: codigo?.trim() || null,
        grado_id: gradoId,
        seccion: seccion.trim(),
      })
      .select()
      .single();
    _check(error, "crear alumno");
    return data;
  },

  // Carga masiva: recibe un arreglo de nombres y los inserta en bloque.
  async crearMasivo(nombres, gradoId, seccion) {
    const user = await Auth.usuarioActual();
    if (!user) throw new Error("Sesión no iniciada.");
    const filas = nombres
      .map((n) => n.trim())
      .filter((n) => n.length > 0)
      .map((nombre) => ({
        profesor_id: user.id,
        nombre,
        grado_id: gradoId,
        seccion: seccion.trim(),
      }));
    if (filas.length === 0) return [];
    const { data, error } = await sb.from("alumnos").insert(filas).select();
    _check(error, "carga masiva de alumnos");
    return data;
  },

  async actualizar(alumnoId, { nombre, codigo }) {
    const { error } = await sb
      .from("alumnos")
      .update({ nombre: nombre.trim(), codigo: codigo?.trim() || null })
      .eq("id", alumnoId);
    _check(error, "actualizar alumno");
  },

  // Baja lógica (mantiene el histórico de seguimiento).
  async desactivar(alumnoId) {
    const { error } = await sb
      .from("alumnos")
      .update({ activo: false })
      .eq("id", alumnoId);
    _check(error, "desactivar alumno");
  },
};

// ===================== SEGUIMIENTO POR COMPETENCIA =====================
// En Fase 1 el seguimiento es un registro manual por (alumno, competencia)
// sin evaluación asociada: una fila en `resultados` con evaluacion_id = null.

const Seguimiento = {
  // Resultados de seguimiento manual de un grupo de alumnos.
  async deAlumnos(alumnoIds) {
    if (!alumnoIds || alumnoIds.length === 0) return [];
    const { data, error } = await sb
      .from("resultados")
      .select("id, alumno_id, competencia_id, nivel_logro, observaciones, created_at")
      .is("evaluacion_id", null)
      .in("alumno_id", alumnoIds);
    _check(error, "cargar seguimiento");
    return data;
  },

  // Crea o actualiza el nivel de logro de un alumno en una competencia.
  // Upsert manual: el índice único es parcial (evaluacion_id IS NULL) y
  // PostgREST no puede inferir su predicado, así que buscamos y decidimos.
  async registrar(alumnoId, competenciaId, nivelLogro, observaciones) {
    const valores = {
      nivel_logro: nivelLogro || null,
      observaciones: observaciones?.trim() || null,
    };

    const { data: existente, error: errBuscar } = await sb
      .from("resultados")
      .select("id")
      .eq("alumno_id", alumnoId)
      .eq("competencia_id", competenciaId)
      .is("evaluacion_id", null)
      .maybeSingle();
    _check(errBuscar, "buscar seguimiento previo");

    if (existente) {
      const { data, error } = await sb
        .from("resultados")
        .update(valores)
        .eq("id", existente.id)
        .select()
        .single();
      _check(error, "actualizar seguimiento");
      return data;
    }

    const { data, error } = await sb
      .from("resultados")
      .insert({
        alumno_id: alumnoId,
        competencia_id: competenciaId,
        evaluacion_id: null,
        ...valores,
      })
      .select()
      .single();
    _check(error, "registrar seguimiento");
    return data;
  },
};

// Exponer en window para que index.html lo use.
window.DB = { Auth, Catalogo, Asignaciones, Alumnos, Seguimiento };
