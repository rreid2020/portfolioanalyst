"""ASGI entrypoint so the Streamlit app can run on Vercel or any ASGI server.

Local: uvicorn asgi:app --port 8501
"""
from pathlib import Path

import streamlit as st

import auth_config

# Sign-in settings come from environment variables (see auth_config.py); with
# none set, st.App falls back to .streamlit/secrets.toml if there is one.
app = st.App(Path(__file__).parent / "main.py", secrets=auth_config.streamlit_secrets())
