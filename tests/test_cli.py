"""Kommandoradsverktyget app.cli."""
from app import cli
from app.auth import verify_password
from app.database import User


def test_slumpat_losenord_fungerar_vid_inloggning(logga_in, db, client, capsys):
    logga_in("glomsk")
    assert cli.main(["losenord", "glomsk", "--slumpa"]) == 0
    losen = capsys.readouterr().out.rsplit(" ", 1)[-1].strip()
    db.expire_all()
    assert verify_password(losen, db.query(User).filter(User.username == "glomsk").one().password_hash)
    assert client.post("/api/login", json={"username": "glomsk", "password": losen}).status_code == 200


def test_okant_konto_ger_felkod(capsys):
    assert cli.main(["losenord", "finns-inte", "--slumpa"]) == 1
    assert "finns inte" in capsys.readouterr().err


def test_lista_visar_flaggor(logga_in, capsys):
    logga_in("listad", lokal_ocr_aktiv=True)
    assert cli.main(["anvandare"]) == 0
    rad = next(r for r in capsys.readouterr().out.splitlines() if r.startswith("listad"))
    assert "lokal" in rad


def test_filter_lokal_visar_bara_konton_med_flaggan(logga_in, capsys):
    logga_in("med-lokal", lokal_ocr_aktiv=True)
    logga_in("utan-lokal", lokal_ocr_aktiv=False)
    assert cli.main(["anvandare", "--lokal"]) == 0
    namn = [r.split()[0] for r in capsys.readouterr().out.splitlines()]
    assert "med-lokal" in namn and "utan-lokal" not in namn
