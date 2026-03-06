"""Databas för gravregister – mappkonfiguration och extramaterial."""
from pathlib import Path

from sqlalchemy import ForeignKey, UniqueConstraint, create_engine, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from app.config import PROJECT_ROOT

# SQLite-fil i projektroten
DB_PATH = PROJECT_ROOT / "gravregister.db"


class Base(DeclarativeBase):
    pass


class MappConfig(Base):
    """Konfiguration per källdata-mapp (kyrkogård, gravkvarter, försättssidor)."""
    __tablename__ = "mapp_config"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    namn: Mapped[str] = mapped_column(unique=True, index=True)  # mappens namn t.ex. "01 HKG 01-09"
    kyrkogard: Mapped[str] = mapped_column(nullable=True)  # HKG | HKN
    gravkvarter: Mapped[str] = mapped_column(nullable=True)  # t.ex. 1, U, A
    forsett_antal: Mapped[int] = mapped_column(default=0)  # 0, 1 eller 2

    extramaterial: Mapped[list["Extramaterial"]] = relationship(back_populates="mapp", cascade="all, delete-orphan")


class Extramaterial(Base):
    """PDF som är extramaterial – antingen kopplat till en gravplats eller endast till mappen."""
    __tablename__ = "extramaterial"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    mapp_id: Mapped[int] = mapped_column(ForeignKey("mapp_config.id"), nullable=False)
    filnamn: Mapped[str] = mapped_column(index=True)  # t.ex. "165.pdf"
    typ: Mapped[str | None] = mapped_column(nullable=True)  # valfri fritext, t.ex. lapp, brev, karta
    grav_start_sida: Mapped[int | None] = mapped_column(nullable=True)  # null = endast knutet till mappen (exkluderas från visning)
    redan_halva: Mapped[bool] = mapped_column(default=False)  # True = kort skannat som en halva, visas som en halva i gravplatsvy
    dold: Mapped[bool] = mapped_column(default=False)  # True = dölj från gravplatsbilderna, visas i sektion Dolda

    mapp: Mapped["MappConfig"] = relationship(back_populates="extramaterial")


class InfogadTomSida(Base):
    """Infogad tom sida efter en given PDF – för att hålla ordning när ett ark saknas."""
    __tablename__ = "infogad_tom_sida"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    mapp_id: Mapped[int] = mapped_column(ForeignKey("mapp_config.id"), nullable=False)
    efter_filnamn: Mapped[str] = mapped_column(index=True)  # PDF-filnamn efter vilken denna tomma sida infogas


class MappFilOrdning(Base):
    """Anpassad ordning för PDF-filer i en mapp (position 0 = första filen). Om inga rader finns används naturlig sortering."""
    __tablename__ = "mapp_fil_ordning"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    mapp_id: Mapped[int] = mapped_column(ForeignKey("mapp_config.id"), nullable=False)
    filnamn: Mapped[str] = mapped_column(index=True)
    position: Mapped[int] = mapped_column()  # 0-baserat


class MappSidaRedanHalva(Base):
    """Filer som är redan skannade som en halva – står kvar i flödet men visas som en halva (hela sidan = en bild)."""
    __tablename__ = "mapp_sida_redan_halva"
    __table_args__ = (UniqueConstraint("mapp_id", "filnamn", name="uq_redan_halva_mapp_fil"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    mapp_id: Mapped[int] = mapped_column(ForeignKey("mapp_config.id"), nullable=False)
    filnamn: Mapped[str] = mapped_column(index=True)


class Gravplats(Base):
    """Registrerad gravplats: kopplar en tre-sidors block (start_sida) till kyrkogård + kvarter + gravplatsnummer (t.ex. HKN Allm 1+2)."""
    __tablename__ = "gravplats"
    __table_args__ = (UniqueConstraint("mapp_id", "start_sida", name="uq_gravplats_mapp_start"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    mapp_id: Mapped[int] = mapped_column(ForeignKey("mapp_config.id"), nullable=False)
    kvarter: Mapped[str] = mapped_column()  # t.ex. Allm, 1, U
    gravplatsnummer: Mapped[str] = mapped_column()  # t.ex. 1+2, 5
    start_sida: Mapped[int] = mapped_column()  # 1-baserat innehållssida (första av de tre sidorna)
    kyrkogard: Mapped[str | None] = mapped_column(nullable=True)  # HKG | HKN, sparas vid registrering
    # Undantag för vilken grav en halva tillhör (vid felaktig skanningsordning):
    sida1_ovre_tillhor_denna: Mapped[bool] = mapped_column(default=False)  # Sida 1 övre tillhör denna grav (inte föregående)
    sida3_ovre_tillhor_nasta: Mapped[bool] = mapped_column(default=False)  # Sida 3 övre (gravsatta 6–10) tillhör nästa grav


class GravplatsDoldHalva(Base):
    """Halvor (vanliga gravplatsbilder) som användaren dolt – visas i sektion Dolda istället för i bildraden."""
    __tablename__ = "gravplats_dold_halva"
    __table_args__ = (UniqueConstraint("gravplats_id", "content_sida", "halva", name="uq_gravplats_dold_halva"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    gravplats_id: Mapped[int] = mapped_column(ForeignKey("gravplats.id"), nullable=False)
    content_sida: Mapped[int] = mapped_column()  # 1-baserat innehållssida
    halva: Mapped[str] = mapped_column()  # "nedre" | "ovre"


class GravplatsInnehavare(Base):
    """Gravrättsinnehavare – kan vara flera personer per gravplats."""
    __tablename__ = "gravplats_innehavare"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    gravplats_id: Mapped[int] = mapped_column(ForeignKey("gravplats.id"), nullable=False)
    sort_order: Mapped[int] = mapped_column(default=0)
    namn: Mapped[str] = mapped_column(default="")  # deprecated, använd fornamn+efternamn
    fornamn: Mapped[str] = mapped_column(default="")
    efternamn: Mapped[str] = mapped_column(default="")
    yrke: Mapped[str] = mapped_column(default="")
    adress: Mapped[str] = mapped_column(default="")


class GravplatsInmatning(Base):
    """Inmatad data för gravplatsen (underhåll, monument, övrigt, skiss) – 1:1 med Gravplats."""
    __tablename__ = "gravplats_inmatning"
    __table_args__ = (UniqueConstraint("gravplats_id", name="uq_inmatning_gravplats"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    gravplats_id: Mapped[int] = mapped_column(ForeignKey("gravplats.id"), nullable=False, unique=True)
    gravrattsinnehavare: Mapped[str] = mapped_column(default="")  # deprecated, använd gravplats_innehavare
    yrke: Mapped[str] = mapped_column(default="")
    adress: Mapped[str] = mapped_column(default="")
    storlek: Mapped[str] = mapped_column(default="")  # i Skiss-sektion
    underhall_text: Mapped[str] = mapped_column(default="")  # Underhåll inbetalt för alla framtid den
    underhall_overstruket: Mapped[bool] = mapped_column(default=False)  # "för all framtid" överstruket
    gravrattstid: Mapped[str] = mapped_column(default="")
    monument: Mapped[str] = mapped_column(default="")
    gravens_utformning: Mapped[str] = mapped_column(default="")
    gravplats_nr: Mapped[str] = mapped_column(default="")  # bottenkant
    karta_nr: Mapped[str] = mapped_column(default="")
    gravbrev_nr: Mapped[str] = mapped_column(default="")
    utfordat_den: Mapped[str] = mapped_column(default="")
    kommentar: Mapped[str] = mapped_column(default="")
    skiss_bild: Mapped[bytes | None] = mapped_column(nullable=True)  # PNG/JPEG blob
    fardigtranskriberad: Mapped[bool] = mapped_column(default=False)  # All info från bilderna har förts över


class GravplatsNarmastAnhorig(Base):
    """Närmast anhörig – kan vara flera personer per gravplats."""
    __tablename__ = "gravplats_narmast_anhorig"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    gravplats_id: Mapped[int] = mapped_column(ForeignKey("gravplats.id"), nullable=False)
    namn: Mapped[str] = mapped_column(default="")  # deprecated, använd fornamn+efternamn
    fornamn: Mapped[str] = mapped_column(default="")
    efternamn: Mapped[str] = mapped_column(default="")
    adress: Mapped[str] = mapped_column(default="")  # Gatuadress
    postnummer: Mapped[str] = mapped_column(default="")
    postort: Mapped[str] = mapped_column(default="")
    telefon: Mapped[str] = mapped_column(default="")
    sort_order: Mapped[int] = mapped_column(default=0)


class Gravsatt(Base):
    """Gravsatt person (position 1–10). Position 1 kan vara beteckning (t.ex. familjegrav) istället för person."""
    __tablename__ = "gravsatt"
    __table_args__ = (UniqueConstraint("gravplats_id", "position", name="uq_gravsatt_gravplats_pos"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    gravplats_id: Mapped[int] = mapped_column(ForeignKey("gravplats.id"), nullable=False)
    position: Mapped[int] = mapped_column()  # 1–10
    ar_beteckning: Mapped[bool] = mapped_column(default=False)  # True = t.ex. "Per Augusts familjegrav"
    namn: Mapped[str] = mapped_column(default="")  # deprecated, använd fornamn+efternamn
    fornamn: Mapped[str] = mapped_column(default="")
    efternamn: Mapped[str] = mapped_column(default="")
    adress: Mapped[str] = mapped_column(default="")
    fodelse_ar: Mapped[int | None] = mapped_column(nullable=True)
    fodelse_manad: Mapped[int | None] = mapped_column(nullable=True)
    fodelse_dag: Mapped[int | None] = mapped_column(nullable=True)
    fod_nr: Mapped[str] = mapped_column(default="")
    dods_ar: Mapped[int | None] = mapped_column(nullable=True)
    dods_manad: Mapped[int | None] = mapped_column(nullable=True)
    dods_dag: Mapped[int | None] = mapped_column(nullable=True)
    dodsbok_nr: Mapped[str] = mapped_column(default="")
    gravsatt_den: Mapped[str] = mapped_column(default="")
    urna: Mapped[str] = mapped_column(default="")


engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def init_db():
    """Skapa tabeller om de inte finns. Lägger till nya kolumner på gravplats vid behov."""
    Base.metadata.create_all(bind=engine)
    # Migration: lägg till halva-kopplingskolumner om de saknas (befintliga databaser)
    with engine.connect() as conn:
        r = conn.execute(text("PRAGMA table_info(gravplats)"))
        cols = [row[1] for row in r]
        for col, default in (("sida1_ovre_tillhor_denna", "0"), ("sida3_ovre_tillhor_nasta", "0")):
            if col not in cols:
                conn.execute(text(f"ALTER TABLE gravplats ADD COLUMN {col} INTEGER DEFAULT {default}"))
                conn.commit()
        # Migration: redan_halva på extramaterial
        r = conn.execute(text("PRAGMA table_info(extramaterial)"))
        cols = [row[1] for row in r]
        if "redan_halva" not in cols:
            conn.execute(text("ALTER TABLE extramaterial ADD COLUMN redan_halva INTEGER DEFAULT 0"))
            conn.commit()
        # Migration: adress, telefon, postnummer, postort på gravplats_narmast_anhorig
        try:
            r = conn.execute(text("PRAGMA table_info(gravplats_narmast_anhorig)"))
            cols_na = [row[1] for row in r]
            for col in ("adress", "telefon", "postnummer", "postort", "fornamn", "efternamn"):
                if col not in cols_na:
                    conn.execute(text(f"ALTER TABLE gravplats_narmast_anhorig ADD COLUMN {col} TEXT DEFAULT ''"))
                    conn.commit()
        except Exception:
            pass
        # Migration: fornamn, efternamn på gravplats_innehavare och gravsatt
        for table in ("gravplats_innehavare", "gravsatt"):
            try:
                r = conn.execute(text(f"PRAGMA table_info({table})"))
                cols_t = [row[1] for row in r]
                for col in ("fornamn", "efternamn"):
                    if col not in cols_t:
                        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} TEXT DEFAULT ''"))
                        conn.commit()
            except Exception:
                pass
        # Migration: fardigtranskriberad på gravplats_inmatning
        try:
            r = conn.execute(text("PRAGMA table_info(gravplats_inmatning)"))
            cols_inm = [row[1] for row in r]
            if "fardigtranskriberad" not in cols_inm:
                conn.execute(text("ALTER TABLE gravplats_inmatning ADD COLUMN fardigtranskriberad INTEGER DEFAULT 0"))
                conn.commit()
        except Exception:
            pass
        # Migration: dold på extramaterial
        try:
            r = conn.execute(text("PRAGMA table_info(extramaterial)"))
            cols_em = [row[1] for row in r]
            if "dold" not in cols_em:
                conn.execute(text("ALTER TABLE extramaterial ADD COLUMN dold INTEGER DEFAULT 0"))
                conn.commit()
        except Exception:
            pass
    # MappSidaRedanHalva skapas av create_all


def get_db():
    """Yield session; använd i dependencies vid behov."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
