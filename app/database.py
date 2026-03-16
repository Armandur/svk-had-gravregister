"""Databas för gravregister – mappkonfiguration och extramaterial."""
from pathlib import Path

from sqlalchemy import ForeignKey, UniqueConstraint, create_engine, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from app.config import DATABASE_PATH, KYRKOGARDAR

# SQLite-fil – sätts via config (default gravregister.db i PROJECT_ROOT, eller DATABASE_PATH)
DB_PATH = DATABASE_PATH


class Base(DeclarativeBase):
    pass


class User(Base):
    """Användarkonto för inloggning. Admin kan skapa/återställa lösenord."""
    __tablename__ = "user"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(unique=True, index=True)
    password_hash: Mapped[str] = mapped_column()
    is_admin: Mapped[bool] = mapped_column(default=False)
    claude_aktiv: Mapped[bool] = mapped_column(default=True)  # om Claude-funktioner är aktiverade för användaren
    claude_batch_aktiv: Mapped[bool] = mapped_column(default=False)
    # JSON: t.ex. {"fun_enabled": true, "toast_on_new_yrke": true, "sound_on_new_yrke": true}
    preferences: Mapped[str | None] = mapped_column(nullable=True)


class Kyrkogard(Base):
    """Kyrkogårdar som visas i grunddatahantering (listvy). Användaren kan lägga till/ta bort via admin."""
    __tablename__ = "kyrkogard"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    kod: Mapped[str] = mapped_column(unique=True, index=True)  # t.ex. HKG, HKN


class MappConfig(Base):
    """Konfiguration per källdata-mapp (kyrkogård, gravkvarter, försättssidor, grunddata-layout)."""
    __tablename__ = "mapp_config"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    namn: Mapped[str] = mapped_column(unique=True, index=True)  # mappens namn t.ex. "01 HKG 01-09"
    kyrkogard: Mapped[str] = mapped_column(nullable=True)  # HKG | HKN
    gravkvarter: Mapped[str] = mapped_column(nullable=True)  # t.ex. 1, U, A
    forsett_antal: Mapped[int] = mapped_column(default=0)  # 0, 1 eller 2
    # Grunddataformat: standard_3_sidor | 1_sida_per_grav | 2_gravar_per_sida
    layout_typ: Mapped[str] = mapped_column(default="standard_3_sidor")
    # Dela sidor: ingen | hojdled | breddled
    dela_sidor: Mapped[str] = mapped_column(default="hojdled")
    # Antal delar per sida (1 = ingen delning, 2 = övre/nedre eller vänster/höger, osv.)
    antal_delar_per_sida: Mapped[int] = mapped_column(default=2)
    # Andelar som gränser mellan delar, JSON-array t.ex. "[0.455]" eller "[0.33,0.66]"
    andelar: Mapped[str | None] = mapped_column(nullable=True)  # null = använd default per layout
    # Per position (1,2,3) vid standard_3_sidor: JSON t.ex. {"1":[0.455],"2":[0.545],"3":[0.455]}
    andelar_per_position: Mapped[str | None] = mapped_column(nullable=True)

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
    kommentar: Mapped[str] = mapped_column(default="")  # titel/kommentar visas under extramaterialet på gravplatsen

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
    """Registrerad gravplats: kopplar block (start_sida, ev. segment_index) till kyrkogård + kvarter + gravplatsnummer."""
    __tablename__ = "gravplats"
    __table_args__ = (UniqueConstraint("mapp_id", "start_sida", "segment_index", name="uq_gravplats_mapp_start_segment"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    mapp_id: Mapped[int] = mapped_column(ForeignKey("mapp_config.id"), nullable=False)
    kvarter: Mapped[str] = mapped_column()  # t.ex. Allm, 1, U
    gravplatsnummer: Mapped[str] = mapped_column()  # t.ex. 1+2, 5
    start_sida: Mapped[int] = mapped_column()  # 1-baserat innehållssida
    segment_index: Mapped[int] = mapped_column(default=0)  # 0, 1, … vid 2_gravar_per_sida (samma sida, olika del)
    kyrkogard: Mapped[str | None] = mapped_column(nullable=True)  # HKG | HKN, sparas vid registrering
    # Undantag för vilken grav en del tillhör (standard_3_sidor; ignoreras vid andra layouttyper):
    sida1_ovre_tillhor_denna: Mapped[bool] = mapped_column(default=False)
    sida3_ovre_tillhor_nasta: Mapped[bool] = mapped_column(default=False)


class GravplatsDoldHalva(Base):
    """Delar (segment) som användaren dolt – visas i sektion Dolda. segment_index 0,1,… (halva behålls för bakåtkompatibilitet)."""
    __tablename__ = "gravplats_dold_halva"
    __table_args__ = (UniqueConstraint("gravplats_id", "content_sida", "segment_index", name="uq_gravplats_dold_halva"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    gravplats_id: Mapped[int] = mapped_column(ForeignKey("gravplats.id"), nullable=False)
    content_sida: Mapped[int] = mapped_column()  # 1-baserat innehållssida
    segment_index: Mapped[int] = mapped_column(default=0)  # 0 = första delen, 1 = andra, …
    halva: Mapped[str | None] = mapped_column(nullable=True)  # "nedre"|"ovre" bakåtkompatibilitet; segment_index gäller


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
    adress: Mapped[str] = mapped_column(default="")  # deprecated, migreras till gatuadress
    gatuadress: Mapped[str] = mapped_column(default="")
    postnummer: Mapped[str] = mapped_column(default="")
    postort: Mapped[str] = mapped_column(default="")
    kommentar: Mapped[str] = mapped_column(default="")


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
    version: Mapped[int] = mapped_column(default=0)  # Optimistic locking: ökas vid varje uppdatering
    last_edited_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    last_edited_at: Mapped[str | None] = mapped_column(nullable=True)  # ISO 8601 datetime (UTC)
    # För full historik se GravplatsRedigeringslogg.


class GravplatsRedigeringslogg(Base):
    """Logg över varje sparande av gravplatsinmatning – kronologisk historik för admin."""
    __tablename__ = "gravplats_redigeringslogg"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    gravplats_id: Mapped[int] = mapped_column(ForeignKey("gravplats.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    edited_at: Mapped[str] = mapped_column()  # ISO 8601 datetime (UTC)


class ClaudeAnropslogg(Base):
    """Logg över varje anrop till Claude OCR – tokens och beräknad kostnad."""
    __tablename__ = "claude_anropslogg"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    gravplats_id: Mapped[int | None] = mapped_column(ForeignKey("gravplats.id"), nullable=True)
    anropad_den: Mapped[str] = mapped_column()           # ISO 8601 datetime (UTC)
    input_tokens: Mapped[int] = mapped_column(default=0)
    output_tokens: Mapped[int] = mapped_column(default=0)
    cache_creation_tokens: Mapped[int] = mapped_column(default=0)
    cache_read_tokens: Mapped[int] = mapped_column(default=0)
    kostnad_usd: Mapped[float] = mapped_column(default=0.0)  # beräknad kostnad i USD
    svarstid_ms: Mapped[int | None] = mapped_column(nullable=True)  # ms från anrop till svar


class ClaudeOcrSvar(Base):
    """Senaste sparade Claude OCR-svar per gravplats – ett svar per gravplats (upsert)."""
    __tablename__ = "claude_ocr_svar"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    gravplats_id: Mapped[int] = mapped_column(ForeignKey("gravplats.id"), nullable=False, unique=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    skapad_den: Mapped[str] = mapped_column()           # ISO 8601 datetime (UTC)
    svar_json: Mapped[str] = mapped_column()            # JSON-sträng (utan _ocr_usage)
    ocr_kommentar: Mapped[str] = mapped_column(default="")


class ClaudeBatchJobb(Base):
    """Batch-jobb för att köra Claude OCR på flera gravplatser."""
    __tablename__ = "claude_batch_jobb"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    namn: Mapped[str] = mapped_column(default="")
    skapad_den: Mapped[str] = mapped_column()  # ISO 8601 UTC
    status: Mapped[str] = mapped_column(default="klar")  # klar | kör | pausad | avbruten | väntar_svar
    totalt: Mapped[int] = mapped_column(default=0)
    klara: Mapped[int] = mapped_column(default=0)
    fel: Mapped[int] = mapped_column(default=0)
    filter_json: Mapped[str | None] = mapped_column(nullable=True)  # JSON: {"kyrkogard": ..., "kvarter": ..., "ej_transkriberade": true, ...}
    jobb_typ: Mapped[str] = mapped_column(default="realtid")  # "realtid" | "anthropic_batch"
    anthropic_batch_id: Mapped[str | None] = mapped_column(nullable=True)  # Batch-ID från Anthropics Batch API


class ClaudeBatchJobbPost(Base):
    """Enskild gravplats i ett batch-jobb."""
    __tablename__ = "claude_batch_jobb_post"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    jobb_id: Mapped[int] = mapped_column(ForeignKey("claude_batch_jobb.id"), nullable=False)
    gravplats_id: Mapped[int] = mapped_column(ForeignKey("gravplats.id"), nullable=False)
    ordning: Mapped[int] = mapped_column(default=0)
    status: Mapped[str] = mapped_column(default="väntar")  # väntar | klar | fel | hoppad
    fel_meddelande: Mapped[str | None] = mapped_column(nullable=True)


class GravplatsSkiss(Base):
    """En skiss = en rektangelmarkering på en av gravplatsens bilder (segment eller extramaterial)."""
    __tablename__ = "gravplats_skiss"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    gravplats_id: Mapped[int] = mapped_column(ForeignKey("gravplats.id"), nullable=False)
    source_type: Mapped[str] = mapped_column()  # "halva" | "extramaterial"
    content_sida: Mapped[int | None] = mapped_column(nullable=True)  # för halva: 1-baserat innehållssida
    segment_index: Mapped[int | None] = mapped_column(nullable=True)  # 0, 1, … för segment
    halva: Mapped[str | None] = mapped_column(nullable=True)  # "nedre" | "ovre" bakåtkompatibilitet
    extramaterial_id: Mapped[int | None] = mapped_column(ForeignKey("extramaterial.id"), nullable=True)  # för extramaterial
    x: Mapped[float] = mapped_column()  # 0–1, andel av bildbredd
    y: Mapped[float] = mapped_column()  # 0–1, andel av bildhöjd
    width: Mapped[float] = mapped_column()  # 0–1
    height: Mapped[float] = mapped_column()  # 0–1
    sort_order: Mapped[int] = mapped_column(default=0)


class GravplatsNarmastAnhorig(Base):
    """Närmast anhörig – kan vara flera personer per gravplats."""
    __tablename__ = "gravplats_narmast_anhorig"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    gravplats_id: Mapped[int] = mapped_column(ForeignKey("gravplats.id"), nullable=False)
    namn: Mapped[str] = mapped_column(default="")  # deprecated, använd fornamn+efternamn
    fornamn: Mapped[str] = mapped_column(default="")
    efternamn: Mapped[str] = mapped_column(default="")
    yrke: Mapped[str] = mapped_column(default="")
    adress: Mapped[str] = mapped_column(default="")  # Gatuadress
    postnummer: Mapped[str] = mapped_column(default="")
    postort: Mapped[str] = mapped_column(default="")
    telefon: Mapped[str] = mapped_column(default="")
    sort_order: Mapped[int] = mapped_column(default=0)
    kommentar: Mapped[str] = mapped_column(default="")


class Gravsatt(Base):
    """Gravsatt person (position 1–10). Vilken position som helst kan vara beteckning (t.ex. familjegrav) istället för person."""
    __tablename__ = "gravsatt"
    __table_args__ = (UniqueConstraint("gravplats_id", "position", name="uq_gravsatt_gravplats_pos"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    gravplats_id: Mapped[int] = mapped_column(ForeignKey("gravplats.id"), nullable=False)
    position: Mapped[int] = mapped_column()  # 1–10
    ar_beteckning: Mapped[bool] = mapped_column(default=False)  # True = t.ex. "Per Augusts familjegrav"
    namn: Mapped[str] = mapped_column(default="")  # deprecated, använd fornamn+efternamn
    fornamn: Mapped[str] = mapped_column(default="")
    efternamn: Mapped[str] = mapped_column(default="")
    yrke: Mapped[str] = mapped_column(default="")
    adress: Mapped[str] = mapped_column(default="")  # deprecated, migreras till gatuadress
    gatuadress: Mapped[str] = mapped_column(default="")
    postnummer: Mapped[str] = mapped_column(default="")
    postort: Mapped[str] = mapped_column(default="")
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
    kommentar: Mapped[str] = mapped_column(default="")


class AchievementNiva(Base):
    """Gränsvärden för prestationsnivåer (brons/silver/guld). Admin kan justera."""
    __tablename__ = "achievement_niva"
    __table_args__ = (UniqueConstraint("achievement_key", "level", name="uq_achievement_niva_key_level"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    achievement_key: Mapped[str] = mapped_column(index=True)  # t.ex. registreringar, innehavare, gravsatta
    level: Mapped[str] = mapped_column()  # bronze, silver, gold
    threshold: Mapped[int] = mapped_column()  # min antal för denna nivå
    label: Mapped[str | None] = mapped_column(nullable=True)  # valfri beskrivning t.ex. "10 st"


class AchievementYrkesGrupp(Base):
    """Vilka yrken som räknas in i en viss yrkesbaserad prestationsnyckel."""
    __tablename__ = "achievement_yrkes_grupp"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    achievement_key: Mapped[str] = mapped_column(index=True)
    yrke: Mapped[str] = mapped_column(index=True)


engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def init_db():
    """Skapa tabeller om de inte finns. Lägger till nya kolumner på gravplats vid behov."""
    Base.metadata.create_all(bind=engine)

    # Seed kyrkogårdar från config om tabellen är tom (behåll befintliga i databasen)
    with SessionLocal() as db:
        try:
            existing = {r.kod for r in db.query(Kyrkogard).all()}
            for kod in KYRKOGARDAR:
                k = (kod or "").strip()
                if k and k not in existing:
                    db.add(Kyrkogard(kod=k))
                    existing.add(k)
            db.commit()
        except Exception:
            db.rollback()

    # Seed achievement-nivåer om tabellen är tom (grundvärden baserade på typisk databasstorlek)
    with SessionLocal() as db:
        try:
            if db.query(AchievementNiva).count() == 0:
                defaults = [
                    ("registreringar", "bronze", 10, "10 sparade"),
                    ("registreringar", "silver", 100, "100 sparade"),
                    ("registreringar", "gold", 500, "500 sparade"),
                    ("fardigtranskriberade", "bronze", 10, "10 färdiga"),
                    ("fardigtranskriberade", "silver", 100, "100 färdiga"),
                    ("fardigtranskriberade", "gold", 400, "400 färdiga"),
                    ("innehavare", "bronze", 10, "10 innehavare"),
                    ("innehavare", "silver", 100, "100 innehavare"),
                    ("innehavare", "gold", 400, "400 innehavare"),
                    ("narmast_anhoriga", "bronze", 5, "5 närmast anhöriga"),
                    ("narmast_anhoriga", "silver", 25, "25 närmast anhöriga"),
                    ("narmast_anhoriga", "gold", 75, "75 närmast anhöriga"),
                    ("gravsatta", "bronze", 25, "25 gravsatta"),
                    ("gravsatta", "silver", 200, "200 gravsatta"),
                    ("gravsatta", "gold", 500, "500 gravsatta"),
                    ("skisser", "bronze", 5, "5 skisser"),
                    ("skisser", "silver", 50, "50 skisser"),
                    ("skisser", "gold", 150, "150 skisser"),
                    ("unika_yrken", "bronze", 5, "5 unika yrken"),
                    ("unika_yrken", "silver", 50, "50 unika yrken"),
                    ("unika_yrken", "gold", 150, "150 unika yrken"),
                    ("storgravar", "bronze", 1, "1 storgrav"),
                    ("storgravar", "silver", 10, "10 storgravar"),
                    ("storgravar", "gold", 50, "50 storgravar"),
                    # Yrkesbaserade achievements – grundnivåer
                    ("yrke_kyrkans_man", "bronze", 5, "5 kyrkliga yrken"),
                    ("yrke_kyrkans_man", "silver", 10, "10 kyrkliga yrken"),
                    ("yrke_kyrkans_man", "gold", 20, "20 kyrkliga yrken"),
                    ("yrke_havets_man", "bronze", 5, "5 sjöfolk/lotser"),
                    ("yrke_havets_man", "silver", 10, "10 sjöfolk/lotser"),
                    ("yrke_havets_man", "gold", 20, "20 sjöfolk/lotser"),
                    ("yrke_handelns_furste", "bronze", 5, "5 handelsyrken"),
                    ("yrke_handelns_furste", "silver", 10, "10 handelsyrken"),
                    ("yrke_handelns_furste", "gold", 20, "20 handelsyrken"),
                    ("yrke_fabrikens_herre", "bronze", 3, "3 bruk/fabrik-yrken"),
                    ("yrke_fabrikens_herre", "silver", 6, "6 bruk/fabrik-yrken"),
                    ("yrke_fabrikens_herre", "gold", 10, "10 bruk/fabrik-yrken"),
                    ("yrke_hantverkets_mastare", "bronze", 5, "5 hantverksyrken"),
                    ("yrke_hantverkets_mastare", "silver", 10, "10 hantverksyrken"),
                    ("yrke_hantverkets_mastare", "gold", 20, "20 hantverksyrken"),
                    ("yrke_lardomens_vaktare", "bronze", 3, "3 lärar-/skolyrken"),
                    ("yrke_lardomens_vaktare", "silver", 6, "6 lärar-/skolyrken"),
                    ("yrke_lardomens_vaktare", "gold", 10, "10 lärar-/skolyrken"),
                    ("yrke_lag_och_ordning", "bronze", 3, "3 lag/ordning-yrken"),
                    ("yrke_lag_och_ordning", "silver", 6, "6 lag/ordning-yrken"),
                    ("yrke_lag_och_ordning", "gold", 10, "10 lag/ordning-yrken"),
                    ("yrke_fruar_mamseller", "bronze", 5, "5 fruar/mamseller"),
                    ("yrke_fruar_mamseller", "silver", 10, "10 fruar/mamseller"),
                    ("yrke_fruar_mamseller", "gold", 20, "20 fruar/mamseller"),
                    ("yrke_jord_och_gard", "bronze", 5, "5 jord/gårds-yrken"),
                    ("yrke_jord_och_gard", "silver", 10, "10 jord/gårds-yrken"),
                    ("yrke_jord_och_gard", "gold", 20, "20 jord/gårds-yrken"),
                ]
                for key, level, threshold, label in defaults:
                    db.add(AchievementNiva(achievement_key=key, level=level, threshold=threshold, label=label))
                db.commit()
        except Exception:
            db.rollback()

    # Seed yrkesgrupper för achievements om tabellen är tom
    with SessionLocal() as db:
        try:
            if db.query(AchievementYrkesGrupp).count() == 0:
                yrkes_defaults: dict[str, list[str]] = {
                    "yrke_kyrkans_man": [
                        "Biskop",
                        "Biskopinnan",
                        "f. Biskopen",
                        "Kyrkoherde",
                        "Komminister",
                        "Domkyrkoorganist",
                        "Prosten",
                        "Konsistorieamanuensen",
                        "Konsistorienotarie",
                        "Pastor",
                        "Hospitalsöfverläkaren",
                    ],
                    "yrke_havets_man": [
                        "Sjökapten",
                        "Sjökaptenen",
                        "f. Sjökaptenen",
                        "f.d. Sjökaptenen",
                        "Styrman",
                        "Styrmannen",
                        "f. Styrmannen",
                        "fd Styrmannen",
                        "Ångbåtsbefälhavaren",
                        "Ångbåtsbefälhavafen",
                        "Ångbåtskommissionären",
                        "Kronolotsen",
                        "Lotsen",
                        "Överlotsen",
                        "Skepparen",
                        "Skeppsbyggaren",
                        "Skeppsbyggmästaren",
                        "Skeppsklarerare",
                        "Skeppsklareraren",
                    ],
                    "yrke_handelns_furste": [
                        "Handlanden",
                        "Handlaren",
                        "Handl",
                        "Handl.",
                        "Handelsagenten",
                        "Handelsbiträdet",
                        "Handelsbokhållaren",
                        "Handelsidkerskan",
                        "Handelsresanden",
                        "grossh.",
                        "Grosshandl.",
                        "Grosshandlare",
                        "Grosshandlare Konsul",
                        "Grosshandlaren",
                        "köpman",
                        "Köpmannen",
                        "Trävaruhandlare",
                        "Trävaruhandlaren",
                        "Tobakshandl.",
                        "Järnhandlaren",
                        "Skohandlaren",
                    ],
                    "yrke_fabrikens_herre": [
                        "Brukspatronen",
                        "f.d. Bruksförvaltaren",
                        "Fabrikör",
                        "Fabrikören",
                        "Verkmästaren",
                        "f Verkmästeren",
                        "Maskinist",
                        "Maskinisten",
                        "fd Maskinisten",
                    ],
                    "yrke_hantverkets_mastare": [
                        "Bagaren",
                        "Bagarmästaren",
                        "Bryggaren",
                        "Bleckslagaren",
                        "Garvaren",
                        "Glasmästaren",
                        "Kopparslagaren",
                        "Smed",
                        "Smeden",
                        "Smidesmästaren",
                        "Murarmästaren",
                        "Målaren",
                        "Målarmästaren",
                        "Målaränkan",
                        "Skomakaren",
                        "Skomakarmästaren",
                        "Snickaren",
                        "Tenngjutaren",
                        "Tunnbindaren",
                        "Repslagaren",
                        "Svarfvaren",
                        "Järnsvarfaren",
                        "Sotarmästaren",
                        "Timmermannen",
                    ],
                    "yrke_lardomens_vaktare": [
                        "Folkskolläraren",
                        "Gymnastikläraren",
                        "Lektor",
                        "Lektoren",
                        "Lektorskan",
                        "Sem. adj.",
                        "Seminareieadj.",
                        "Seminarieadj.",
                        "Seminarielärare",
                        "Seminarierektor",
                        "Magistern",
                        "Rektor",
                    ],
                    "yrke_lag_och_ordning": [
                        "Rådman",
                        "Rådmannen",
                        "Lagmannen",
                        "vice Häradshövding",
                        "Häradsskrivaren",
                        "Stadsfiskalen",
                        "Poliskonstapeln",
                        "Polisöferkonstapen",
                        "Tullbevakningschef",
                        "Tullvaktmästaren",
                    ],
                    "yrke_fruar_mamseller": [
                        "Fru",
                        "Fröken",
                        "Mamsell",
                        "Mademamsellerna",
                        "Änkan",
                        "Änkefru",
                        "Jungfru",
                        "Makan",
                    ],
                    "yrke_jord_och_gard": [
                        "Hemmansägaren",
                        "fd Hemmansägaren",
                        "Jordägaren",
                        "Jordägren",
                        "Gårdsägaren",
                        "Passessionaten",
                        "Lantbrukaren",
                    ],
                }
                for key, yrken in yrkes_defaults.items():
                    for yrke in yrken:
                        db.add(AchievementYrkesGrupp(achievement_key=key, yrke=yrke))
                db.commit()
        except Exception:
            db.rollback()

    # Migration: lägg till Storgravar-nivåer om de saknas (befintliga databaser)
    with SessionLocal() as db:
        try:
            has_storgravar = db.query(AchievementNiva).filter(AchievementNiva.achievement_key == "storgravar").first() is not None
            if not has_storgravar:
                for key, level, threshold, label in [
                    ("storgravar", "bronze", 1, "1 storgrav"),
                    ("storgravar", "silver", 10, "10 storgravar"),
                    ("storgravar", "gold", 50, "50 storgravar"),
                ]:
                    db.add(AchievementNiva(achievement_key=key, level=level, threshold=threshold, label=label))
                db.commit()
            # Migration: lägg till yrkesgruppstabellens standardvärden om tabellen är tom (befintliga databaser)
            if db.query(AchievementYrkesGrupp).count() == 0:
                yrkes_defaults_migration: dict[str, list[str]] = {
                    "yrke_kyrkans_man": [
                        "Biskop",
                        "Biskopinnan",
                        "f. Biskopen",
                        "Kyrkoherde",
                        "Komminister",
                        "Domkyrkoorganist",
                        "Prosten",
                        "Konsistorieamanuensen",
                        "Konsistorienotarie",
                        "Pastor",
                        "Hospitalsöfverläkaren",
                    ],
                    "yrke_havets_man": [
                        "Sjökapten",
                        "Sjökaptenen",
                        "f. Sjökaptenen",
                        "f.d. Sjökaptenen",
                        "Styrman",
                        "Styrmannen",
                        "f. Styrmannen",
                        "fd Styrmannen",
                        "Ångbåtsbefälhavaren",
                        "Ångbåtsbefälhavafen",
                        "Ångbåtskommissionären",
                        "Kronolotsen",
                        "Lotsen",
                        "Överlotsen",
                        "Skepparen",
                        "Skeppsbyggaren",
                        "Skeppsbyggmästaren",
                        "Skeppsklarerare",
                        "Skeppsklareraren",
                    ],
                    "yrke_handelns_furste": [
                        "Handlanden",
                        "Handlaren",
                        "Handl",
                        "Handl.",
                        "Handelsagenten",
                        "Handelsbiträdet",
                        "Handelsbokhållaren",
                        "Handelsidkerskan",
                        "Handelsresanden",
                        "grossh.",
                        "Grosshandl.",
                        "Grosshandlare",
                        "Grosshandlare Konsul",
                        "Grosshandlaren",
                        "köpman",
                        "Köpmannen",
                        "Trävaruhandlare",
                        "Trävaruhandlaren",
                        "Tobakshandl.",
                        "Järnhandlaren",
                        "Skohandlaren",
                    ],
                    "yrke_fabrikens_herre": [
                        "Brukspatronen",
                        "f.d. Bruksförvaltaren",
                        "Fabrikör",
                        "Fabrikören",
                        "Verkmästaren",
                        "f Verkmästeren",
                        "Maskinist",
                        "Maskinisten",
                        "fd Maskinisten",
                    ],
                    "yrke_hantverkets_mastare": [
                        "Bagaren",
                        "Bagarmästaren",
                        "Bryggaren",
                        "Bleckslagaren",
                        "Garvaren",
                        "Glasmästaren",
                        "Kopparslagaren",
                        "Smed",
                        "Smeden",
                        "Smidesmästaren",
                        "Murarmästaren",
                        "Målaren",
                        "Målarmästaren",
                        "Målaränkan",
                        "Skomakaren",
                        "Skomakarmästaren",
                        "Snickaren",
                        "Tenngjutaren",
                        "Tunnbindaren",
                        "Repslagaren",
                        "Svarfvaren",
                        "Järnsvarfaren",
                        "Sotarmästaren",
                        "Timmermannen",
                    ],
                    "yrke_lardomens_vaktare": [
                        "Folkskolläraren",
                        "Gymnastikläraren",
                        "Lektor",
                        "Lektoren",
                        "Lektorskan",
                        "Sem. adj.",
                        "Seminareieadj.",
                        "Seminarieadj.",
                        "Seminarielärare",
                        "Seminarierektor",
                        "Magistern",
                        "Rektor",
                    ],
                    "yrke_lag_och_ordning": [
                        "Rådman",
                        "Rådmannen",
                        "Lagmannen",
                        "vice Häradshövding",
                        "Häradsskrivaren",
                        "Stadsfiskalen",
                        "Poliskonstapeln",
                        "Polisöferkonstapen",
                        "Tullbevakningschef",
                        "Tullvaktmästaren",
                    ],
                    "yrke_fruar_mamseller": [
                        "Fru",
                        "Fröken",
                        "Mamsell",
                        "Mademamsellerna",
                        "Änkan",
                        "Änkefru",
                        "Jungfru",
                        "Makan",
                    ],
                    "yrke_jord_och_gard": [
                        "Hemmansägaren",
                        "fd Hemmansägaren",
                        "Jordägaren",
                        "Jordägren",
                        "Gårdsägaren",
                        "Passessionaten",
                        "Lantbrukaren",
                    ],
                }
                for key, yrken in yrkes_defaults_migration.items():
                    for yrke in yrken:
                        db.add(AchievementYrkesGrupp(achievement_key=key, yrke=yrke))
                db.commit()
            # Migration: lägg till yrkesbaserade achievements om de saknas (befintliga databaser)
            yrke_keys = [
                "yrke_kyrkans_man",
                "yrke_havets_man",
                "yrke_handelns_furste",
                "yrke_fabrikens_herre",
                "yrke_hantverkets_mastare",
                "yrke_lardomens_vaktare",
                "yrke_lag_och_ordning",
                "yrke_fruar_mamseller",
                "yrke_jord_och_gard",
            ]
            existing_keys = {
                r.achievement_key
                for r in db.query(AchievementNiva.achievement_key).filter(
                    AchievementNiva.achievement_key.in_(yrke_keys)
                ).distinct()
            }
            if existing_keys != set(yrke_keys):
                # Lägg endast till de som saknas; trösklar som i seeding ovan
                defaults_extra = [
                    ("yrke_kyrkans_man", "bronze", 5, "5 kyrkliga yrken"),
                    ("yrke_kyrkans_man", "silver", 10, "10 kyrkliga yrken"),
                    ("yrke_kyrkans_man", "gold", 20, "20 kyrkliga yrken"),
                    ("yrke_havets_man", "bronze", 5, "5 sjöfolk/lotser"),
                    ("yrke_havets_man", "silver", 10, "10 sjöfolk/lotser"),
                    ("yrke_havets_man", "gold", 20, "20 sjöfolk/lotser"),
                    ("yrke_handelns_furste", "bronze", 5, "5 handelsyrken"),
                    ("yrke_handelns_furste", "silver", 10, "10 handelsyrken"),
                    ("yrke_handelns_furste", "gold", 20, "20 handelsyrken"),
                    ("yrke_fabrikens_herre", "bronze", 3, "3 bruk/fabrik-yrken"),
                    ("yrke_fabrikens_herre", "silver", 6, "6 bruk/fabrik-yrken"),
                    ("yrke_fabrikens_herre", "gold", 10, "10 bruk/fabrik-yrken"),
                    ("yrke_hantverkets_mastare", "bronze", 5, "5 hantverksyrken"),
                    ("yrke_hantverkets_mastare", "silver", 10, "10 hantverksyrken"),
                    ("yrke_hantverkets_mastare", "gold", 20, "20 hantverksyrken"),
                    ("yrke_lardomens_vaktare", "bronze", 3, "3 lärar-/skolyrken"),
                    ("yrke_lardomens_vaktare", "silver", 6, "6 lärar-/skolyrken"),
                    ("yrke_lardomens_vaktare", "gold", 10, "10 lärar-/skolyrken"),
                    ("yrke_lag_och_ordning", "bronze", 3, "3 lag/ordning-yrken"),
                    ("yrke_lag_och_ordning", "silver", 6, "6 lag/ordning-yrken"),
                    ("yrke_lag_och_ordning", "gold", 10, "10 lag/ordning-yrken"),
                    ("yrke_fruar_mamseller", "bronze", 5, "5 fruar/mamseller"),
                    ("yrke_fruar_mamseller", "silver", 10, "10 fruar/mamseller"),
                    ("yrke_fruar_mamseller", "gold", 20, "20 fruar/mamseller"),
                    ("yrke_jord_och_gard", "bronze", 5, "5 jord/gårds-yrken"),
                    ("yrke_jord_och_gard", "silver", 10, "10 jord/gårds-yrken"),
                    ("yrke_jord_och_gard", "gold", 20, "20 jord/gårds-yrken"),
                ]
                for key, level, threshold, label in defaults_extra:
                    if key not in existing_keys:
                        db.add(AchievementNiva(achievement_key=key, level=level, threshold=threshold, label=label))
                db.commit()
        except Exception:
            db.rollback()

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
        # Migration: kommentar på gravsatt
        try:
            r = conn.execute(text("PRAGMA table_info(gravsatt)"))
            cols_gs = [row[1] for row in r]
            if "kommentar" not in cols_gs:
                conn.execute(text("ALTER TABLE gravsatt ADD COLUMN kommentar TEXT DEFAULT ''"))
                conn.commit()
            if "yrke" not in cols_gs:
                conn.execute(text("ALTER TABLE gravsatt ADD COLUMN yrke TEXT DEFAULT ''"))
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
            if "version" not in cols_inm:
                conn.execute(text("ALTER TABLE gravplats_inmatning ADD COLUMN version INTEGER DEFAULT 0"))
                conn.commit()
            if "last_edited_by_user_id" not in cols_inm:
                conn.execute(text("ALTER TABLE gravplats_inmatning ADD COLUMN last_edited_by_user_id INTEGER REFERENCES user(id)"))
                conn.commit()
            if "last_edited_at" not in cols_inm:
                conn.execute(text("ALTER TABLE gravplats_inmatning ADD COLUMN last_edited_at TEXT"))
                conn.commit()
        except Exception:
            pass
        # Migration: user preferences (achievements/fun)
        try:
            r = conn.execute(text("PRAGMA table_info(user)"))
            user_cols = [row[1] for row in r]
            if "preferences" not in user_cols:
                conn.execute(text("ALTER TABLE user ADD COLUMN preferences TEXT"))
                conn.commit()
        except Exception:
            pass
        # Migration: kommentar på gravplats_innehavare och gravplats_narmast_anhorig
        for tbl, col in (("gravplats_innehavare", "kommentar"), ("gravplats_narmast_anhorig", "kommentar")):
            try:
                r = conn.execute(text(f"PRAGMA table_info({tbl})"))
                cols_t = [row[1] for row in r]
                if col not in cols_t:
                    conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN {col} TEXT DEFAULT ''"))
                    conn.commit()
            except Exception:
                pass
        # Migration: yrke på gravplats_narmast_anhorig
        try:
            r = conn.execute(text("PRAGMA table_info(gravplats_narmast_anhorig)"))
            cols_na = [row[1] for row in r]
            if "yrke" not in cols_na:
                conn.execute(text("ALTER TABLE gravplats_narmast_anhorig ADD COLUMN yrke TEXT DEFAULT ''"))
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
            if "kommentar" not in cols_em:
                conn.execute(text("ALTER TABLE extramaterial ADD COLUMN kommentar TEXT DEFAULT ''"))
                conn.commit()
        except Exception:
            pass
        # Migration: gatuadress, postnummer, postort på gravplats_innehavare och gravsatt (adress -> gatuadress)
        for table in ("gravplats_innehavare", "gravsatt"):
            try:
                r = conn.execute(text(f"PRAGMA table_info({table})"))
                cols_t = [row[1] for row in r]
                for col in ("gatuadress", "postnummer", "postort"):
                    if col not in cols_t:
                        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} TEXT DEFAULT ''"))
                        conn.commit()
                # Migrera befintlig adress till gatuadress
                conn.execute(text(
                    f"UPDATE {table} SET gatuadress = adress WHERE (gatuadress IS NULL OR gatuadress = '') AND adress IS NOT NULL AND adress != ''"
                ))
                conn.commit()
            except Exception:
                pass
        # gravplats_skiss skapas av create_all (ny tabell)
    # MappSidaRedanHalva skapas av create_all

    # ---------- Migration: grunddata-layout (mapp_config) ----------
    with engine.connect() as conn:
        r = conn.execute(text("PRAGMA table_info(mapp_config)"))
        mapp_cols = [row[1] for row in r]
        for col, col_def in (
            ("layout_typ", "TEXT DEFAULT 'standard_3_sidor'"),
            ("dela_sidor", "TEXT DEFAULT 'hojdled'"),
            ("antal_delar_per_sida", "INTEGER DEFAULT 2"),
            ("andelar", "TEXT"),
            ("andelar_per_position", "TEXT"),
        ):
            if col not in mapp_cols:
                conn.execute(text(f"ALTER TABLE mapp_config ADD COLUMN {col} {col_def}"))
                conn.commit()

        # ---------- Migration: gravplats segment_index + ny unik (mapp_id, start_sida, segment_index) ----------
        r = conn.execute(text("PRAGMA table_info(gravplats)"))
        gp_cols = [row[1] for row in r]
        if "segment_index" not in gp_cols:
            conn.execute(text("PRAGMA foreign_keys = OFF"))
            conn.execute(text("""
                CREATE TABLE gravplats_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    mapp_id INTEGER NOT NULL REFERENCES mapp_config(id),
                    kvarter TEXT NOT NULL,
                    gravplatsnummer TEXT NOT NULL,
                    start_sida INTEGER NOT NULL,
                    segment_index INTEGER NOT NULL DEFAULT 0,
                    kyrkogard TEXT,
                    sida1_ovre_tillhor_denna INTEGER DEFAULT 0,
                    sida3_ovre_tillhor_nasta INTEGER DEFAULT 0,
                    UNIQUE(mapp_id, start_sida, segment_index)
                )
            """))
            conn.execute(text("""
                INSERT INTO gravplats_new (id, mapp_id, kvarter, gravplatsnummer, start_sida, segment_index, kyrkogard, sida1_ovre_tillhor_denna, sida3_ovre_tillhor_nasta)
                SELECT id, mapp_id, kvarter, gravplatsnummer, start_sida, 0, kyrkogard, sida1_ovre_tillhor_denna, sida3_ovre_tillhor_nasta FROM gravplats
            """))
            conn.execute(text("DROP TABLE gravplats"))
            conn.execute(text("ALTER TABLE gravplats_new RENAME TO gravplats"))
            conn.execute(text("PRAGMA foreign_keys = ON"))
            conn.commit()

        # ---------- Migration: gravplats_dold_halva segment_index + ny unik ----------
        r = conn.execute(text("PRAGMA table_info(gravplats_dold_halva)"))
        dold_cols = [row[1] for row in r]
        if "segment_index" not in dold_cols:
            conn.execute(text("PRAGMA foreign_keys = OFF"))
            conn.execute(text("""
                CREATE TABLE gravplats_dold_halva_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    gravplats_id INTEGER NOT NULL REFERENCES gravplats(id),
                    content_sida INTEGER NOT NULL,
                    segment_index INTEGER NOT NULL DEFAULT 0,
                    halva TEXT,
                    UNIQUE(gravplats_id, content_sida, segment_index)
                )
            """))
            conn.execute(text("""
                INSERT INTO gravplats_dold_halva_new (id, gravplats_id, content_sida, segment_index, halva)
                SELECT id, gravplats_id, content_sida, CASE WHEN halva = 'ovre' THEN 1 ELSE 0 END, halva FROM gravplats_dold_halva
            """))
            conn.execute(text("DROP TABLE gravplats_dold_halva"))
            conn.execute(text("ALTER TABLE gravplats_dold_halva_new RENAME TO gravplats_dold_halva"))
            conn.execute(text("PRAGMA foreign_keys = ON"))
            conn.commit()

        # segment_index på gravplats_skiss (valfritt)
        try:
            r = conn.execute(text("PRAGMA table_info(gravplats_skiss)"))
            skiss_cols = [row[1] for row in r]
            if "segment_index" not in skiss_cols:
                conn.execute(text("ALTER TABLE gravplats_skiss ADD COLUMN segment_index INTEGER"))
                conn.commit()
        except Exception:
            pass

        # ---------- Migration: claude_anropslogg svarstid_ms ----------
        r = conn.execute(text("PRAGMA table_info(claude_anropslogg)"))
        logg_cols = [row[1] for row in r]
        if "svarstid_ms" not in logg_cols:
            conn.execute(text("ALTER TABLE claude_anropslogg ADD COLUMN svarstid_ms INTEGER"))
            conn.commit()

        # ---------- Migration: user claude_aktiv ----------
        r = conn.execute(text("PRAGMA table_info(user)"))
        user_cols = [row[1] for row in r]
        if "claude_aktiv" not in user_cols:
            conn.execute(text("ALTER TABLE user ADD COLUMN claude_aktiv INTEGER NOT NULL DEFAULT 1"))
            conn.commit()

        # ---------- Migration: user claude_batch_aktiv ----------
        r = conn.execute(text("PRAGMA table_info(user)"))
        user_cols = [row[1] for row in r]
        if "claude_batch_aktiv" not in user_cols:
            conn.execute(text("ALTER TABLE user ADD COLUMN claude_batch_aktiv INTEGER NOT NULL DEFAULT 0"))
            conn.commit()

        # ---------- Migration: claude_batch_jobb_post fel_meddelande ----------
        r = conn.execute(text("PRAGMA table_info(claude_batch_jobb_post)"))
        post_cols = [row[1] for row in r]
        if "fel_meddelande" not in post_cols:
            conn.execute(text("ALTER TABLE claude_batch_jobb_post ADD COLUMN fel_meddelande TEXT"))
            conn.commit()

        # ---------- Migration: claude_batch_jobb jobb_typ + anthropic_batch_id ----------
        r = conn.execute(text("PRAGMA table_info(claude_batch_jobb)"))
        jobb_cols = [row[1] for row in r]
        if "jobb_typ" not in jobb_cols:
            conn.execute(text("ALTER TABLE claude_batch_jobb ADD COLUMN jobb_typ TEXT NOT NULL DEFAULT 'realtid'"))
            conn.commit()
        if "anthropic_batch_id" not in jobb_cols:
            conn.execute(text("ALTER TABLE claude_batch_jobb ADD COLUMN anthropic_batch_id TEXT"))
            conn.commit()


def get_db():
    """Yield session; använd i dependencies vid behov."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
