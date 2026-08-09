"""Pure validation rules for the learned PDR training-data gate."""

from __future__ import annotations

from collections import Counter
from typing import Iterable


GATE_REQUIREMENTS = (
    "inference_inputs",
    "raw_semantics",
    "target_fitness",
    "rate_50_100_hz",
    "leakage_controls",
    "provenance",
    "rights",
    "deployment",
)
GATE_STATES = frozenset({"pass", "fail", "unknown"})
CLASSIFICATIONS = frozenset(
    {
        "product-training-compatible",
        "benchmark-only",
        "auxiliary-only",
        "reject-unresolved",
    }
)
INFERENCE_ROLES = frozenset({"live-input", "post-session-input"})
NON_INFERENCE_ROLES = frozenset(
    {"training-label", "evaluation-only", "forbidden"}
)


def computed_classification(candidate: dict[str, object]) -> str:
    """Compute the conservative classification from locked gate states.

    Unknown artifact rights override scientific utility.  A target-fitness
    failure with explicit rights is retained only for a narrower auxiliary task.
    Other fully-known failures are benchmark-only.
    """

    gate = candidate["gate"]
    if all(gate[name]["state"] == "pass" for name in GATE_REQUIREMENTS):
        return "product-training-compatible"
    if gate["rights"]["state"] == "unknown":
        return "reject-unresolved"
    if gate["target_fitness"]["state"] == "fail":
        return "auxiliary-only"
    return "benchmark-only"


def validate_candidate(candidate: dict[str, object]) -> list[str]:
    errors: list[str] = []
    candidate_id = candidate.get("id", "<missing>")
    gate = candidate.get("gate")
    if not isinstance(gate, dict):
        return [f"{candidate_id}: gate must be an object"]
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
        errors.append(f"{candidate_id}: fields must be non-empty")
        return errors
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
            errors.append(f"{candidate_id}: live field {name} lacks Android API mapping")
        if role in NON_INFERENCE_ROLES and field.get("android_api"):
            errors.append(f"{candidate_id}: non-inference field {name} has Android API mapping")

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

    if not candidate.get("group_split_keys"):
        errors.append(f"{candidate_id}: missing group split keys")
    if not candidate.get("primary_evidence"):
        errors.append(f"{candidate_id}: missing primary evidence")
    if not candidate.get("allowed_next_use"):
        errors.append(f"{candidate_id}: missing allowed-next-use boundary")
    return errors


def validate_manifest(manifest: dict[str, object]) -> list[str]:
    errors: list[str] = []
    if manifest.get("schema_version") != 1:
        errors.append("unexpected schema version")
    if manifest.get("raw_sensor_rows_downloaded") != 0:
        errors.append("metadata-only gate downloaded sensor rows")
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
    recorded = manifest.get("classification_counts")
    expected_counts = {name: counts.get(name, 0) for name in sorted(CLASSIFICATIONS)}
    if recorded != expected_counts:
        errors.append("classification counts do not match candidates")
    compatible = [
        candidate.get("id")
        for candidate in candidates
        if candidate.get("classification") == "product-training-compatible"
    ]
    if manifest.get("product_training_compatible_candidates") != compatible:
        errors.append("compatible candidate list does not match classifications")
    if not compatible and manifest.get("decision") != "stop-product-oriented-training":
        errors.append("zero compatible sources must stop product-oriented training")
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

