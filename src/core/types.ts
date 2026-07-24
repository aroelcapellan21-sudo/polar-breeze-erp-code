/**
 * Tipos base del ERP Polar Breeze — Fase 0 (Fundamentos Arquitectónicos).
 *
 * Traducción directa a TypeScript de:
 * - docs/05-MODELO-DE-DATOS-MAESTRO.md (secciones 2, 3)
 * - docs/11-DICCIONARIO-DE-DATOS.md (secciones 1-4)
 * - docs/12-GLOSARIO.md, sección C (catálogo formal de eventos)
 * - docs/04-MOTOR-DE-FLUJOS-PATRIMONIALES.md, sección 3 (metadatos de eventos compensatorios, v0.47)
 *
 * No contiene lógica del motor todavía — solo las formas de dato sobre las
 * que el motor va a operar. Cualquier cambio a estos tipos debe reflejar
 * primero un cambio en la documentación del repo polar-breeze-erp, nunca
 * al revés (Artículo 29 de la Constitución).
 */

// ── Tipos conceptuales (docs/11, sección 1) ──────────────────────────────

/** Identificador de negocio único dentro de su alcance. Nunca se reutiliza. */
export type Codigo = string;

/** Referencia a otra entidad, siempre por código, nunca por nombre. */
export type Referencia = string;

/** Monto expresado en la moneda funcional de la Empresa que lo contiene. */
export type Monto = number;

export type FechaHora = string; // ISO 8601

// ── Campos comunes heredados por toda entidad (docs/11, sección 2) ───────

export interface CamposComunes {
  empresaId: Referencia; // ausente solo en Empresa y ConfiguracionPlataforma
  sucursalId?: Referencia; // presente solo si la entidad opera a nivel de sede/cuarto frío/despacho
  codigo: Codigo;
  estado: "activo" | "inactivo";
  creadoPor: Referencia; // Usuario
  creadoEn: FechaHora;
  version?: number; // solo entidades configurables o normativas
}

// ── Entidades de Plataforma (docs/05, sección 2 · docs/11, sección 3) ───

export interface Empresa {
  codigo: Codigo;
  razonSocial: string;
  estado: "activa" | "inactiva";
  /** Código ISO 4217, ej. "DOP", "USD". Fija la moneda funcional de toda entidad con esta empresaId. */
  moneda: string;
}

export interface Membresia {
  empresaId: Referencia;
  rolId: Referencia;
}

export interface Usuario {
  codigo: Codigo;
  nombre: string;
  // credenciales: mecanismo de autenticación — fuera del alcance de este documento (docs/11)
  membresias: Membresia[]; // al menos una
  /** Contexto de sesión, no se persiste como estado global del usuario. */
  empresaActivaId?: Referencia;
}

export interface ConfiguracionPlataforma {
  clave: Codigo;
  valor: unknown;
  /** Ausente si el parámetro es global de plataforma, no de una empresa específica. */
  empresaId?: Referencia;
}

// ── Entidades Comunes Particionadas por Empresa (docs/05 §3 · docs/11 §4) ─

export interface Sucursal extends CamposComunes {
  nombre: string;
  tipo: "sede" | "cuarto_frio" | "punto_despacho";
}

export interface Rol extends CamposComunes {
  nombre: string;
  permisoIds: Referencia[];
}

export interface Permiso extends CamposComunes {
  accion: "crear" | "leer" | "modificar" | "aprobar" | "anular" | "exportar";
  entidad: string;
  /** Ausente si el permiso no se restringe a una sucursal. */
  sucursalId?: Referencia;
}

// ── Catálogo formal de eventos (docs/12, sección C) ───────────────────────
// 22 tipos vigentes al momento de escribir esto. Este union type debe
// mantenerse sincronizado a mano con el catálogo del repo de documentación
// — nunca al revés (el catálogo del repo es la fuente de verdad).

export type TipoEvento =
  | "CapitalIngresado"
  | "ObligacionRegistrada"
  | "MercanciaRecibida"
  | "MercanciaTransferida"
  | "NovedadInventarioRegistrada"
  | "ConciliacionInventarioRealizada"
  | "NovedadCuartoFrioRegistrada"
  | "ConsignacionCreada"
  | "Despachado"
  | "NovedadDespachoRegistrada"
  | "RetiroSolicitado"
  | "RetiroJustificado"
  | "FacturaCreada"
  | "MercanciaVendida"
  | "ProductoCreado"
  | "NotaCreditoCreada"
  | "MercanciaDevuelta"
  | "PagoRegistrado"
  | "ArqueoRealizado"
  | "ReporteExportado"
  | "BajaInventarioRegistrada"
  | "ConflictoSincronizacionDetectado";

// ── Evento (docs/05 §3 · docs/11 §4 · docs/04 §3, formalizado en v0.47) ──

export interface Evento<TPayload = unknown> {
  empresaId: Referencia;
  sucursalId?: Referencia;
  tipoEvento: TipoEvento;
  entidadAfectada: Referencia;
  payload: TPayload;
  usuarioEmisor: Referencia; // Usuario
  momentoCaptura: FechaHora; // instante real del hecho, capturado offline si aplica
  momentoPersistencia: FechaHora; // instante en que el motor lo persistió

  // Metadatos de evento compensatorio (opcionales; formalizados en v0.47).
  // Cualquier evento del catálogo puede actuar como compensatorio — no
  // existe un tipo de evento distinto para correcciones.
  eventoCorregidoId?: Referencia; // referencia al evento que este corrige
  motivoCorreccion?: string; // obligatorio en la práctica si eventoCorregidoId está presente
  tipoCompensacion?: string; // opcional: clasificación libre para reportes

  // Nota: Evento NO tiene campo estado de soft delete.
  // Nunca se inactiva ni se borra (Artículo 5.4 de la Constitución).
}

// ── Registro de Auditoría (docs/05, sección 3) ────────────────────────────

export interface RegistroAuditoria {
  empresaId: Referencia;
  sucursalId?: Referencia;
  usuario: Referencia;
  accion: string;
  entidadAfectada: Referencia;
  valoresAnteriores: unknown;
  valoresNuevos: unknown;
  timestamp: FechaHora;
  // De solo lectura para todos los roles, sin excepción (Artículo 8).
}

// ── Conflicto de Sincronización (docs/05, sección 3) ──────────────────────

export interface ConflictoSincronizacion {
  empresaId: Referencia;
  sucursalId?: Referencia;
  eventoOriginalId: Referencia; // el evento rechazado
  motivoRechazo: string;
  /** Proyección: "resuelto" si y solo si existe un eventoResolucionId. Nunca se edita directamente. */
  estadoConflicto: "pendiente" | "resuelto";
  eventoResolucionId?: Referencia; // presente solo si estadoConflicto === "resuelto"
  usuarioQueResuelve?: Referencia;
  momentoDeteccion: FechaHora;
}
