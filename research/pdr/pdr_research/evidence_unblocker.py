"""Pure validation rules for the PDR evidence-unblocker v2 audit."""

from __future__ import annotations

from collections import Counter
from typing import Iterable


GATE_REQUIREMENTS = (
    "android_inputs",
    "raw_semantics",
    "target_supervision",
    "rate_50_100_hz",
    "group_split",
    "provenance",
    "rights",
    "deployment",
)
GATE_STATES = frozenset({"pass", "fail", "unknown"})
TARGET_SCOPES = frozenset({"full-pdr", "distance-component"})
CLASSIFICATIONS = frozenset(
    {
        "product-training-compatible",
        "component-training-compatible",
        "product-input-benchmark-only",
        "reject-incompatible",
        "reject-unresolved",
    }
)
INFERENCE_ROLES = frozenset({"live-input", "post-session-input"})
NON_INFERENCE_ROLES = frozenset(
    {"training-label", "evaluation-only", "forbidden"}
)


def computed_classification(candidate: dict[str, object]) -> str:
    """Compute the locked, rights-first classification."""

    gate = candidate["gate"]
    if gate["rights"]["state"] == "unknown":
        return "reject-unresolved"
    if gate["android_inputs"]["state"] == "fail" or gate["raw_semantics"]["state"] == "fail":
        return "reject-incompatible"
    if all(gate[name]["state"] == "pass" for name in GATE_REQUIREMENTS):
        if candidate["target_scope"] == "full-pdr":
            return "product-training-compatible"
        return "component-training-compatible"
    return "product-input-benchmark-only"


def validate_candidate(candidate: dict[str, object]) -> list[str]:
    errors: list[str] = []
    candidate_id = str(candidate.get("id", "<missing>"))
    if candidate.get("target_scope") not in TARGET_SCOPES:
        errors.append(f"{candidate_id}: invalid target scope")

    gate = candidate.get("gate")
    if not isinstance(gate, dict):
        return errors + [f"{candidate_id}: gate must be an object"]
    if set(gate) != set(GATE_REQUIREMENTS):
        errors.append(f"{candidate_id}: gate requirements changed")
    for requirement in GATE_REQUIREMENTS:
        entry = gate.get(requirement)
        if not isinstance(entry, dict):
            errors.append(f"{candidate_id}: {requirement} must be an object")
            continue
        if entry.get("state") not in GATE_STATES:
            errors.append(f"{candidate_id}: invalid state for {requirement}")
        if not entry.get("evidence"):
            errors.append(f"{candidate_id}: missing evidence for {requirement}")

    classification = candidate.get("classification")
    if classification not in CLASSIFICATIONS:
        errors.append(f"{candidate_id}: invalid classification")
    elif classification != computed_classification(candidate):
        errors.append(f"{candidate_id}: classification does not match gate")

    fields = candidate.get("fields")
    if not isinstance(fields, list) or not fields:
        return errors + [f"{candidate_id}: fields must be non-empty"]
    by_name: dict[str, dict[str, object]] = {}
    for field in fields:
        if not isinstance(field, dict) or not field.get("name"):
            errors.append(f"{candidate_id}: malformed field")
            continue
        name = str(field["name"])
        if name in by_name:
            errors.append(f"{candidate_id}: duplicate field {name}")
        by_name[name] = field
        role = field.get("role")
        if role not in INFERENCE_ROLES | NON_INFERENCE_ROLES:
            errors.append(f"{candidate_id}: invalid role for {name}")
        if role in INFERENCE_ROLES and not field.get("android_api"):
            errors.append(f"{candidate_id}: inference field {name} lacks Android API")
        if role in NON_INFERENCE_ROLES and field.get("android_api") is not None:
            errors.append(f"{candidate_id}: non-inference field {name} has Android API")

    inference_features = candidate.get("inference_features")
    if not isinstance(inference_features, list):
        errors.append(f"{candidate_id}: inference_features must be a list")
    else:
        for name in inference_features:
            field = by_name.get(str(name))
            if field is None:
                errors.append(f"{candidate_id}: unknown inference feature {name}")
            elif field.get("role") not in INFERENCE_ROLES:
                errors.append(f"{candidate_id}: label leakage through {name}")

    for key in (
        "group_split_keys",
        "primary_evidence",
        "allowed_next_use",
        "blocked_actions",
    ):
        if not candidate.get(key):
            errors.append(f"{candidate_id}: missing {key}")
    return errors


def validate_manifest(manifest: dict[str, object]) -> list[str]:
    errors: list[str] = []
    if manifest.get("schema_version") != 1:
        errors.append("unexpected schema version")
    if manifest.get("raw_sensor_rows_downloaded") != 0:
        errors.append("metadata audit downloaded raw sensor rows")
    if manifest.get("model_weights_downloaded") != 0:
        errors.append("metadata audit downloaded model weights")
    candidates = manifest.get("candidates")
    if not isinstance(candidates, list):
        return errors + ["candidates must be a list"]
    ids = [candidate.get("id") for candidate in candidates if isinstance(candidate, dict)]
    if len(ids) != len(set(ids)):
        errors.append("candidate IDs are not unique")
    for candidate in candidates:
        if not isinstance(candidate, dict):
            errors.append("malformed candidate")
            continue
        errors.extend(validate_candidate(candidate))

    counts = Counter(
        candidate.get("classification")
        for candidate in candidates
        if isinstance(candidate, dict)
    )
    expected_counts = {name: counts.get(name, 0) for name in sorted(CLASSIFICATIONS)}
    if manifest.get("classification_counts") != expected_counts:
        errors.append("classification counts do not match candidates")
    training = [
        candidate.get("id")
        for candidate in candidates
        if candidate.get("classification")
        in {"product-training-compatible", "component-training-compatible"}
    ]
    benchmark = [
        candidate.get("id")
        for candidate in candidates
        if candidate.get("classification") == "product-input-benchmark-only"
    ]
    if manifest.get("training_compatible_candidates") != training:
        errors.append("training-compatible list does not match classifications")
    if manifest.get("benchmark_only_candidates") != benchmark:
        errors.append("benchmark-only list does not match classifications")
    if not training and manifest.get("training_decision") != "stop-product-oriented-training":
        errors.append("zero compatible training sources must preserve stop decision")
    if benchmark and manifest.get("next_action") != "preregister-classical-benchmark-only":
        errors.append("benchmark candidates require a bounded benchmark next action")
    return errors


def assert_no_label_leakage(
    candidate: dict[str, object], requested_fields: Iterable[str]
) -> None:
    by_name = {field["name"]: field for field in candidate["fields"]}
    for name in requested_fields:
        if name not in by_name:
            raise ValueError(f"Unknown field: {name}")
        role = by_name[name]["role"]
        if role not in INFERENCE_ROLES:
            raise ValueError(f"Field {name} has non-inference role {role}")
