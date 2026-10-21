"""Saved portfolios in Postgres (Neon on Vercel) or a local SQLite file.

Every read and write goes through Store, which is bound to one signed-in
user's id; a portfolio id from another user is treated as missing.
"""
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from sqlalchemy import (
    Column, DateTime, Float, ForeignKey, Integer, MetaData, String, Table, UniqueConstraint,
    create_engine, delete, func, insert, select, update,
)

from portfolio_import import COLUMNS

LOCAL_DB = Path(__file__).parent / ".data" / "portfolios.db"

metadata = MetaData()

users = Table(
    "users", metadata,
    Column("id", String(255), primary_key=True),  # the identity provider's subject (Clerk user id)
    Column("email", String(320)),
    Column("name", String(255)),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("last_seen_at", DateTime(timezone=True), nullable=False),
)

portfolios = Table(
    "portfolios", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", String(255), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
    Column("name", String(100), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("user_id", "name", name="uq_portfolio_user_name"),
)

holdings = Table(
    "holdings", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("portfolio_id", Integer, ForeignKey("portfolios.id", ondelete="CASCADE"), nullable=False, index=True),
    Column("position", Integer, nullable=False),
    Column("ticker", String(32), nullable=False),
    Column("shares", Float, nullable=False),
    Column("avg_price", Float),
    Column("currency", String(8)),
    Column("account", String(32)),
)


def database_url() -> str | None:
    """Neon's DATABASE_URL (or POSTGRES_URL) on Vercel; a local SQLite file elsewhere."""
    url = os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL")
    if url:
        # SQLAlchemy needs the driver named; Neon hands out postgres:// or postgresql:// URLs.
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix):]
        return url
    if os.getenv("VERCEL"):
        return None  # no local disk worth keeping on Vercel
    LOCAL_DB.parent.mkdir(exist_ok=True)
    return f"sqlite:///{LOCAL_DB}"


def make_engine(url: str):
    engine = create_engine(url, pool_pre_ping=True)
    metadata.create_all(engine)
    return engine


def _now():
    return datetime.now(timezone.utc)


def _clean(value):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    return value


class PortfolioNameError(ValueError):
    pass


class Store:
    """One user's saved portfolios."""

    def __init__(self, engine, user_id: str):
        if not user_id:
            raise ValueError("A user id is required.")
        self.engine = engine
        self.user_id = user_id

    def touch_user(self, email=None, name=None) -> None:
        """Create the user row on first sign-in; keep email, name and last seen current."""
        now = _now()
        with self.engine.begin() as conn:
            found = conn.execute(select(users.c.id).where(users.c.id == self.user_id)).first()
            if found:
                conn.execute(update(users).where(users.c.id == self.user_id).values(email=email, name=name, last_seen_at=now))
            else:
                conn.execute(insert(users).values(id=self.user_id, email=email, name=name, created_at=now, last_seen_at=now))

    def list(self) -> list:
        """[(id, name, updated_at)], most recently updated first."""
        query = (
            select(portfolios.c.id, portfolios.c.name, portfolios.c.updated_at)
            .where(portfolios.c.user_id == self.user_id)
            .order_by(portfolios.c.updated_at.desc(), portfolios.c.id.desc())
        )
        with self.engine.connect() as conn:
            return [tuple(r) for r in conn.execute(query)]

    def _owned(self, conn, portfolio_id: int):
        return conn.execute(
            select(portfolios.c.id).where(portfolios.c.id == portfolio_id, portfolios.c.user_id == self.user_id)
        ).first()

    def save(self, name: str, table: pd.DataFrame) -> tuple[int, bool]:
        """Save `table` (COLUMNS) under `name`, replacing a portfolio of that name. Returns (id, replaced)."""
        name = _valid_name(name)
        now = _now()
        rows = []
        for i, r in enumerate(table.to_dict("records")):
            ticker = str(_clean(r.get("Ticker")) or "").strip().upper()
            shares = _clean(r.get("Shares"))
            if not ticker or shares is None:
                continue
            rows.append({
                "position": i, "ticker": ticker, "shares": float(shares),
                "avg_price": None if _clean(r.get("Avg Buy Price")) is None else float(r["Avg Buy Price"]),
                "currency": (str(_clean(r.get("Currency")) or "").strip().upper() or None),
                "account": (str(_clean(r.get("Account")) or "").strip() or None),
            })
        with self.engine.begin() as conn:
            existing = conn.execute(
                select(portfolios.c.id).where(portfolios.c.user_id == self.user_id, portfolios.c.name == name)
            ).first()
            if existing:
                portfolio_id = existing.id
                conn.execute(update(portfolios).where(portfolios.c.id == portfolio_id).values(updated_at=now))
                conn.execute(delete(holdings).where(holdings.c.portfolio_id == portfolio_id))
            else:
                portfolio_id = conn.execute(
                    insert(portfolios).values(user_id=self.user_id, name=name, created_at=now, updated_at=now)
                ).inserted_primary_key[0]
            if rows:
                conn.execute(insert(holdings), [{**r, "portfolio_id": portfolio_id} for r in rows])
        return portfolio_id, bool(existing)

    def load(self, portfolio_id: int) -> pd.DataFrame | None:
        """The portfolio's holdings as a COLUMNS table, or None if it isn't this user's."""
        with self.engine.connect() as conn:
            if not self._owned(conn, portfolio_id):
                return None
            rows = conn.execute(
                select(holdings).where(holdings.c.portfolio_id == portfolio_id).order_by(holdings.c.position)
            ).mappings().all()
        return pd.DataFrame(
            [{"Ticker": r["ticker"], "Shares": r["shares"], "Avg Buy Price": r["avg_price"],
              "Currency": r["currency"] or "", "Account": r["account"] or ""} for r in rows],
            columns=COLUMNS,
        )

    def rename(self, portfolio_id: int, new_name: str) -> bool:
        new_name = _valid_name(new_name)
        with self.engine.begin() as conn:
            if not self._owned(conn, portfolio_id):
                return False
            clash = conn.execute(select(portfolios.c.id).where(
                portfolios.c.user_id == self.user_id, portfolios.c.name == new_name, portfolios.c.id != portfolio_id
            )).first()
            if clash:
                raise PortfolioNameError(f'You already have a portfolio named "{new_name}".')
            conn.execute(update(portfolios).where(portfolios.c.id == portfolio_id).values(name=new_name, updated_at=_now()))
        return True

    def delete(self, portfolio_id: int) -> bool:
        with self.engine.begin() as conn:
            if not self._owned(conn, portfolio_id):
                return False
            conn.execute(delete(holdings).where(holdings.c.portfolio_id == portfolio_id))
            conn.execute(delete(portfolios).where(portfolios.c.id == portfolio_id))
        return True

    def count(self) -> int:
        with self.engine.connect() as conn:
            return conn.execute(select(func.count()).select_from(portfolios).where(portfolios.c.user_id == self.user_id)).scalar_one()


def _valid_name(name: str) -> str:
    name = (name or "").strip()
    if not name:
        raise PortfolioNameError("Give the portfolio a name.")
    if len(name) > 100:
        raise PortfolioNameError("Portfolio names can be up to 100 characters.")
    return name
