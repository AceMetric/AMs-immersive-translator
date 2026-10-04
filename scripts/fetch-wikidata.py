"""Reuse verified source plans and install cleaned candidates; resume safely.
This command does not promote candidates or mark the collection goal complete.
"""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
collector = ROOT / "scripts/collect-glossary.py"
subprocess.run([sys.executable, str(collector)], cwd=ROOT, check=True)
for plan in ("branch-plan.json", "branch-plan-level2.json"):
    path = ROOT / "data/wikidata" / plan
    if path.exists():
        subprocess.run([sys.executable, str(collector), "--branch-plan", str(path), "--interval", "2"], cwd=ROOT, check=True)
environment_python = ROOT / ".venv-glossary" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
python = str(environment_python) if environment_python.exists() else sys.executable
probe = subprocess.run([python, "-c", "from opencc import OpenCC"], capture_output=True)
if probe.returncode:
    raise SystemExit("词库清洗需要 OpenCC。请先创建 .venv-glossary，并安装 scripts/requirements-glossary.txt；详见 docs/术语库收集报告.md。")
subprocess.run([python, "scripts/clean-glossary.py", "--install-packs"], cwd=ROOT, check=True)
