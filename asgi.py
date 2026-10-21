"""ASGI entrypoint so the Streamlit app can run on Vercel or any ASGI server.

Local: uvicorn asgi:app --port 8501
"""
from pathlib import Path

import streamlit as st

app = st.App(Path(__file__).parent / "main.py")
