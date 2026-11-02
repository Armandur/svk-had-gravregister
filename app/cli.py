"""Administration från kommandoraden, t.ex. via Unraids Docker -> Console.

    python -m app.cli anvandare                  lista konton
    python -m app.cli anvandare --lokal          bara konton med lokal modell (även --admin, --claude, --batch)
    python -m app.cli losenord <användarnamn>    sätt nytt lösenord (frågar två gånger)
    python -m app.cli losenord <namn> --slumpa   skapa ett slumpat lösenord och skriv ut det

Kommandot använder samma databas som appen (DATABASE_PATH i containerns miljö).
"""
import argparse
import getpass
import secrets
import sys

from app.auth import hash_password
from app.database import SessionLocal, User


FLAGGOR = {"admin": User.is_admin, "claude": User.claude_aktiv, "batch": User.claude_batch_aktiv,
           "lokal": User.lokal_ocr_aktiv}


def _lista(filter_: list[str]) -> int:
    with SessionLocal() as db:
        q = db.query(User).order_by(User.username)
        for namn in filter_:
            q = q.filter(FLAGGOR[namn] == True)  # noqa: E712
        konton = q.all()
        if not konton:
            print("Inga konton matchar." if filter_ else "Inga konton finns.")
        for u in konton:
            flaggor = [namn for namn, pa in (("admin", u.is_admin), ("claude", u.claude_aktiv),
                                              ("batch", u.claude_batch_aktiv), ("lokal", u.lokal_ocr_aktiv)) if pa]
            print(f"{u.username:24} {', '.join(flaggor)}")
    return 0


def _losenord(namn: str, slumpa: bool) -> int:
    with SessionLocal() as db:
        user = db.query(User).filter(User.username == namn).first()
        if user is None:
            print(f"Kontot {namn!r} finns inte. Se 'python -m app.cli anvandare'.", file=sys.stderr)
            return 1
        if slumpa:
            losen = secrets.token_urlsafe(12)
        else:
            losen = getpass.getpass("Nytt lösenord: ")
            if not losen:
                print("Inget lösenord angavs, inget ändrat.", file=sys.stderr)
                return 1
            if getpass.getpass("Upprepa: ") != losen:
                print("Lösenorden var olika, inget ändrat.", file=sys.stderr)
                return 1
        user.password_hash = hash_password(losen)
        db.commit()
    print(f"Lösenordet för {namn} är ändrat." + (f" Nytt lösenord: {losen}" if slumpa else ""))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.cli", description="Administration av gravregistret.")
    sub = ap.add_subparsers(dest="kommando", required=True)
    lista = sub.add_parser("anvandare", help="lista konton och deras flaggor")
    for namn in FLAGGOR:
        lista.add_argument(f"--{namn}", action="store_true", help=f"bara konton med flaggan {namn}")
    p = sub.add_parser("losenord", help="sätt nytt lösenord för ett konto")
    p.add_argument("anvandarnamn")
    p.add_argument("--slumpa", action="store_true", help="skapa ett slumpat lösenord och skriv ut det")
    a = ap.parse_args(argv)
    if a.kommando == "anvandare":
        return _lista([namn for namn in FLAGGOR if getattr(a, namn)])
    return _losenord(a.anvandarnamn, a.slumpa)


if __name__ == "__main__":
    sys.exit(main())
