/**
 * Motor de Flujos Patrimoniales — forma mínima (Fase 0).
 *
 * Implementa, fielmente, docs/04-MOTOR-DE-FLUJOS-PATRIMONIALES.md:
 * - Sección 2: Recibir, Validar, Aplicar, Persistir, Actualizar, Rechazar.
 * - Sección 4: Ciclo de vida del evento.
 * - Sección 9: Validación de dominio (módulo) vs. validación de flujo (motor)
 *   — este archivo SOLO implementa validación de flujo (motor). La
 *   validación de dominio es responsabilidad de cada módulo de negocio,
 *   antes de construir el evento.
 * - Sección 12: Rechazo y manejo de errores.
 *
 * Alcance deliberado de la Fase 0 (docs/10-PLAN-MAESTRO-DE-IMPLEMENTACION.md,
 * sección 2): recepción, validación general, persistencia del historial,
 * generación de auditoría. NO incluye todavía:
 * - Balance de fondos por flujo de capital (sección 5 del motor) — depende
 *   de que la clasificación de Fondos esté validada por un contador
 *   (docs/anexos/01-PENDIENTE-VALIDACION-CONTABLE.md, ítem 2).
 * - Atomicidad multi-flujo completa (sección 6) — se añade cuando existan
 *   módulos de negocio reales que emitan eventos compuestos.
 * - Resolución de ConflictoSincronizacion (sección 13.3) — solo se detecta
 *   y registra aquí; su resolución humana es una fase posterior, como el
 *   propio documento permite explícitamente.
 *
 * Este motor no decide NADA por fuera de lo aquí descrito. Cualquier regla
 * nueva se documenta primero en polar-breeze-erp, nunca se agrega aquí sin
 * respaldo documental (Artículo 29 de la Constitución).
 */

import type {
  Evento,
  TipoEvento,
  RegistroAuditoria,
  ConflictoSincronizacion,
  Referencia,
  FechaHora,
} from "../core/types";

// ── Resultado de una operación del motor ──────────────────────────────────

export type ResultadoMotor<T = void> =
  | { exito: true; valor: T }
  | { exito: false; motivoRechazo: string };

// ── Puertos (abstracciones de persistencia) ───────────────────────────────
// El motor no sabe si el historial vive en Firestore, en otro event store,
// o en memoria (para pruebas). Solo conoce este contrato. La implementación
// concreta se conecta aparte — así el motor mismo es más fácil de probar
// y no queda atado a una tecnología antes de tiempo.

export interface AlmacenDeEventos {
  guardar(evento: Evento): Promise<void>;
  obtenerPorId(eventoId: Referencia): Promise<Evento | null>;
  /** Usado para chequear no-reutilización de código retirado (Artículo 9.3). */
  existeEntidadConCodigo(
    empresaId: Referencia,
    entidad: string,
    codigo: string,
  ): Promise<boolean>;
}

export interface AlmacenDeAuditoria {
  registrar(registro: RegistroAuditoria): Promise<void>;
}

export interface AlmacenDeConflictos {
  registrar(conflicto: ConflictoSincronizacion): Promise<void>;
}

/** Dependencias que el motor necesita para operar — inyectadas, no hardcodeadas. */
export interface DependenciasMotor {
  eventos: AlmacenDeEventos;
  auditoria: AlmacenDeAuditoria;
  conflictos: AlmacenDeConflictos;
  ahora: () => FechaHora; // inyectable para pruebas deterministas
}

// ── Validación general de flujo (sección 3, 4.3 y 9 del documento) ───────

const TIPOS_EVENTO_VALIDOS = new Set<TipoEvento>([
  "CapitalIngresado",
  "ObligacionRegistrada",
  "MercanciaRecibida",
  "MercanciaTransferida",
  "NovedadInventarioRegistrada",
  "ConciliacionInventarioRealizada",
  "NovedadCuartoFrioRegistrada",
  "ConsignacionCreada",
  "Despachado",
  "NovedadDespachoRegistrada",
  "RetiroSolicitado",
  "RetiroJustificado",
  "FacturaCreada",
  "MercanciaVendida",
  "ProductoCreado",
  "NotaCreditoCreada",
  "MercanciaDevuelta",
  "PagoRegistrado",
  "ArqueoRealizado",
  "ReporteExportado",
  "BajaInventarioRegistrada",
  "ConflictoSincronizacionDetectado",
]);

/**
 * Validación general de flujo — la única que este motor aplica.
 * La validación de dominio (reglas específicas del módulo emisor) ya
 * debió ocurrir antes de construir el evento (sección 9 del documento).
 */
export function validarEventoGenerico(
  evento: Evento,
): ResultadoMotor<void> {
  if (!evento.empresaId) {
    return { exito: false, motivoRechazo: "empresaId es obligatorio (Artículo 2.2)." };
  }

  if (!TIPOS_EVENTO_VALIDOS.has(evento.tipoEvento)) {
    return {
      exito: false,
      motivoRechazo: `tipoEvento "${evento.tipoEvento}" no pertenece al catálogo formal (12-GLOSARIO.md, sección C).`,
    };
  }

  if (!evento.entidadAfectada) {
    return { exito: false, motivoRechazo: "entidadAfectada es obligatoria (integridad referencial, Artículo 10)." };
  }

  if (!evento.usuarioEmisor) {
    return { exito: false, motivoRechazo: "usuarioEmisor es obligatorio (Artículo 7)." };
  }

  if (!evento.momentoCaptura) {
    return { exito: false, motivoRechazo: "momentoCaptura es obligatorio (sección 13 del motor)." };
  }

  // Metadatos de evento compensatorio (sección 3 y 8, formalizado en v0.47):
  // si actúa como compensatorio, motivoCorreccion es obligatorio.
  if (evento.eventoCorregidoId && !evento.motivoCorreccion) {
    return {
      exito: false,
      motivoRechazo: "motivoCorreccion es obligatorio cuando eventoCorregidoId está presente (sección 3 y 8 del motor).",
    };
  }

  return { exito: true, valor: undefined };
}

// ── Ciclo de vida del evento (sección 4 del documento) ────────────────────

/**
 * Recibe un evento ya construido por un módulo de negocio (con su
 * validación de dominio ya hecha), lo valida a nivel de flujo, y si es
 * válido lo persiste de forma inmutable junto con su registro de auditoría.
 *
 * No implementa todavía: balance de fondos, atomicidad multi-flujo, ni
 * resolución de conflictos — ver alcance declarado al inicio del archivo.
 */
export async function emitirEvento(
  evento: Evento,
  deps: DependenciasMotor,
): Promise<ResultadoMotor<Evento>> {
  // 3. Validación de motor (sección 4.3)
  const validacion = validarEventoGenerico(evento);
  if (!validacion.exito) {
    // 6. Rechazo — el intento no se persiste como evento aplicado, pero
    // puede registrarse con fines de auditoría (sección 12). Ese registro
    // de intento fallido se deja como responsabilidad del llamador por
    // ahora — este motor mínimo se limita a devolver el motivo.
    return { exito: false, motivoRechazo: validacion.motivoRechazo };
  }

  const eventoConMomentoDePersistencia: Evento = {
    ...evento,
    momentoPersistencia: deps.ahora(),
  };

  // 4-5. Aplicación y persistencia. La "aplicación" real sobre proyecciones
  // de estado (saldos, existencias) es responsabilidad de los módulos de
  // negocio de fases posteriores — este motor mínimo solo garantiza la
  // persistencia inmutable del evento en sí (Artículo 5.4).
  await deps.eventos.guardar(eventoConMomentoDePersistencia);

  // Todo evento genera su registro de auditoría independiente (Artículo 8).
  await deps.auditoria.registrar({
    empresaId: evento.empresaId,
    sucursalId: evento.sucursalId,
    usuario: evento.usuarioEmisor,
    accion: `evento:${evento.tipoEvento}`,
    entidadAfectada: evento.entidadAfectada,
    valoresAnteriores: null, // un evento no "edita" nada — no aplica en este modelo
    valoresNuevos: evento.payload,
    timestamp: eventoConMomentoDePersistencia.momentoPersistencia,
  });

  return { exito: true, valor: eventoConMomentoDePersistencia };
}

/**
 * Registra un conflicto de sincronización (sección 13.2-13.3): un evento
 * capturado offline que dejó de ser válido al momento de sincronizarse.
 * Este motor mínimo solo detecta y registra — la resolución humana es una
 * fase posterior, como el propio documento del motor permite explícitamente.
 */
export async function registrarConflictoSincronizacion(
  conflicto: Omit<ConflictoSincronizacion, "estadoConflicto" | "momentoDeteccion">,
  deps: DependenciasMotor,
): Promise<void> {
  await deps.conflictos.registrar({
    ...conflicto,
    estadoConflicto: "pendiente",
    momentoDeteccion: deps.ahora(),
  });
}
