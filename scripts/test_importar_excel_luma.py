"""Pruebas locales sin base de datos para reglas de importacion historica."""

from __future__ import annotations

import unittest

import openpyxl

from importar_excel_luma import (
    SourceRef,
    StagedRow,
    clasificar_venta_por_documento,
    es_transferencia_origen,
    parse_amount,
    positive_amount,
)


class ReglasImportacionHistoricaTests(unittest.TestCase):
    def test_importes_argentinos_y_positivos(self) -> None:
        self.assertEqual(str(parse_amount("$ 1.234,50")), "1234.50")
        self.assertEqual(str(parse_amount("1,234.50")), "1234.50")
        self.assertIsNone(positive_amount(0))
        self.assertIsNone(parse_amount("-1"))

    def test_transferencias_no_se_clasifican_como_ingresos_de_caja(self) -> None:
        self.assertTrue(es_transferencia_origen("Transferencia bancaria"))
        self.assertFalse(es_transferencia_origen("Credito"))

    def test_documento_duplicado_se_resuelve_solo_por_vin(self) -> None:
        libro = openpyxl.Workbook()
        clientes = libro.active
        clientes.title = "Clientes."
        ventas = libro.create_sheet("VENTAS")
        clientes.cell(4, 2).value = "12345678"
        clientes.cell(4, 15).value = "PRUEBA-UNO-123"
        clientes.cell(5, 2).value = "12345678"
        clientes.cell(5, 15).value = "PRUEBA-DOS-456"
        ventas.cell(4, 2).value = "PRUEBA-DOS-456"
        ventas.cell(4, 6).value = "12345678"

        primera = StagedRow(SourceRef("Clientes.", 4), {}, "a")
        segunda = StagedRow(SourceRef("Clientes.", 5), {}, "b")
        venta = StagedRow(SourceRef("VENTAS", 4), {}, "c")

        resultado = clasificar_venta_por_documento(
            libro, venta, {"12345678": [primera, segunda]}
        )

        self.assertIs(resultado, segunda)
        self.assertEqual(venta.errors, [])

    def test_documento_duplicado_sin_vin_no_se_infiere(self) -> None:
        libro = openpyxl.Workbook()
        clientes = libro.active
        clientes.title = "Clientes."
        ventas = libro.create_sheet("VENTAS")
        clientes.cell(4, 2).value = "12345678"
        clientes.cell(4, 15).value = "PRUEBA-UNO-123"
        clientes.cell(5, 2).value = "12345678"
        clientes.cell(5, 15).value = "PRUEBA-DOS-456"
        ventas.cell(4, 2).value = "PRUEBA-TRES-789"
        ventas.cell(4, 6).value = "12345678"

        primera = StagedRow(SourceRef("Clientes.", 4), {}, "a")
        segunda = StagedRow(SourceRef("Clientes.", 5), {}, "b")
        venta = StagedRow(SourceRef("VENTAS", 4), {}, "c")

        resultado = clasificar_venta_por_documento(
            libro, venta, {"12345678": [primera, segunda]}
        )

        self.assertIsNone(resultado)
        self.assertIn("VENTA_CLIENTE_DOCUMENTO_AMBIGUO", venta.errors)


if __name__ == "__main__":
    unittest.main()
