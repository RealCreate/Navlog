#!/bin/bash
mkdir -p out
pip install -q playwright==1.47.0 >/dev/null 2>&1 && python3 -m playwright install --with-deps webkit >/dev/null 2>&1
python3 src/tools/wk.py > out/wk.txt 2>&1; cat out/wk.txt
