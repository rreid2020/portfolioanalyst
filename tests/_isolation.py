"""Imported first by UI tests: point the app at a throwaway SQLite database."""
import atexit
import os
import shutil
import tempfile

_DIR = tempfile.mkdtemp(prefix="portfolio-tests-")
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(_DIR, "test.db").replace("\\", "/")
atexit.register(shutil.rmtree, _DIR, ignore_errors=True)
