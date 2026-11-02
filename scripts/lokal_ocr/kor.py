"""Kör gravkort-OCR mot lokala modeller (ollama via portalens växel) för utvärdering.

Väljer färdigtranskriberade gravar ur databasen, bygger samma bilder som
Claude får och sparar varje modellsvar som en rad i en JSONL-fil.
Poängsättningen mot facit görs av poang.py.

    DATA_DIR=/sökväg .venv/bin/python -m scripts.lokal_ocr.kor \\
        --modeller qwen2.5vl:7b gemma4:12b --antal 30 --ut svar.jsonl
"""
import argparse
import base64
import json
import random
import sys
import time
from pathlib import Path

import fitz
import httpx
from sqlalchemy import text

from app.database import SessionLocal
from app.services.ocr_service import OCR_INSTRUKTION, _load_spec
from app.utils.ocr_utils import _collect_png_images_for_gravplats

sys.path.insert(0, str(Path(__file__).parent))
from modelljobb import Jobb  # noqa: E402

PORTAL = "http://ubuntu-ai:8890"
MAX_SVAR = 6000  # tak för genererade tokens, så en modell som fastnar i en slinga inte låser GPU:n


def _aktiv_endpoint() -> str:
    return httpx.get(f"{PORTAL}/api/ollama/active", timeout=10).json()["url"]


def _valj_gravar(db, antal: int, seed: int, urval: str) -> list[int]:
    """urval: 'claude' = granskade med Claude-svar, 'manniska' = granskade utan, 'alla' = båda."""
    sql = "select i.gravplats_id from gravplats_inmatning i "
    if urval == "claude":
        sql += "join claude_ocr_svar c using(gravplats_id) "
    sql += "where i.fardigtranskriberad = 1 "
    if urval == "manniska":
        sql += "and i.gravplats_id not in (select gravplats_id from claude_ocr_svar) "
    sql += "order by i.gravplats_id"
    ids = [r[0] for r in db.execute(text(sql))]
    random.Random(seed).shuffle(ids)
    return sorted(ids[:antal])


def _skala(png: bytes, max_sida: int) -> bytes:
    pix = fitz.Pixmap(png)
    storst = max(pix.width, pix.height)
    if not max_sida or storst <= max_sida:
        return png
    f = max_sida / storst
    return fitz.Pixmap(pix, int(pix.width * f), int(pix.height * f), None).tobytes("png")


def _rensa_json(t: str) -> str:
    t = t.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    return t


def _chat(klient: httpx.Client, bas: str, kropp: dict) -> dict:
    r = klient.post(f"{bas}/api/chat", json=kropp)
    r.raise_for_status()
    return r.json()


def fraga_tvasteg(klient: httpx.Client, bas: str, modell: str, bilder: list[bytes], spec: str) -> dict:
    """modell = "ocrmodell+textmodell": läs text per bild, strukturera sedan texten till JSON."""
    ocr_modell, text_modell = modell.split("+", 1)
    t0 = time.monotonic()
    texter, prompt_tokens, svar_tokens = [], 0, 0
    for i, b in enumerate(bilder, 1):
        raw = _chat(klient, bas, {
            "model": ocr_modell, "stream": False, "keep_alive": -1, "options": {"temperature": 0, "num_predict": MAX_SVAR},
            "messages": [{"role": "user", "content": "Text Recognition:", "images": [base64.b64encode(b).decode()]}],
        })
        texter.append(f"--- Bild {i} ---\n{raw['message']['content']}")
        prompt_tokens += raw.get("prompt_eval_count") or 0
        svar_tokens += raw.get("eval_count") or 0
    raw = _chat(klient, bas, {
        "model": text_modell, "stream": False, "think": False, "keep_alive": -1, "format": "json",
        "options": {"temperature": 0, "num_predict": MAX_SVAR},
        "messages": [
            {"role": "system", "content": spec},
            {"role": "user", "content": "Bilderna är redan avlästa till text nedan. Kortets layout kan ha "
                                        "gått förlorad, så para ihop etiketter och värden med omdöme.\n\n"
                                        + "\n\n".join(texter) + "\n\n" + OCR_INSTRUKTION},
        ],
    })
    return {
        "text": raw["message"]["content"],
        "ocr_text": "\n\n".join(texter),
        "sek": round(time.monotonic() - t0, 1),
        "prompt_tokens": prompt_tokens + (raw.get("prompt_eval_count") or 0),
        "svar_tokens": svar_tokens + (raw.get("eval_count") or 0),
    }


def fraga(klient: httpx.Client, bas: str, modell: str, bilder: list[bytes], spec: str) -> dict:
    if "+" in modell:
        return fraga_tvasteg(klient, bas, modell, bilder, spec)
    kropp = {
        "model": modell,
        "stream": False,
        "think": False,
        "keep_alive": -1,
        "format": "json",
        "options": {"temperature": 0, "num_predict": MAX_SVAR},
        "messages": [
            {"role": "system", "content": spec},
            {
                "role": "user",
                "content": OCR_INSTRUKTION,
                "images": [base64.b64encode(b).decode() for b in bilder],
            },
        ],
    }
    t0 = time.monotonic()
    raw = _chat(klient, bas, kropp)
    return {
        "text": raw["message"]["content"],
        "sek": round(time.monotonic() - t0, 1),
        "prompt_tokens": raw.get("prompt_eval_count"),
        "svar_tokens": raw.get("eval_count"),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--modeller", nargs="+", required=True)
    ap.add_argument("--antal", type=int, default=30)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--max-sida", type=int, default=0, help="skala ner bilder, 0 = orört (200 dpi)")
    ap.add_argument("--urval", choices=["claude", "manniska", "alla"], default="claude",
                    help="claude = granskade med Claude-svar (default), manniska = bara mänskligt transkriberade")
    ap.add_argument("--ut", required=True)
    a = ap.parse_args()

    ut = Path(a.ut)
    klara = set()
    if ut.exists():
        for rad in ut.read_text().splitlines():
            d = json.loads(rad)
            klara.add((d["modell"], d["gravplats_id"], d["max_sida"]))

    bas = _aktiv_endpoint()
    spec = _load_spec()
    db = SessionLocal()
    ids = _valj_gravar(db, a.antal, a.seed, a.urval)
    bilder = {gid: [_skala(b, a.max_sida) for b in _collect_png_images_for_gravplats(gid, db)] for gid in ids}
    db.close()
    print(f"{len(ids)} gravar mot {bas}", flush=True)

    spar = {m: len(ids) for m in a.modeller}
    with Jobb(f"Gravregister: lokal OCR-utvärdering ({len(ids)} gravar)", spar,
              endpoint=bas, agare="svk-had-gravregister", prompt=OCR_INSTRUKTION) as jobb, \
            httpx.Client(timeout=900) as klient, ut.open("a") as f:
        for modell in a.modeller:
            gjorda = sum(1 for gid in ids if (modell, gid, a.max_sida) in klara)
            jobb.borjar(modell, redan_klara=gjorda)
            for gid in ids:
                if (modell, gid, a.max_sida) in klara:
                    continue
                jobb.anrop_borjar(modell, f"grav {gid}")
                rad = {"modell": modell, "gravplats_id": gid, "max_sida": a.max_sida}
                try:
                    svar = fraga(klient, bas, modell, bilder[gid], spec)
                    rad.update(svar)
                    try:
                        rad["json"] = json.loads(_rensa_json(svar["text"]))
                    except json.JSONDecodeError:
                        rad["json"] = None
                except httpx.HTTPError as e:
                    rad["fel"] = str(e)
                    jobb.fel(modell, f"grav {gid}: {e}")
                f.write(json.dumps(rad, ensure_ascii=False) + "\n")
                f.flush()
                jobb.klar_med(modell, f"grav {gid}")
                jobb.preview(modell, f"grav {gid}", svar=rad.get("text", rad.get("fel")), format="json")
                print(modell, gid, rad.get("sek"), rad.get("prompt_tokens"), "ok" if rad.get("json") else "FEL", flush=True)
            jobb.modell_klar(modell)


if __name__ == "__main__":
    main()
