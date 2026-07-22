#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path


def digest_text(text):
 return "sha256:" + hashlib.sha256(text.encode()).hexdigest()


def parse_args(argv):
 parser = argparse.ArgumentParser(description="validate the release 2.5.0 canonical plan/spec pair")
 parser.add_argument("positional", nargs="*", help="legacy positional PLAN SPEC")
 parser.add_argument("--strict-lkv-amendment", dest="strict_lkv_amendment")
 parser.add_argument("--plan")
 parser.add_argument("--spec")
 args = parser.parse_args(argv)
 if args.strict_lkv_amendment:
  if args.positional or not args.plan or not args.spec:
   parser.error("--strict-lkv-amendment requires --plan and --spec, with no positional PLAN SPEC")
  return Path(args.plan), Path(args.spec), Path(args.strict_lkv_amendment)
 if len(args.positional) != 2 or args.plan or args.spec:
  parser.error("usage: validate_release_250_plan.py PLAN SPEC")
 return Path(args.positional[0]), Path(args.positional[1]), None


def read_pair(plan, spec):
 texts = []
 for p in (plan, spec):
  if not p.exists() or p.stat().st_size < 100000:
   raise SystemExit(f"canonical artifact incomplete: {p}")
  texts.append(p.read_text())
 return texts


def validate_canonical(plan_text, spec_text):
 for i in range(1, 94):
  goal = f"G{i:02d}"
  if goal not in plan_text or goal not in spec_text:
   raise SystemExit(f"missing {goal}")
 if len(re.findall(r"^### G\d{2} —", plan_text, re.M)) != 93:
  raise SystemExit("plan must contain exactly 93 canonical cards")
 if "G01_SELECTED_GREEN" not in plan_text or "G01_LANDED_UNSEALED" not in spec_text:
  raise SystemExit("bootstrap partition missing")
 if "bootstrap-lineage.json` is absent" not in plan_text:
  raise SystemExit("early lineage exclusion missing")


def require(condition, message):
 if not condition:
  raise SystemExit(message)


def validate_strict_lkv_amendment(amendment_path, plan_path, spec_path, plan_text, spec_text):
 expected = Path("docs/releases/2.5.0/amendments/G05-STRICT-LKV.json")
 require(amendment_path == expected, f"strict LKV amendment must use literal path {expected}")
 require(amendment_path.exists(), f"missing strict LKV amendment artifact: {amendment_path}")
 amendment = json.loads(amendment_path.read_text())

 require(amendment.get("schemaVersion") == 1, "G05 amendment schemaVersion must be 1")
 require(amendment.get("release") == "2.5.0", "G05 amendment release must be 2.5.0")
 require(amendment.get("goal") == "G05", "G05 amendment goal must be G05")
 require(amendment.get("status") == "APPROVED_AMENDMENT", "G05 amendment status must be APPROVED_AMENDMENT")
 require(amendment.get("selectedMechanism") == "external-auth-gate", "G05 amendment must select external-auth-gate")
 require(amendment.get("boundedReplayAccepted") is False, "bounded replay must remain rejected")
 require(amendment.get("successorStartAllowedBeforeGreenG05") is False, "G06/successor start before green G05 must be false")

 digests = amendment.get("canonicalDigests", {})
 require(digests.get("plan") == digest_text(plan_text), "G05 amendment plan digest is stale")
 require(digests.get("spec") == digest_text(spec_text), "G05 amendment spec digest is stale")

 approvals = amendment.get("approvals", [])
 require([a.get("role") for a in approvals] == ["Planner", "Architect", "Critic"], "approvals must be sequential Planner, Architect, Critic")
 require([a.get("verdict") for a in approvals] == ["APPROVE", "APPROVE", "APPROVE"], "all G05 amendment approvals must be APPROVE")

 invariants = amendment.get("invariants", {})
 expected_tokens = {
  "publicWssBoundary": "sole public WSS gate",
  "livekitInternalPort": "7880 internal",
  "guestIdentity": "account id/room-scoped guest UUID/IP ban-only",
  "gateCredential": "separate signed gate credential",
  "linearization": "PostgreSQL linearization with epoch/no positive cache",
  "availabilityPolicy": "security>availability",
  "revokeOrdering": "revoke commit before RemoveParticipant/success",
 }
 for key, phrase in expected_tokens.items():
  require(invariants.get(key) == phrase, f"missing invariant {key}: {phrase}")

 matrix = amendment.get("hostileTestMatrix", [])
 require(matrix == ["stolen-token", "restart", "partition", "clock-skew", "concurrent-mint-revoke", "leave", "ban", "explicit-revoke", "guest-ip-ban-only"], "G05 hostile test matrix must remain exact")

 required_text = [
  "external auth-gate",
  "sole public WSS gate",
  "7880 internal",
  "separate signed gate credential",
  "PostgreSQL linearization with epoch/no positive cache",
  "security>availability",
  "revoke commit before RemoveParticipant/success",
  "account id/room-scoped guest UUID/IP ban-only",
  "No G06 or affected successor may start before restarted G05 is green",
 ]
 combined = plan_text + "\n" + spec_text
 for token in required_text:
  require(token in combined, f"missing G05 amendment token in canonical docs: {token}")


def main(argv):
 plan, spec, amendment = parse_args(argv)
 plan_text, spec_text = read_pair(plan, spec)
 validate_canonical(plan_text, spec_text)
 if amendment:
  validate_strict_lkv_amendment(amendment, plan, spec, plan_text, spec_text)
  print("release 2.5.0 strict LKV amendment validation: PASS")
 else:
  print("release 2.5.0 canonical plan/spec validation: PASS (93 goals)")


if __name__ == "__main__":
 main(sys.argv[1:])
