#!/usr/bin/env python3
"""Recarga las operaciones de la agencia desde el libro Excel de San Miguel.

Reemplaza las operaciones existentes por las del libro y recarga ingresos y
gastos importados, reutilizando el importador historico
(`importar_excel_luma.py`) para staging, maestros e ingresos/gastos.

Diferencias con el importador historico:

* No crea ni modifica marcas, modelos ni versiones: cada moto se cruza contra
  el catalogo existente (tabla de equivalencias abajo). Lo que no cruza queda
  en cuarentena.
* La hoja maestra de operaciones es "Clientes." (esta mas al dia que
  "VENTAS"). El precio sale de VENTAS (por VIN o documento), de las hojas de
  stock SERGIO/SIAM o, como ultimo recurso, del precio de lista vigente en la
  fecha de la operacion (marcado como inferido).
* Completa entrega, documentacion, patentamiento (fase 5), plataforma de
  pago y financiacion (componentes del plan), y reservas para que la unidad
  se vea en la operacion.
* La columna de vendedor queda solo como dato original (no se asigna).

Todo corre en una transaccion. Sin --aplicar se simula y se hace ROLLBACK.

Uso:
  DIRECT_URL=postgresql://... python scripts/recargar_agencia_excel.py \
      --libro "Agencia Lumamoto SM.xlsx" [--aplicar] [--reporte salida.json]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
import uuid
import warnings
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

import openpyxl
import psycopg
from psycopg.types.json import Jsonb

sys.path.insert(0, str(Path(__file__).resolve().parent))
import importar_excel_luma as base  # noqa: E402

ORGANIZACION = "LUMA_CENTRAL"
SUCURSAL = "San Miguel"
HOJA = "Clientes."

# Columnas de "Clientes." (1-based, fila de encabezado 3).
C_DOC, C_NOMBRE, C_FECHA, C_MOTO, C_PLATAFORMA, C_MONTO = 2, 3, 4, 5, 6, 7
C_RESPALDO, C_ENTREGA, C_PAPELES, C_VENDEDOR, C_DEBE = 9, 10, 11, 12, 13
C_CHASIS, C_PROVEEDOR, C_COMENTARIOS = 15, 16, 17

# Feriados nacionales (misma tabla que src/sales/ar-holidays.ts).
FERIADOS = {
    "2026-01-01", "2026-02-16", "2026-02-17", "2026-03-24", "2026-04-02",
    "2026-04-03", "2026-05-01", "2026-05-25", "2026-06-15", "2026-06-20",
    "2026-07-09", "2026-08-17", "2026-10-12", "2026-11-23", "2026-12-08",
    "2026-12-25", "2027-01-01", "2027-02-08", "2027-02-09", "2027-03-24",
    "2027-03-26", "2027-04-02", "2027-05-01", "2027-05-25", "2027-06-20",
    "2027-07-09", "2027-12-08", "2027-12-25",
}

# Modelo de COMPRAS / texto libre -> modelo del catalogo (marca, modelo
# normalizados). Solo cruza contra lo que ya existe; no crea catalogo.
EQUIVALENCIAS_MODELO = {
    ("gilera", "vc 150"): ("gilera", "vc 150 rd"),
    ("zanella", "zr 150"): ("zanella", "zr 150 ohc"),
    ("zanella", "zr150"): ("zanella", "zr 150 ohc"),
    ("zanella", "zr 250"): ("zanella", "zr 250 ohc"),
    ("zanella", "zb 110"): ("zanella", "zb 110 base"),
    ("zanella", "zb"): ("zanella", "zb"),
    ("zanella", "zb full"): ("zanella", "zb 110 full"),
    ("zanella", "due 110"): ("zanella", "due 110"),
    ("zanella", "rx 150"): ("zanella", "rx 150 base"),
    ("siam", "q base"): ("siam", "q base"),
    ("honda", "glh"): ("honda", "glh 150"),
    ("hero", "hunk xtec 150"): ("hero", "hunk 150 xtec"),
    ("keller", "stratus full"): ("keller", "stratus 150 full"),
    ("siam", "nomad"): ("siam", "nomad 150"),
}

COLORES = {
    "negro", "negra", "ng", "rojo", "roja", "rj", "blanco", "blanca", "bco",
    "azul", "gris", "verde", "amarillo", "naranja", "plata", "bordo",
    "celeste", "violeta", "dorado", "marron", "usado", "usada", "nuevo",
    "nueva", "0km", "full", "base",
}

# Texto libre de "Clientes." (sin colores) -> modelo del catalogo, para los
# casos que el cruce automatico no resuelve o resuelve ambiguo.
EQUIVALENCIAS_TEXTO = {
    "rouser 125": ("bajaj", "rouser 125"),
    "qu 110": ("siam", "qu"),
    "zr 150": ("zanella", "zr 150 ohc"),
    "hero hunter xtec 150": ("hero", "hunk 150 xtec"),
    "hunter xtec 150": ("hero", "hunk 150 xtec"),
    "motomel s2": ("motomel", "s2 150 full"),
    "xr 150": ("honda", "xr 150 l"),
    "glh": ("honda", "glh 150"),
    "nomad": ("siam", "nomad 150"),
    "zb": ("zanella", "zb"),
    "zb full": ("zanella", "zb 110 full"),
    "hero hunk 150": ("hero", "hunk 150"),
    "due 125": ("zanella", "due 125"),
    "mondial hd 250": ("mondial", "hd 250"),
}

FINANCIERAS_TEXTO = [
    ("CREDITECH DUOMO", "creditech duomo"),
    ("CREDITECH", "creditech unico"),
    ("CREDICUOTAS", "credicuotas"),
    ("SANTANDER", "santander consumer"),
    ("PROVINCIA", "provincia"),
    ("PRENDO", "prendo"),
    ("DIRECTO", "directo"),
    ("UALA", "uala"),
]
TEXTO_CONTADO = ("EFECTIVO", "EFE", "CONTADO", "TRANSFERENCIA", "TRASFERENCIA",
                 "TRANFERENCIA", "TARJETA", "TRAJETA", "TARJERTA", "ANTICIPO",
                 "SEÑA", "MERCADO PAGO", "PAGARE")
TEXTO_TOMA = re.compile(r"\bMOTO\b|USAD|\bCG\b|\bFZ\b|HUNK|\bVC\b|\bRX\b|\bQU\b|\bZB\b", re.I)


def norm(valor: Any) -> str:
    texto = unicodedata.normalize("NFKD", str(valor or ""))
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    return " ".join(texto.lower().split())


def clave(valor: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", norm(valor))


def dias_habiles(desde: date, dias: int) -> date:
    actual = desde
    restantes = dias
    while restantes > 0:
        actual += timedelta(days=1)
        if actual.weekday() < 5 and actual.isoformat() not in FERIADOS:
            restantes -= 1
    return actual


def fecha_retiro_patente(comentario: str | None, fecha_op: date) -> date | None:
    """'retiro la patente el 20/5' -> fecha (año de la operacion o siguiente)."""
    if not comentario or "patente" not in comentario.lower():
        return None
    m = re.search(r"(\d{1,2})\s*/\s*(\d{1,2})(?:\s*/\s*(\d{2,4}))?", comentario)
    if not m:
        return None
    dia, mes = int(m.group(1)), int(m.group(2))
    anio = int(m.group(3)) if m.group(3) else fecha_op.year
    if anio < 100:
        anio += 2000
    try:
        resultado = date(anio, mes, dia)
    except ValueError:
        return None
    if not m.group(3) and resultado < fecha_op:
        try:
            resultado = date(anio + 1, mes, dia)
        except ValueError:
            return None
    if resultado < fecha_op or resultado > date.today():
        return None
    return resultado


class Catalogo:
    def __init__(self, filas: list[tuple[Any, ...]]):
        # (marca_norm, modelo_norm) -> (version_id, activo)
        self.por_clave: dict[tuple[str, str], tuple[uuid.UUID, bool]] = {}
        self.modelos_por_marca: dict[str, list[tuple[str, uuid.UUID, bool]]] = {}
        for marca, modelo, version_id, activo in filas:
            k = (norm(marca), norm(modelo))
            previo = self.por_clave.get(k)
            if previo is None or (activo and not previo[1]):
                self.por_clave[k] = (version_id, activo)
            self.modelos_por_marca.setdefault(norm(marca), []).append(
                (norm(modelo), version_id, activo)
            )

    def por_marca_modelo(self, marca: Any, modelo: Any) -> uuid.UUID | None:
        k = (norm(marca), norm(modelo))
        k = EQUIVALENCIAS_MODELO.get(k, k)
        encontrado = self.por_clave.get(k)
        if encontrado:
            return encontrado[0]
        # Mismo modelo sin espacios ("ZR150" / "ZR 150").
        for modelo_cat, version_id, _ in self.modelos_por_marca.get(k[0], []):
            if clave(modelo_cat) == clave(k[1]):
                return version_id
        return None

    def por_texto(self, texto: Any) -> uuid.UUID | None:
        """Texto libre de 'Clientes.' ('SIAM Q FULL RJ', 'DUE NEGRA')."""
        palabras = [p for p in norm(str(texto or "").replace("/", " ")).split() if p not in COLORES]
        if not palabras:
            return None
        alias = EQUIVALENCIAS_TEXTO.get(" ".join(palabras))
        if alias and alias in self.por_clave:
            return self.por_clave[alias][0]
        candidatos: list[tuple[int, bool, uuid.UUID]] = []
        marcas = list(self.modelos_por_marca)
        marca_txt = next((p for p in palabras if p in marcas), None)
        resto = [p for p in palabras if p != marca_txt]
        if not resto:
            return None
        k_resto = " ".join(resto)
        for marca, modelos in self.modelos_por_marca.items():
            if marca_txt and marca != marca_txt:
                continue
            for modelo, version_id, activo in modelos:
                eq = EQUIVALENCIAS_MODELO.get((marca, k_resto))
                if eq and eq == (marca, modelo):
                    return version_id
                if clave(modelo) == clave(k_resto):
                    candidatos.append((3, activo, version_id))
                elif all(p in modelo.split() or p in clave(modelo) for p in resto):
                    candidatos.append((2, activo, version_id))
        if not candidatos:
            return None
        candidatos.sort(key=lambda c: (-c[0], not c[1]))
        mejores = [c for c in candidatos if c[:2] == candidatos[0][:2]]
        return mejores[0][2] if len(mejores) == 1 else None


def plataforma(texto: Any, precio: Decimal, monto: Any):
    t = str(texto or "").upper()
    financiera = next((f for marcador, f in FINANCIERAS_TEXTO if marcador in t), None)
    contado = any(m in t for m in TEXTO_CONTADO)
    toma = bool(TEXTO_TOMA.search(t))
    if financiera is None:
        return "EFECTIVO", None, None, toma, False
    monto_dec = base.parse_amount(monto)
    inferido = False
    if not contado:
        credito = precio
        if monto_dec and monto_dec != precio:
            inferido = True
    elif monto_dec and Decimal(0) < monto_dec < precio:
        credito = monto_dec
    else:
        # Mixto sin monto de credito confiable: se toma todo como credito.
        credito = precio
        contado = False
        inferido = True
    return ("EFECTIVO_CREDITO" if contado else "CREDITO"), credito, financiera, toma, inferido


def tipo_contado(texto: Any) -> str:
    t = str(texto or "").upper()
    tiene = lambda *ms: any(m in t for m in ms)  # noqa: E731
    if tiene("TARJETA", "TRAJETA", "TARJERTA") and not tiene("EFECTIVO", "EFE", "CONTADO", "TRANSF", "TRASF", "TRANF"):
        return "TARJETA"
    if tiene("TRANSF", "TRASF", "TRANF") and not tiene("EFECTIVO", "EFE", "CONTADO", "TARJ"):
        return "TRANSFERENCIA_BANCARIA"
    return "EFECTIVO"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--libro", required=True, type=Path)
    parser.add_argument("--aplicar", action="store_true")
    parser.add_argument("--reporte", type=Path)
    parser.add_argument("--variable-entorno-base-datos", default="DIRECT_URL")
    args = parser.parse_args()
    url = os.environ.get(args.variable_entorno_base_datos)
    if not url:
        print(f"Falta {args.variable_entorno_base_datos}", file=sys.stderr)
        return 2

    warnings.filterwarnings("ignore", category=UserWarning, module=r"openpyxl")
    libro = args.libro.resolve()
    wb = openpyxl.load_workbook(libro, data_only=True)
    wb_f = openpyxl.load_workbook(libro, data_only=False)
    staged = base.load_staged_rows(wb, wb_f)
    by_source = {r.source: r for r in staged}
    clientes = base.extract_customers(wb, staged)
    base.flag_customer_identity_conflicts(clientes, by_source)
    staff = base.extract_staff(wb, staged)
    proveedores = base.extract_suppliers(wb, staged)
    vehiculos = base.extract_vehicles(wb, staged)
    reporte: dict[str, Any] = {"modo": "aplicar" if args.aplicar else "simulacion"}
    cuarentena: list[dict[str, Any]] = []

    with psycopg.connect(url, autocommit=True) as cx:
        base.ensure_import_schema(cx, True)
        tx = cx.transaction()
        tx.__enter__()
        try:
            org_id, codigo = base.resolve_organizacion(cx, ORGANIZACION)
            suc_id = base.resolver_sucursal(cx, org_id, SUCURSAL)
            cur = cx.cursor()

            # 1. Borrado de operaciones y de ingresos/gastos importados.
            cur.execute("SELECT id FROM operaciones WHERE organizacion_id=%s", (org_id,))
            ops = [r[0] for r in cur.fetchall()]
            cur.execute("SELECT id FROM ingresos WHERE organizacion_id=%s AND (fila_importacion_id IS NOT NULL OR operacion_id = ANY(%s))", (org_id, ops))
            ingresos = [r[0] for r in cur.fetchall()]
            cur.execute("SELECT id FROM gastos WHERE organizacion_id=%s AND (fila_importacion_id IS NOT NULL OR operacion_id = ANY(%s))", (org_id, ops))
            gastos = [r[0] for r in cur.fetchall()]
            borrado = {"operaciones": len(ops), "ingresos": len(ingresos), "gastos": len(gastos)}
            # movimientos_caja es append-only: se desactiva el disparador solo
            # dentro de esta transaccion para borrar los movimientos importados.
            cur.execute("ALTER TABLE movimientos_caja DISABLE TRIGGER disparador_movimientos_caja_append_only")
            cur.execute("DELETE FROM movimientos_caja WHERE ingreso_id = ANY(%s) OR gasto_id = ANY(%s)", (ingresos, gastos))
            borrado["movimientos_caja"] = cur.rowcount
            cur.execute("ALTER TABLE movimientos_caja ENABLE TRIGGER disparador_movimientos_caja_append_only")
            cur.execute("UPDATE liquidaciones_comisiones SET gasto_id=NULL WHERE gasto_id = ANY(%s)", (gastos,))
            cur.execute("DELETE FROM ingresos WHERE id = ANY(%s)", (ingresos,))
            cur.execute("DELETE FROM gastos WHERE id = ANY(%s)", (gastos,))
            cur.execute("UPDATE polizas_seguros SET operacion_id=NULL WHERE operacion_id = ANY(%s)", (ops,))
            cur.execute("UPDATE consultas_crediticias SET operacion_id=NULL WHERE operacion_id = ANY(%s)", (ops,))
            cur.execute("DELETE FROM cobranzas WHERE componente_pago_id IN (SELECT id FROM componentes_pago_operacion WHERE operacion_id = ANY(%s))", (ops,))
            for tabla in ("pagos_vehiculo", "movimientos_inventario", "operaciones_liquidacion_comision",
                          "operacion_creditos", "obligaciones_operacion", "aprobaciones_operacion",
                          "asignaciones_personal_operacion", "reservas_stock", "componentes_pago_operacion",
                          "vehiculos_tomados_parte_pago"):
                cur.execute(f"DELETE FROM {tabla} WHERE operacion_id = ANY(%s)", (ops,))
                borrado[tabla] = cur.rowcount
            cur.execute("UPDATE compras_proveedor SET solicitud_abastecimiento_id=NULL WHERE solicitud_abastecimiento_id IN (SELECT id FROM solicitudes_abastecimiento WHERE operacion_id = ANY(%s))", (ops,))
            cur.execute("UPDATE movimientos_inventario SET solicitud_abastecimiento_id=NULL WHERE solicitud_abastecimiento_id IN (SELECT id FROM solicitudes_abastecimiento WHERE operacion_id = ANY(%s))", (ops,))
            cur.execute("DELETE FROM solicitudes_abastecimiento WHERE operacion_id = ANY(%s)", (ops,))
            borrado["solicitudes_abastecimiento"] = cur.rowcount
            # Las unidades de las operaciones borradas vuelven a stock; la recarga
            # les asigna el estado que corresponda.
            cur.execute("""UPDATE unidades_vehiculos SET estado_inventario='EN_STOCK'
                WHERE estado_inventario IN ('RESERVADO','VENDIDO','ENTREGADO')
                  AND id IN (SELECT unidad_vehiculo_id FROM operaciones WHERE id = ANY(%s))""", (ops,))
            borrado["unidades_liberadas"] = cur.rowcount
            cur.execute("DELETE FROM operaciones WHERE id = ANY(%s)", (ops,))
            # Numeracion desde 1 (las operaciones se cargan por fecha).
            cur.execute("SELECT setval(pg_get_serial_sequence('operaciones','numero_operacion'), 1, false)")
            reporte["borrado"] = borrado

            # 2. Staging del libro y maestros (importador historico).
            lote_id = base.stage_rows(cx, libro, base.sha256_file(libro), staged, org_id)
            base.import_staff(cx, staff, by_source, org_id, codigo, suc_id)
            supplier_ids = base.import_suppliers(cx, proveedores, by_source, org_id, codigo)
            reporte["clientes_procesados"] = base.import_customers(cx, clientes, by_source, org_id, codigo)
            actor = base.asegurar_actor_sistema_importado(cx, org_id, suc_id)

            cur.execute("""SELECT mk.nombre, m.nombre, v.id, (m.activo AND v.activo)
                FROM versiones_vehiculos v JOIN modelos_vehiculos m ON m.id=v.modelo_id
                JOIN marcas_vehiculos mk ON mk.id=m.marca_id WHERE m.tipo_vehiculo='MOTO'""")
            catalogo = Catalogo(cur.fetchall())

            # 3. Unidades nuevas de COMPRAS (sin tocar catalogo) y costo faltante.
            unidades = base.cargar_unidades_por_vin(cx, org_id)
            nuevas = costos = 0
            for v in vehiculos:
                if not v.vin_normalizado:
                    continue
                if v.vin_normalizado in unidades:
                    if v.costo_compra:
                        cur.execute("UPDATE unidades_vehiculos SET costo_compra=%s WHERE vin_normalizado=%s AND costo_compra IS NULL", (v.costo_compra, v.vin_normalizado))
                        costos += cur.rowcount
                    continue
                version_id = catalogo.por_marca_modelo(v.brand_name, v.model_name)
                if version_id is None:
                    base.append_error(by_source[v.source], "CATALOGO_SIN_EQUIVALENTE")
                    cuarentena.append({"hoja": "COMPRAS", "fila": v.source.row, "motivo": "Modelo sin equivalente en catalogo", "detalle": f"{v.brand_name} {v.model_name} {v.vin_mostrado}"})
                    continue
                unidad_id = uuid.uuid4()
                cur.execute("""INSERT INTO unidades_vehiculos (id, organizacion_id, version_id, sucursal_id, condicion,
                      vin_mostrado, vin_normalizado, numero_motor, motor_normalizado, anio_fabricacion, color,
                      proveedor_id, origen_adquisicion, costo_compra, estado_inventario, recibido_en, fila_importacion_id,
                      kilometraje_km, es_importada)
                    VALUES (%s,%s,%s,%s,'NUEVO',%s,%s,%s,%s,%s,%s,%s,'PROVEEDOR',%s,'EN_STOCK',%s,%s,0,true)""",
                    (unidad_id, org_id, version_id, suc_id, v.vin_mostrado, v.vin_normalizado, v.numero_motor,
                     v.engine_normalized, v.anio_fabricacion, v.color, supplier_ids.get(v.supplier_normalized or ""),
                     v.costo_compra, v.recibido_en or datetime.now(timezone.utc), by_source[v.source].fila_importacion_id))
                base.mark_target(by_source, v.source, "unidades_vehiculos", unidad_id)
                nuevas += 1
            reporte["unidades_nuevas"] = nuevas
            reporte["unidades_costo_completado"] = costos
            unidades = base.cargar_unidades_por_vin(cx, org_id)

            # 4. Operaciones desde "Clientes.".
            ventas_vin: dict[str, Decimal] = {}
            ventas_doc: dict[str, Decimal] = {}
            for fila in base.iter_source_rows(staged, "VENTAS"):
                precio = base.positive_amount(base.cell(wb, "VENTAS", fila.source.row, 9))
                vin, _ = base.valid_vin(base.cell(wb, "VENTAS", fila.source.row, 2))
                doc = base.normalize_document(base.cell(wb, "VENTAS", fila.source.row, 6))
                if precio and vin:
                    ventas_vin[vin] = precio
                if precio and doc:
                    ventas_doc.setdefault(doc, precio)
            stock_vin: dict[str, Decimal] = {}
            for hoja in ("SERGIO", "SIAM"):
                for fila in base.iter_source_rows(staged, hoja):
                    vin, _ = base.valid_vin(base.cell(wb, hoja, fila.source.row, 3))
                    precio = base.positive_amount(base.cell(wb, hoja, fila.source.row, 4))
                    if vin and precio:
                        stock_vin[vin] = precio
            clientes_doc = base.cargar_clientes_por_documento(cx, org_id)
            cur.execute("SELECT id, nombre_normalizado FROM financieras WHERE organizacion_id=%s AND activo", (org_id,))
            financieras = {norm(n): i for i, n in cur.fetchall()}

            filas = []
            for fila in base.iter_source_rows(staged, HOJA):
                r = fila.source.row
                fecha = base.parse_date(base.cell(wb, HOJA, r, C_FECHA))
                doc = base.normalize_document(base.cell(wb, HOJA, r, C_DOC))
                if fecha is None or doc is None:
                    continue
                filas.append((fecha, r, fila, doc))
            filas.sort(key=lambda x: (x[0], x[1]))

            stats = Counter()
            unidades_usadas: set[uuid.UUID] = set()
            for fecha, r, fila, doc in filas:
                def falta(motivo: str, detalle: str = "") -> None:
                    base.append_error(fila, motivo)
                    cuarentena.append({"hoja": HOJA, "fila": r, "fecha": fecha.isoformat(), "motivo": motivo,
                                       "detalle": detalle or str(base.cell(wb, HOJA, r, C_MOTO) or "")})
                cliente_id = clientes_doc.get((base.tipo_documento(doc), doc))
                if cliente_id is None:
                    falta("OPERACION_CLIENTE_NO_IMPORTADO")
                    continue
                entrega_txt = norm(base.cell(wb, HOJA, r, C_ENTREGA))
                vin, _ = base.valid_vin(base.cell(wb, HOJA, r, C_CHASIS))
                unidad = unidades.get(vin) if vin else None
                if unidad and unidad[0] in unidades_usadas:
                    unidad = None
                    stats["unidad_repetida"] += 1
                version_id = unidad[1] if unidad else catalogo.por_texto(base.cell(wb, HOJA, r, C_MOTO))
                if version_id is None:
                    falta("OPERACION_MODELO_NO_IDENTIFICADO")
                    continue
                condicion = unidad[2] if unidad else ("USADO" if "usad" in norm(base.cell(wb, HOJA, r, C_MOTO)) else "NUEVO")
                unidad_creada = False
                if unidad is None and vin and vin not in unidades and "anulad" not in entrega_txt:
                    # Chasis vendido que no figura en COMPRAS: se da de alta la
                    # unidad con la version cruzada (sin tocar catalogo).
                    unidad_id = uuid.uuid4()
                    cur.execute("""INSERT INTO unidades_vehiculos (id, organizacion_id, version_id, sucursal_id, condicion,
                          vin_mostrado, vin_normalizado, origen_adquisicion, estado_inventario, recibido_en,
                          fila_importacion_id, kilometraje_km, es_importada, datos_inferidos)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,'PROVEEDOR','EN_STOCK',%s,%s,0,true,%s)""",
                        (unidad_id, org_id, version_id, suc_id, condicion,
                         base.safe_text(base.cell(wb, HOJA, r, C_CHASIS)), vin,
                         datetime.combine(fecha, datetime.min.time(), timezone.utc), fila.fila_importacion_id,
                         Jsonb({"origen": "excel_agencia_sm_recarga", "alta_desde_venta": True})))
                    unidad = (unidad_id, version_id, condicion)
                    unidades[vin] = unidad
                    unidad_creada = True
                    stats["unidad_alta_desde_venta"] += 1
                precio_origen = None
                precio = None
                if vin and vin in ventas_vin:
                    precio, precio_origen = ventas_vin[vin], "VENTAS"
                elif doc in ventas_doc:
                    precio, precio_origen = ventas_doc[doc], "VENTAS_DOCUMENTO"
                elif vin and vin in stock_vin:
                    precio, precio_origen = stock_vin[vin], "STOCK"
                else:
                    cur.execute("""SELECT precio_lista FROM politicas_precios_vehiculos WHERE organizacion_id=%s
                        AND version_id=%s AND sucursal_id IS NULL AND activa AND vigente_desde<=%s
                        AND (vigente_hasta IS NULL OR vigente_hasta>=%s) ORDER BY vigente_desde DESC LIMIT 1""",
                        (org_id, version_id, fecha, fecha))
                    fila_precio = cur.fetchone()
                    if fila_precio and fila_precio[0] > 0:
                        precio, precio_origen = fila_precio[0], "LISTA_CATALOGO"
                    else:
                        # Sin lista vigente a la fecha: la primera lista posterior.
                        cur.execute("""SELECT precio_lista FROM politicas_precios_vehiculos WHERE organizacion_id=%s
                            AND version_id=%s AND sucursal_id IS NULL AND precio_lista > 0
                            ORDER BY vigente_desde LIMIT 1""", (org_id, version_id))
                        fila_precio = cur.fetchone()
                        if fila_precio:
                            precio, precio_origen = fila_precio[0], "LISTA_CATALOGO_POSTERIOR"
                if precio is None:
                    falta("OPERACION_PRECIO_DESCONOCIDO")
                    continue
                stats[f"precio_{precio_origen}"] += 1

                if "anulad" in entrega_txt:
                    estado, entrega = "CANCELADA", "CANCELADA"
                elif "entregad" in entrega_txt:
                    estado, entrega = "CERRADA", "ENTREGADO"
                else:
                    estado, entrega = "APROBADA", "NO_PROGRAMADA"
                if estado == "CERRADA" and unidad is None:
                    # Entregada pero sin chasis cargado en el libro.
                    estado, entrega = "APROBADA", "NO_PROGRAMADA"
                    stats["entregada_sin_unidad"] += 1
                stats[f"estado_{estado}"] += 1

                plat_txt = base.cell(wb, HOJA, r, C_PLATAFORMA)
                plat, credito, financiera, toma, credito_inferido = plataforma(plat_txt, precio, base.cell(wb, HOJA, r, C_MONTO))
                comentarios = base.safe_text(base.cell(wb, HOJA, r, C_COMENTARIOS))
                debe_txt = norm(base.cell(wb, HOJA, r, C_DEBE))
                paga_patente = "patente" in debe_txt or "pago la patente" in norm(comentarios)
                retiro = fecha_retiro_patente(comentarios, fecha)
                papeles = base.cell(wb, HOJA, r, C_PAPELES) is True
                debe = ("PAPELES" if "patente" in debe_txt else
                        "OTRO" if debe_txt and debe_txt not in ("pago", "none") else "NO")
                estimada = (dias_habiles(fecha, 10), dias_habiles(fecha, 15)) if estado != "CANCELADA" else (None, None)
                entregado_en = datetime.combine(fecha, datetime.min.time(), timezone(timedelta(hours=-3))).replace(hour=12) if entrega == "ENTREGADO" else None
                doc_en = None
                if papeles:
                    doc_en = datetime.combine(retiro or fecha, datetime.min.time(), timezone(timedelta(hours=-3))).replace(hour=12)
                notas = " · ".join(x for x in [
                    comentarios,
                    f"Plataforma original: {base.safe_text(plat_txt)}" if plat_txt else None,
                    f"Vendedor (libro): {base.safe_text(base.cell(wb, HOJA, r, C_VENDEDOR))}" if base.cell(wb, HOJA, r, C_VENDEDOR) else None,
                    "Incluye moto usada en parte de pago (sin detalle en el libro)" if toma else None,
                ] if x)
                respaldo = base.safe_text(base.cell(wb, HOJA, r, C_RESPALDO))
                if respaldo and norm(respaldo) == "sin respaldo":
                    respaldo = None
                datos = {
                    "origen": "excel_agencia_sm_recarga",
                    "hoja": HOJA, "fila": r,
                    "precio_origen": precio_origen,
                    "modelo_desde_texto": not unidad or unidad_creada,
                    "unidad_alta_desde_venta": unidad_creada,
                    "plataforma_original": base.json_value(plat_txt),
                    "monto_credito_original": base.json_value(base.cell(wb, HOJA, r, C_MONTO)),
                    "credito_inferido": credito_inferido,
                    "entrega_original": base.json_value(base.cell(wb, HOJA, r, C_ENTREGA)),
                    "papeles_original": base.json_value(base.cell(wb, HOJA, r, C_PAPELES)),
                    "debe_original": base.json_value(base.cell(wb, HOJA, r, C_DEBE)),
                    "vendedor_original": base.json_value(base.cell(wb, HOJA, r, C_VENDEDOR)),
                    "proveedor_original": base.json_value(base.cell(wb, HOJA, r, C_PROVEEDOR)),
                    "fecha_entrega_inferida": entrega == "ENTREGADO",
                    "fecha_papeles_inferida": papeles and retiro is None,
                    "toma_parte_pago_sin_detalle": toma,
                }
                op_id = uuid.uuid4()
                cur.execute("""INSERT INTO operaciones (id, organizacion_id, sucursal_id, cliente_id, version_id, condicion,
                      unidad_vehiculo_id, fecha_operacion, estado_operacion, precio_acordado, moneda, plataforma_pago,
                      monto_credito, respaldo_garante, modalidad_patentamiento, patente_estimada_desde,
                      patente_estimada_hasta, patente_recibida_en, debe, estado_entrega, entregado_en,
                      estado_documentacion, documentacion_entregada_en, creado_por_personal_id, notas, es_importada,
                      precios_referencia_completos, fila_importacion_id, datos_inferidos)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'ARS',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,true,false,%s,%s)
                    RETURNING numero_operacion""",
                    (op_id, org_id, suc_id, cliente_id, version_id, condicion, unidad[0] if unidad else None, fecha,
                     "APROBADA" if estado == "CERRADA" else estado, precio, plat, credito, respaldo[:500] if respaldo else None,
                     "PAGA_CLIENTE" if paga_patente else None, estimada[0], estimada[1], retiro, debe, entrega,
                     entregado_en, "COMPLETA" if papeles else "NO_INICIADA", doc_en, actor, notas or None,
                     fila.fila_importacion_id, Jsonb(datos)))
                base.mark_target(by_source, fila.source, "operaciones", op_id)
                stats["operaciones"] += 1
                if paga_patente:
                    stats["patente_paga_cliente"] += 1
                if retiro:
                    stats["patente_recibida"] += 1

                # Plan de pago.
                componentes = []
                if credito:
                    fin_id = financieras.get(financiera)
                    if fin_id is None:
                        stats["financiera_no_encontrada"] += 1
                        componentes.append(("OTRO", credito, None))
                    else:
                        componentes.append(("FINANCIACION", credito, fin_id))
                resto = precio - (credito or Decimal(0))
                if resto > 0:
                    componentes.append((tipo_contado(plat_txt), resto, None))
                pagado = estado == "CERRADA"
                for i, (tipo, importe, fin_id) in enumerate(componentes):
                    cur.execute("""INSERT INTO componentes_pago_operacion (organizacion_id, operacion_id, tipo_componente,
                          importe_esperado, financiera_id, estado_pago, notas, es_importado, fila_importacion_id,
                          datos_inferidos, financiera_pago_informado_en, financiera_pago_informado_por_personal_id)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (org_id, op_id, tipo, importe, fin_id,
                         "PAGADO" if pagado else ("CANCELADA" if estado == "CANCELADA" else "PENDIENTE"),
                         "Componente historico del libro de la agencia.",
                         # El indice unico admite una sola fila de origen por componente.
                         i == 0,
                         fila.fila_importacion_id if i == 0 else None,
                         Jsonb({"origen": "excel_agencia_sm_recarga", "plataforma_original": base.json_value(plat_txt)}),
                         entregado_en if (pagado and tipo == "FINANCIACION") else None,
                         actor if (pagado and tipo == "FINANCIACION") else None))
                    stats[f"componente_{tipo}"] += 1

                if estado == "CERRADA":
                    # Se cierra despues de cargar el plan (invariante de total).
                    cur.execute("UPDATE operaciones SET estado_operacion='CERRADA' WHERE id=%s", (op_id,))

                # Reserva: la unidad se muestra en la operacion (ACTIVO/CONSUMIDA).
                if unidad and estado in ("APROBADA", "CERRADA"):
                    unidades_usadas.add(unidad[0])
                    cur.execute("UPDATE unidades_vehiculos SET estado_inventario=%s WHERE id=%s",
                                ("ENTREGADO" if estado == "CERRADA" else "RESERVADO", unidad[0]))
                    cur.execute("""INSERT INTO reservas_stock (organizacion_id, operacion_id, unidad_vehiculo_id, cantidad,
                          estado, vence_en, creado_por_personal_id)
                        VALUES (%s,%s,%s,1,%s,%s,%s)""",
                        (org_id, op_id, unidad[0], "CONSUMIDA" if estado == "CERRADA" else "ACTIVO",
                         datetime.now(timezone.utc) + timedelta(days=30), actor))
            reporte["operaciones"] = dict(sorted(stats.items()))

            # 5. Ingresos, gastos y pagos de formulario (importador historico).
            personal = base.cargar_personal_por_nombre(cx, org_id)
            cuentas = base.asegurar_cuentas_historicas(cx, org_id, suc_id, base.cuentas_historicas_requeridas(wb, staged), personal)
            reporte["ingresos"] = base.importar_ingresos_historicos(cx, wb, staged, by_source, org_id, suc_id, actor, cuentas)
            reporte["gastos_ventas"] = base.importar_gastos_ventas_historicos(cx, wb, staged, by_source, org_id, suc_id, actor, cuentas)
            reporte["pagos_formulario"] = base.importar_pagos_formulario_historicos(cx, wb, staged, by_source, org_id, suc_id, actor, cuentas)

            base.finalize_batch(cx, lote_id, staged, True)
            cur.execute("""SELECT
                (SELECT count(*) FROM operaciones WHERE organizacion_id=%s),
                (SELECT count(*) FROM ingresos WHERE organizacion_id=%s),
                (SELECT count(*) FROM gastos WHERE organizacion_id=%s),
                (SELECT max(numero_operacion) FROM operaciones WHERE organizacion_id=%s)""", (org_id,) * 4)
            ops_n, ing_n, gas_n, max_n = cur.fetchone()
            reporte["resultado_final"] = {"operaciones": ops_n, "ingresos": ing_n, "gastos": gas_n, "ultimo_numero": max_n}
            reporte["cuarentena_por_hoja"] = dict(Counter(f"{r.source.sheet}: {e}" for r in staged for e in r.errors if r.source.sheet in (HOJA, "COMPRAS", "INGRESOS", "GASTOS V", "PAGOS F")))
            if not args.aplicar:
                raise RuntimeError("SIMULACION")
            tx.__exit__(None, None, None)
        except RuntimeError as error:
            tx.__exit__(type(error), error, None)
            if str(error) != "SIMULACION":
                raise
        except BaseException as error:
            tx.__exit__(type(error), error, None)
            raise

    reporte["cuarentena_operaciones"] = cuarentena
    salida = json.dumps(reporte, indent=2, ensure_ascii=False, default=str)
    if args.reporte:
        args.reporte.write_text(salida, encoding="utf-8")
    print(salida)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
