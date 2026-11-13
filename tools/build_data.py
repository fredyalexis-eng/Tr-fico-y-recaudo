#!/usr/bin/env python3
"""
Construye el archivo de datos compacto (web/data.json) que consume la aplicación
HTML interactiva a partir del libro de Excel de la ANI.

Uso:
    python3 tools/build_data.py

Requiere: pandas, openpyxl
    pip install --break-system-packages pandas openpyxl
"""
from __future__ import annotations

import json
import os
import re
import unicodedata
from datetime import datetime, timezone

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX = os.path.join(
    ROOT,
    "8. Resumen Mensual por estación de Peaje Tráfico y Recaudo 2014 a ago 2026.xlsx",
)
SHEET = "2. DetalleReporte"
OUT = os.path.join(ROOT, "web", "data.json")

MONTH_ABBR = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

# Etiquetas legibles para las categorías tarifarias de la ANI.
CATEGORIA_LABEL = {
    "I": "I · Automóviles",
    "II": "II · Buses",
    "III": "III · Camiones 2 ejes",
    "IV": "IV · Camiones 3 ejes",
    "V": "V · Camiones 4 ejes",
    "VI": "VI · Camiones 5 ejes",
    "VII": "VII · Camiones 6+ ejes",
    "UNICA": "Única / mixta",
}


def slug(text: str) -> str:
    text = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode()
    text = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower()
    return text or "peaje"


def load_detalle() -> pd.DataFrame:
    if not os.path.exists(XLSX):
        raise SystemExit(f"No se encontró el archivo fuente: {XLSX}")
    print(f"Leyendo {os.path.basename(XLSX)} …")
    df = pd.read_excel(XLSX, sheet_name=SHEET, header=9)
    df = df.dropna(subset=["IdPeaje", "FechaDesde"])
    df["IdPeaje"] = df["IdPeaje"].astype(int)
    df["ym"] = df["FechaDesde"].dt.to_period("M")
    return df


def main() -> None:
    df = load_detalle()
    print(f"  {len(df):,} registros de detalle, {df.Peaje.nunique()} estaciones")

    months = pd.period_range(df.ym.min(), df.ym.max(), freq="M")
    month_labels = [f"{MONTH_ABBR[p.month - 1]} {p.year}" for p in months]
    month_index = {str(p): i for i, p in enumerate(months)}
    n_months = len(months)

    # ── Serie mensual por peaje ────────────────────────────────────────────────
    agg = (
        df.groupby(["IdPeaje", "ym"])
        .agg(
            recaudo=("RecaudoTotal", "sum"),
            trafico=("TraficoTotal", "sum"),
            recaudo_evasores=("RecaudoEvasores", "sum"),
            trafico_evasores=("TraficoEvasores", "sum"),
            trafico_exentos=("TraficoExentos787", "sum"),
            peaje=("Peaje", "first"),
            departamento=("Departamento", "first"),
            municipio=("Municipio", "first"),
            divipola=("Divipola", "first"),
            proyecto=("Proyecto", "first"),
        )
        .reset_index()
    )

    # ── Metadatos por estación ────────────────────────────────────────────────
    meta_src = (
        df.sort_values("FechaDesde")
        .groupby("IdPeaje")
        .agg(
            nombre=("Peaje", "first"),
            departamento=("Departamento", "first"),
            municipio=("Municipio", "first"),
            divipola=("Divipola", "first"),
            proyecto=("Proyecto", "first"),
        )
        .reset_index()
    )
    proyectos_hist = df.groupby("IdPeaje")["Proyecto"].apply(lambda s: sorted(set(s.dropna())))

    rows_by_id: dict[int, np.ndarray] = {}
    traf_by_id: dict[int, np.ndarray] = {}
    for pid, sub in agg.groupby("IdPeaje"):
        rec = np.full(n_months, None, dtype=object)
        tra = np.full(n_months, None, dtype=object)
        for _, r in sub.iterrows():
            i = month_index[str(r["ym"])]
            rec[i] = int(r["recaudo"])
            tra[i] = int(r["trafico"])
        rows_by_id[int(pid)] = rec
        traf_by_id[int(pid)] = tra

    peajes = []
    for _, m in meta_src.sort_values("nombre").iterrows():
        pid = int(m["IdPeaje"])
        rec = rows_by_id[pid]
        tra = traf_by_id[pid]
        obs = [i for i, v in enumerate(rec) if v is not None]
        peajes.append(
            {
                "id": pid,
                "slug": f"{slug(m['nombre'])}-{pid}",
                "nombre": str(m["nombre"]).strip(),
                "departamento": str(m["departamento"]).strip(),
                "municipio": str(m["municipio"]).strip(),
                "divipola": int(m["divipola"]),
                "proyecto": str(m["proyecto"]).strip(),
                "proyectos": [str(p) for p in proyectos_hist.get(pid, [])],
                "primerMes": int(obs[0]) if obs else None,
                "ultimoMes": int(obs[-1]) if obs else None,
                "recaudo": [int(v) if v is not None else None for v in rec],
                "trafico": [int(v) if v is not None else None for v in tra],
            }
        )

    # ── Totales nacionales y por departamento ─────────────────────────────────
    tot_rec = np.zeros(n_months, dtype=np.int64)
    tot_tra = np.zeros(n_months, dtype=np.int64)
    for pid in rows_by_id:
        for i in range(n_months):
            v = rows_by_id[pid][i]
            if v is not None:
                tot_rec[i] += int(v)
            t = traf_by_id[pid][i]
            if t is not None:
                tot_tra[i] += int(t)

    deps = sorted({p["departamento"] for p in peajes})
    dep_index = {d: i for i, d in enumerate(deps)}
    dep_rec = np.zeros((len(deps), n_months), dtype=np.int64)
    dep_peajes = [[] for _ in deps]
    for p in peajes:
        j = dep_index[p["departamento"]]
        dep_peajes[j].append(p["id"])
        for i, v in enumerate(p["recaudo"]):
            if v is not None:
                dep_rec[j][i] += v

    # ── Tarifas medias ponderadas por mes (nacional) y por peaje ───────────────
    tarifa_nac = []
    for i, per in enumerate(months):
        sub = df[df.ym == per]
        tra = sub.TraficoTotal.sum()
        tarifa_nac.append(
            {
                "tarifaMedia": float(sub.RecaudoTotal.sum() / tra) if tra else None,
                "tarifaAutomovil": _weighted_tarifa(sub, ["I"]),
                "tarifaCamion": _weighted_tarifa(sub, ["III", "IV", "V", "VI", "VII"]),
            }
        )

    # ── Mix de categorías (últimos 12 meses) por peaje ────────────────────────
    ult12 = df[df.ym >= months[-12]]
    mix = (
        ult12.groupby(["IdPeaje", "IdCategoriaTarifa"])
        .TraficoTotal.sum()
        .reset_index()
        .sort_values("TraficoTotal", ascending=False)
    )
    mixes: dict[int, list] = {}
    for pid, sub in mix.groupby("IdPeaje"):
        total = sub.TraficoTotal.sum()
        if total <= 0:
            continue
        mixes[int(pid)] = [
            {
                "cat": str(r["IdCategoriaTarifa"]),
                "label": CATEGORIA_LABEL.get(str(r["IdCategoriaTarifa"]), str(r["IdCategoriaTarifa"])),
                "trafico": int(r["TraficoTotal"]),
                "share": round(float(r["TraficoTotal"]) / float(total), 4),
            }
            for _, r in sub.head(8).iterrows()
        ]
    for p in peajes:
        p["mix"] = mixes.get(p["id"], [])

    mix_nacional = (
        ult12.groupby("IdCategoriaTarifa")
        .agg(trafico=("TraficoTotal", "sum"), recaudo=("RecaudoTotal", "sum"))
        .reset_index()
        .sort_values("trafico", ascending=False)
    )
    tot_tra_12 = mix_nacional.trafico.sum()
    mix_nacional_out = [
        {
            "cat": str(r["IdCategoriaTarifa"]),
            "label": CATEGORIA_LABEL.get(str(r["IdCategoriaTarifa"]), str(r["IdCategoriaTarifa"])),
            "trafico": int(r["trafico"]),
            "share": round(float(r["trafico"]) / float(tot_tra_12), 4),
        }
        for _, r in mix_nacional.head(8).iterrows()
    ]

    payload = {
        "meta": {
            "titulo": "Tráfico y recaudo por estación de peaje · Colombia",
            "fuente": "Agencia Nacional de Infraestructura (ANI) — Operación Estadística de Tráfico y Recaudo modo carretero (OETR)",
            "archivo": os.path.basename(XLSX),
            "generado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "meses": month_labels,
            "mesesISO": [str(p) for p in months],
            "nPeajes": len(peajes),
            "nProyectos": int(df.Proyecto.nunique()),
            "nDepartamentos": len(deps),
            "primerMes": month_labels[0],
            "ultimoMes": month_labels[-1],
            "anioCorte": int(months[-1].year),
            "mesCorte": int(months[-1].month),
        },
        "totales": {"recaudo": [int(v) for v in tot_rec], "trafico": [int(v) for v in tot_tra]},
        "mixNacional": mix_nacional_out,
        "tarifas": tarifa_nac,
        "departamentos": [
            {
                "nombre": d,
                "recaudo": [int(v) for v in dep_rec[j]],
                "peajes": dep_peajes[j],
            }
            for j, d in enumerate(deps)
        ],
        "peajes": peajes,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(raw)

    # Copia como módulo JS: permite abrir web/index.html directamente (file://),
    # caso en el que fetch() de data.json está bloqueado por el navegador.
    OUT_JS = os.path.join(ROOT, "web", "js", "data.js")
    with open(OUT_JS, "w", encoding="utf-8") as fh:
        fh.write("/* Generado por tools/build_data.py — no editar a mano. */\n")
        fh.write("window.__TOLLCAST_DATA__ = ")
        fh.write(raw)
        fh.write(";\n")

    size_mb = os.path.getsize(OUT) / 1e6
    print(f"✔ {OUT}  ({size_mb:.2f} MB)")
    print(f"✔ {OUT_JS}  ({os.path.getsize(OUT_JS) / 1e6:.2f} MB)")
    print(f"  {len(peajes)} peajes · {n_months} meses · {len(deps)} departamentos")


def _weighted_tarifa(sub: pd.DataFrame, cats: list[str]):
    s = sub[sub.IdCategoriaTarifa.isin(cats)]
    tra = s.TraficoTotal.sum()
    if not tra:
        return None
    return float(s.RecaudoTotal.sum() / tra)


if __name__ == "__main__":
    main()
