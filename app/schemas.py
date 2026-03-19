"""Pydantic-scheman (BaseModel-klasser) för API-endpoints."""
from pydantic import BaseModel


# ---------- Auth ----------

class LoginBody(BaseModel):
    username: str = ""
    password: str = ""


class MePreferencesBody(BaseModel):
    fun_enabled: bool | None = None
    toast_on_new_yrke: bool | None = None
    sound_on_new_yrke: bool | None = None
    inmatning_sections_order: list[str] | None = None


class MePasswordBody(BaseModel):
    current_password: str = ""
    new_password: str = ""


# ---------- Admin: användare ----------

class CreateUserBody(BaseModel):
    username: str = ""


class SetPasswordBody(BaseModel):
    password: str = ""


class SetUsernameBody(BaseModel):
    username: str = ""


class CreateUserWithPasswordBody(BaseModel):
    username: str = ""
    password: str = ""


class ClaudeAktivBody(BaseModel):
    aktiv: bool


class ClaudeBatchAktivBody(BaseModel):
    aktiv: bool


# ---------- Admin: achievements ----------

class AchievementNivaUpdateBody(BaseModel):
    achievement_key: str
    level: str  # bronze, silver, gold
    threshold: int
    label: str | None = None


class AchievementYrkesGruppBody(BaseModel):
    achievement_key: str
    yrken: list[str]


class ToastFormuleringUpdateBody(BaseModel):
    text: str


# ---------- Admin: kyrkogårdar ----------

class KyrkogardCreateBody(BaseModel):
    kod: str


# ---------- Inställningar / API-nycklar ----------

class ApiKeysBody(BaseModel):
    anthropic_api_key: str | None = None  # None = ej skickad (rör ej nyckeln), "" = ta bort
    claude_aktiv_instans: bool | None = None
    claude_batch_block_enskild: bool | None = None
    spara_redigeringslogg_snapshot: bool | None = None
    claude_model: str | None = None  # None = ej skickad, "" = återställ till default


# ---------- Mappkonfiguration och extramaterial ----------

class MappConfigSchema(BaseModel):
    kyrkogard: str | None = None
    gravkvarter: str | None = None
    forsett_antal: int = 0
    layout_typ: str | None = None  # standard_3_sidor | 1_sida_per_grav | 2_gravar_per_sida
    dela_sidor: str | None = None  # ingen | hojdled | breddled
    antal_delar_per_sida: int | None = None  # 1, 2, 3, …
    andelar: list[float] | None = None
    andelar_per_position: dict[str, list[float]] | None = None


class ExtramaterialSchema(BaseModel):
    filnamn: str
    typ: str | None = None  # valfri fritext
    grav_start_sida: int | None = None  # null = endast knutet till mappen
    redan_halva: bool = False  # True = kort redan skannat som en halva, visas som halva i gravplatsvy


class ExtramaterialPatchSchema(BaseModel):
    redan_halva: bool | None = None
    dold: bool | None = None
    kommentar: str | None = None


class SidaRedanHalvaSchema(BaseModel):
    filnamn: str
    redan_halva: bool  # True = visa sidan som en halva i flödet (hela sidan = en bild), ordningen behålls


class InfogaTomSidaSchema(BaseModel):
    efter_filnamn: str  # PDF-filnamn efter vilken tom sidan infogas


class FlyttaSidaSchema(BaseModel):
    filnamn: str
    riktning: str  # "vänster" | "höger" (eller "framåt" | "bakåt" för bakåtkompatibilitet)


# ---------- Gravplatsregistrering ----------

class GravplatsSchema(BaseModel):
    kvarter: str = ""
    gravplatsnummer: str = ""
    start_sida: int  # 1-baserat
    segment_index: int = 0  # vid 2_gravar_per_sida: 0 eller 1 på samma sida
    sida1_ovre_tillhor_denna: bool = False
    sida3_ovre_tillhor_nasta: bool = False


class DoldHalvaBody(BaseModel):
    content_sida: int
    segment_index: int | None = None  # 0, 1, …; om None används halva (nedre=0, ovre=1)
    halva: str | None = None  # "nedre" | "ovre" bakåtkompatibilitet


# ---------- Inmatning ----------

class InnehavareItem(BaseModel):
    fornamn: str = ""
    efternamn: str = ""
    yrke: str = ""
    gatuadress: str = ""
    postnummer: str = ""
    postort: str = ""
    kommentar: str = ""
    sort_order: int = 0


class NarmastAnhorigItem(BaseModel):
    id: int | None = None
    fornamn: str = ""
    efternamn: str = ""
    yrke: str = ""
    adress: str = ""  # Gatuadress
    postnummer: str = ""
    postort: str = ""
    telefon: str = ""
    kommentar: str = ""
    sort_order: int = 0


class GravsattItem(BaseModel):
    id: int | None = None
    position: int = 0  # 1-based, sätts från ordning i listan
    ar_beteckning: bool = False
    fornamn: str = ""
    efternamn: str = ""
    yrke: str = ""
    gatuadress: str = ""
    postnummer: str = ""
    postort: str = ""
    fodelse_ar: int | None = None
    fodelse_manad: int | None = None
    fodelse_dag: int | None = None
    fod_nr: str = ""
    dods_ar: int | None = None
    dods_manad: int | None = None
    dods_dag: int | None = None
    dodsbok_nr: str = ""
    gravsatt_den: str = ""
    urna: str = ""
    kommentar: str = ""


class InmatningSchema(BaseModel):
    innehavare: list[InnehavareItem] = []
    narmast_anhoriga: list[NarmastAnhorigItem] = []
    storlek: str = ""
    underhall_text: str = ""
    underhall_overstruket: bool = False
    gravrattstid: str = ""
    monument: str = ""
    gravens_utformning: str = ""
    karta_nr: str = ""
    gravbrev_nr: str = ""
    utfordat_den: str = ""
    kommentar: str = ""
    fardigtranskriberad: bool = False
    gravsatta: list[GravsattItem] = []
    skiss_bild_b64: str | None = None
    extramaterial_kommentarer: list[dict] = []  # [{"id": int, "kommentar": str}, ...]
    version: int | None = None  # Optimistic locking: skicka den version som laddades; 409 om någon annan sparade först


# ---------- Skisser ----------

class SkissCreateBody(BaseModel):
    source_type: str  # "halva" | "extramaterial"
    content_sida: int | None = None
    halva: str | None = None  # "nedre" | "ovre"
    segment_index: int | None = None  # 0, 1, … för att bygga rätt bild-URL (segment+position)
    position: int | None = None  # 1, 2, 3 för standard_3_sidor; används vid URL-byggnad i frontend
    extramaterial_id: int | None = None
    x: float = 0.0
    y: float = 0.0
    width: float = 0.0
    height: float = 0.0


class SkissOrdningBody(BaseModel):
    skiss_ids: list[int]  # ordning = index i listan


# ---------- Batch Claude ----------

class BatchJobbBody(BaseModel):
    namn: str = ""
    kyrkogard: str | None = None
    kvarter: str | None = None
    antal: int | None = None  # max antal gravplatser att inkludera (None = alla)
    ej_transkriberade: bool = True
    ej_claude_korda: bool = True
    tvinga_batch: bool = False  # om True: använd Anthropic Batch API oavsett antal
