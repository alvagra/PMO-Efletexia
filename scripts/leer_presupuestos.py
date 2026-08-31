"""
Lee los Excel de presupuesto desde la carpeta compartida de Drive,
valida cada archivo y produce presupuestos.json para el Dashboard PMO.

Uso:
    python leer_presupuestos.py --out public/data/presupuestos.json

Requiere:
    pip install google-api-python-client google-auth openpyxl
    Variable de entorno GOOGLE_SERVICE_ACCOUNT_JSON con el JSON de credenciales.
"""

import argparse
import io
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from openpyxl import load_workbook

FOLDER_ID = "1EXwrEtFKh7Q0MdPB2hcUMpBpRc3cRFTm"
VERSION_ESPERADA = "v2"
SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MIME_GSHEET = "application/vnd.google-apps.spreadsheet"

RE_KEY = re.compile(r"(PTS-\d+)", re.IGNORECASE)

ESCALARES = [
    "epica_key", "codigo_proyecto", "responsable", "version_plantilla",
    "nombre_proyecto", "duracion_meses", "tipo_cambio",
    "subtotal_estimacion", "reserva_contingencia", "linea_base_bac",
    "reserva_gestion", "presupuesto_total", "opex_mensual", "opex_anual",
    "equipo_horas", "equipo_costo",
    "mes_corte", "evm_pv", "evm_ev", "evm_ac", "evm_cpi", "evm_spi",
    "evm_eac", "evm_vac", "evm_diagnostico",
    "ingresos_total", "van", "tir", "payback", "roi_5a", "costo_total_5a",
    "conclusion", "control_categorias",
]
CATEGORIAS = [
    "capex_personal", "capex_infraestructura", "capex_equipos",
    "capex_instalacion", "capex_materiales", "capex_licenciamiento",
    "capex_sin_categoria",
    "opex_personal", "opex_licenciamiento", "opex_soporte_y_mantenimiento",
    "opex_infraestructura", "opex_telecomunicaciones", "opex_viajes",
    "opex_sin_categoria",
]
SERIES = ["curva_pv_pct", "curva_pv_acum", "curva_avance_real", "curva_ac_acum"]


class ArchivoRechazado(Exception):
    pass


def cliente_drive():
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not raw:
        sys.exit("Falta la variable de entorno GOOGLE_SERVICE_ACCOUNT_JSON")
    creds = service_account.Credentials.from_service_account_info(
        json.loads(raw), scopes=SCOPES
    )
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def listar_archivos(drive):
    """Devuelve los .xlsx de la carpeta, incluyendo unidades compartidas."""
    archivos, token = [], None
    consulta = (
        f"'{FOLDER_ID}' in parents and trashed = false "
        f"and (mimeType = '{MIME_XLSX}' or mimeType = '{MIME_GSHEET}')"
    )
    while True:
        resp = drive.files().list(
            q=consulta,
            fields="nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink)",
            pageSize=200,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
            pageToken=token,
        ).execute()
        archivos.extend(resp.get("files", []))
        token = resp.get("nextPageToken")
        if not token:
            return archivos


def descargar(drive, archivo):
    if archivo["mimeType"] == MIME_GSHEET:
        pedido = drive.files().export_media(fileId=archivo["id"], mimeType=MIME_XLSX)
    else:
        pedido = drive.files().get_media(fileId=archivo["id"], supportsAllDrives=True)
    buffer = io.BytesIO()
    bajada = MediaIoBaseDownload(buffer, pedido)
    terminado = False
    while not terminado:
        _, terminado = bajada.next_chunk()
    buffer.seek(0)
    return buffer


def normalizar(texto):
    sin_tildes = unicodedata.normalize("NFKD", str(texto))
    sin_tildes = "".join(c for c in sin_tildes if not unicodedata.combining(c))
    return sin_tildes.strip().lower()


def leer_rango(wb, nombre):
    """Resuelve un rango con nombre. Devuelve un valor o una lista."""
    if nombre not in wb.defined_names:
        raise ArchivoRechazado(f"falta el rango con nombre '{nombre}'")
    hoja, ref = list(wb.defined_names[nombre].destinations)[0]
    celdas = wb[hoja][ref.replace("$", "")]
    if isinstance(celdas, tuple):
        planas = [c.value for fila in celdas for c in fila]
        return planas
    return celdas.value


def numero(valor, campo):
    if valor in (None, "", "—", "n/d"):
        return 0.0
    if isinstance(valor, str):
        limpio = valor.replace("S/", "").replace("US$", "").replace(",", "").strip()
        try:
            return float(limpio)
        except ValueError:
            raise ArchivoRechazado(
                f"'{campo}' contiene texto y no un número: {valor!r}"
            )
    if isinstance(valor, (int, float)):
        return float(valor)
    raise ArchivoRechazado(f"'{campo}' tiene un tipo inesperado: {type(valor).__name__}")


def procesar(archivo, buffer):
    """Parsea un libro ya descargado. Lanza ArchivoRechazado si no cumple."""
    wb = load_workbook(buffer, data_only=True, read_only=False)

    version = leer_rango(wb, "version_plantilla")
    if normalizar(version) != VERSION_ESPERADA:
        raise ArchivoRechazado(
            f"plantilla {version!r}, se esperaba {VERSION_ESPERADA!r}"
        )

    key_hoja = str(leer_rango(wb, "epica_key") or "").strip().upper()
    coincidencia = RE_KEY.search(archivo["name"])
    if not coincidencia:
        raise ArchivoRechazado("el nombre del archivo no contiene un key PTS-###")
    key_archivo = coincidencia.group(1).upper()
    if key_hoja != key_archivo:
        raise ArchivoRechazado(
            f"el key de la hoja ({key_hoja}) no coincide con el del archivo ({key_archivo})"
        )
    if key_hoja == "PTS-000":
        raise ArchivoRechazado("el key sigue en PTS-000, no fue completado")

    control = str(leer_rango(wb, "control_categorias") or "")
    if "listo" not in normalizar(control):
        raise ArchivoRechazado(control or "el control de categorías no está en verde")

    datos = {"key": key_hoja}
    for campo in ESCALARES:
        valor = leer_rango(wb, campo)
        datos[campo] = valor

    montos = {}
    for campo in CATEGORIAS:
        montos[campo] = numero(leer_rango(wb, campo), campo)
    datos["categorias"] = montos

    for campo in ["subtotal_estimacion", "reserva_contingencia", "linea_base_bac",
                  "reserva_gestion", "presupuesto_total", "opex_mensual",
                  "opex_anual", "equipo_horas", "equipo_costo", "evm_pv", "evm_ev",
                  "evm_ac", "evm_cpi", "evm_spi", "evm_eac", "evm_vac",
                  "ingresos_total", "van", "roi_5a", "costo_total_5a",
                  "tipo_cambio", "duracion_meses", "mes_corte"]:
        datos[campo] = numero(datos.get(campo), campo)

    if datos["linea_base_bac"] <= 0:
        raise ArchivoRechazado("la línea base de costos es cero")
    if datos["tipo_cambio"] <= 0:
        raise ArchivoRechazado("el tipo de cambio es cero o negativo")

    series = {}
    for campo in SERIES:
        series[campo] = [numero(v, campo) for v in leer_rango(wb, campo)]
    datos["curva_s"] = series

    datos["archivo"] = archivo["name"]
    datos["url"] = archivo.get("webViewLink", "")
    datos["modificado"] = archivo["modifiedTime"]
    wb.close()
    return datos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="public/data/presupuestos.json")
    args = ap.parse_args()

    drive = cliente_drive()
    archivos = listar_archivos(drive)
    print(f"{len(archivos)} archivos en la carpeta")

    proyectos, rechazos, vistos = [], [], {}

    for archivo in sorted(archivos, key=lambda a: a["name"]):
        try:
            datos = procesar(archivo, descargar(drive, archivo))
        except ArchivoRechazado as e:
            rechazos.append({"archivo": archivo["name"], "motivo": str(e)})
            print(f"  RECHAZADO  {archivo['name']}: {e}")
            continue
        except Exception as e:
            rechazos.append({
                "archivo": archivo["name"],
                "motivo": f"error al leer: {type(e).__name__}",
            })
            print(f"  ERROR      {archivo['name']}: {e}")
            continue

        key = datos["key"]
        if key in vistos:
            rechazos.append({
                "archivo": archivo["name"],
                "motivo": f"{key} ya fue cargado desde {vistos[key]}",
            })
            print(f"  DUPLICADO  {archivo['name']}: {key}")
            continue
        vistos[key] = archivo["name"]
        proyectos.append(datos)
        print(f"  OK         {archivo['name']}")

    salida = {
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "carpeta": FOLDER_ID,
        "version_plantilla": VERSION_ESPERADA,
        "resumen": {
            "leidos": len(archivos),
            "cargados": len(proyectos),
            "rechazados": len(rechazos),
        },
        "rechazos": rechazos,
        "proyectos": proyectos,
    }

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(salida, fh, ensure_ascii=False, indent=1)

    print(f"\n{len(proyectos)} cargados, {len(rechazos)} rechazados → {args.out}")

    if rechazos:
        print("\nRechazos:")
        for r in rechazos:
            print(f"  {r['archivo']}: {r['motivo']}")

    # El job no falla por rechazos: publica lo válido y reporta el resto.
    return 0


if __name__ == "__main__":
    sys.exit(main())
