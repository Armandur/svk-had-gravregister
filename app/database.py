"""Databas för gravregister – mappkonfiguration och extramaterial."""
from pathlib import Path

from sqlalchemy import ForeignKey, create_engine
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

    mapp: Mapped["MappConfig"] = relationship(back_populates="extramaterial")


engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def init_db():
    """Skapa tabeller om de inte finns."""
    Base.metadata.create_all(bind=engine)


def get_db():
    """Yield session; använd i dependencies vid behov."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
