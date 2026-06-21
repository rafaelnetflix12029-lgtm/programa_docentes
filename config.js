// =====================================================================
// config.js — Credenciales PÚBLICAS de Supabase
//
// Aquí va SOLO la URL del proyecto y la clave "anon" (pública).
// NUNCA pegar aquí la "service_role key" ni ninguna clave secreta:
// este archivo se sirve al navegador y cualquiera puede leerlo.
// El aislamiento de datos lo garantiza RLS, no el secreto de esta clave.
//
// Cómo obtener estos valores:
//   Supabase -> tu proyecto -> Project Settings -> API
//     - Project URL            -> SUPABASE_URL
//     - Project API keys -> anon public -> SUPABASE_ANON_KEY
// =====================================================================

const SUPABASE_URL = "https://zusbicgetrhscqbhvrbu.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_qYVEc7Qp2K2GYInMi6EQHg_4o0jP3OZ";

// Año escolar por defecto al crear asignaciones (editable en el wizard).
const ANIO_ESCOLAR_DEFAULT = new Date().getFullYear();

// Escala de logro EBR (Educación Básica Regular).
const NIVELES_LOGRO = ["En inicio", "En proceso", "Logrado", "Destacado"];
