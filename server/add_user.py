"""Add someone to the dashboard, with a starter gym plan.

On the homelab:
    docker compose exec api python add_user.py her@example.com "Her name"

The login must be exactly what Tailscale sends for that person
(see `tailscale whois <their device's Tailscale IP>`). New users get the gym
only; finance stays with the owner.
"""

import sys
from uuid import uuid4

from db import connect, init_db, seed_plan


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    login, name = sys.argv[1].strip(), sys.argv[2].strip()

    init_db()  # makes sure the tables exist; safe to run any time
    with connect() as conn:
        existing = conn.execute(
            "SELECT name FROM users WHERE tailscale_login = ?", (login,)
        ).fetchone()
        if existing:
            sys.exit(f"{login} already exists, as {existing['name']}")

        user_id = uuid4().hex
        conn.execute(
            "INSERT INTO users (id, name, tailscale_login) VALUES (?, ?, ?)",
            (user_id, name, login),
        )
        seed_plan(conn, user_id)

    print(f"Added {name} ({login}) with a starter gym plan.")


if __name__ == "__main__":
    main()
