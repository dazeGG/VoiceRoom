#!/usr/bin/env python3
import re,sys
from pathlib import Path
if len(sys.argv)!=3: raise SystemExit("usage: validate_release_250_plan.py PLAN SPEC")
plan,spec=map(Path,sys.argv[1:]); texts=[plan.read_text(),spec.read_text()]
for p in (plan,spec):
 if not p.exists() or p.stat().st_size<100000: raise SystemExit(f"canonical artifact incomplete: {p}")
for i in range(1,94):
 goal=f"G{i:02d}"
 if goal not in texts[0] or goal not in texts[1]: raise SystemExit(f"missing {goal}")
if len(re.findall(r"^### G\d{2} —",texts[0],re.M)) != 93: raise SystemExit("plan must contain exactly 93 canonical cards")
if "G01_SELECTED_GREEN" not in texts[0] or "G01_LANDED_UNSEALED" not in texts[1]: raise SystemExit("bootstrap partition missing")
if "bootstrap-lineage.json` is absent" not in texts[0]: raise SystemExit("early lineage exclusion missing")
print("release 2.5.0 canonical plan/spec validation: PASS (93 goals)")
