"""Each signed-in user's SnapTrade user, kept in the database so a brokerage stays connected.

The Streamlit app had no sign-in, so it kept the SnapTrade user in the session and in the page URL and
deleted it after loading. With sign-in, the user is saved here, keyed by the Clerk user id, and the
holdings can be refreshed on any later visit until the user disconnects. The SnapTrade user secret is
stored encrypted with brokerage_sync.seal_user (a key derived from SNAPTRADE_CONSUMER_KEY), so the
database alone can't be used to read anyone's brokerage.
"""
from datetime import datetime, timezone

import brokerage_sync
import db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


class BrokerageStore:
    def __init__(self, engine: db.Database, user_id: str):
        if not user_id:
            raise ValueError("A user id is required.")
        self.db = engine
        self.user_id = user_id

    def get(self):
        """{"user_id", "user_secret", "connected_at"} or None."""
        with self.db.connect() as conn:
            row = self.db.execute(
                conn, "SELECT sealed_user, created_at FROM brokerage_connections WHERE user_id = ?", (self.user_id,)
            ).fetchone()
        if not row:
            return None
        user = brokerage_sync.unseal_user(row[0], ttl=None)
        return {**user, "connected_at": row[1]} if user else None

    def save(self, user) -> None:
        now = _now()
        sealed = brokerage_sync.seal_user({"user_id": user["user_id"], "user_secret": user["user_secret"]})
        with self.db.connect() as conn:
            # The Next.js app creates the users row at sign-in; locally (SQLite) it may not exist yet.
            if not self.db.execute(conn, "SELECT id FROM users WHERE id = ?", (self.user_id,)).fetchone():
                self.db.execute(conn, "INSERT INTO users (id, created_at, last_seen_at) VALUES (?, ?, ?)", (self.user_id, now, now))
            self.db.execute(conn, "DELETE FROM brokerage_connections WHERE user_id = ?", (self.user_id,))
            self.db.execute(
                conn,
                "INSERT INTO brokerage_connections (user_id, snaptrade_user_id, sealed_user, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (self.user_id, user["user_id"], sealed, now, now),
            )

    def delete(self) -> None:
        with self.db.connect() as conn:
            self.db.execute(conn, "DELETE FROM brokerage_connections WHERE user_id = ?", (self.user_id,))
