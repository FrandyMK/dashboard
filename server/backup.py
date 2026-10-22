"""Make a safe snapshot of the live database. Run inside the container."""
import os
import sqlite3
from datetime import datetime
from pathlib import Path

DB_PATH = Path(os.environ.get("DASHBOARD_DB", "dashboard.db"))
BACKUP_DIR = DB_PATH.parent / "backups"
KEEP = 14


def main():
    BACKUP_DIR.mkdir(exist_ok=True)
    target = BACKUP_DIR / f"dashboard-{datetime.now():%Y-%m-%d_%H%M}.db"

    source = sqlite3.connect(DB_PATH)
    dest = sqlite3.connect(target)
    source.backup(dest)  # consistent copy, even while the API is writing

    result = dest.execute("PRAGMA integrity_check").fetchone()[0]
    dest.close()
    source.close()
    if result != "ok":
        target.unlink()
        raise SystemExit(f"Backup failed integrity check: {result}")

    # Keep only the newest KEEP snapshots.
    snapshots = sorted(BACKUP_DIR.glob("dashboard-*.db"))
    for old in snapshots[:-KEEP]:
        old.unlink()

    print(f"Backed up to {target}")


if __name__ == "__main__":
    main()
