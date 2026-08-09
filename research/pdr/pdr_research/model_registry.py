"""Load and validate public pretrained-model compatibility metadata."""

from __future__ import annotations

import json
from pathlib import Path

from .contracts import CompatibilityDecision, FieldRole, ModelCompatibilityReport


def load_model_registry(path: Path) -> tuple[ModelCompatibilityReport, ...]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return tuple(
        ModelCompatibilityReport(
            model=item["model"],
            version=item["version"],
            dataset=item["dataset"],
            required_inputs=tuple(item["required_inputs"]),
            required_rate_hz=float(item["required_rate_hz"]),
            preprocessing=tuple(item["preprocessing"]),
            training_targets=tuple(item["training_targets"]),
            live_output=bool(item["live_output"]),
            code_license=item["code_license"],
            weight_license=item["weight_license"],
            declared_decision=CompatibilityDecision(item["decision"]),
            decision_reasons=tuple(item["decision_reasons"]),
        )
        for item in payload["models"]
    )


def audit_model_registry(
    models: tuple[ModelCompatibilityReport, ...],
    adapter_roles: dict[str, dict[str, FieldRole]],
) -> tuple[str, ...]:
    errors: list[str] = []
    seen: set[tuple[str, str]] = set()
    for model in models:
        key = (model.model, model.version)
        if key in seen:
            errors.append(f"duplicate model/version: {key}")
        seen.add(key)
        if model.dataset not in adapter_roles:
            errors.append(f"{model.model}: unknown dataset {model.dataset}")
            continue
        roles = adapter_roles[model.dataset]
        unknown = sorted(set(model.required_inputs) - set(roles))
        if unknown:
            errors.append(f"{model.model}: unknown inputs {unknown}")
        leaked = sorted(
            field
            for field in model.required_inputs
            if roles.get(field) in {
                FieldRole.TRAINING_LABEL,
                FieldRole.EVALUATION_ONLY,
                FieldRole.FORBIDDEN,
            }
        )
        if leaked and model.declared_decision is CompatibilityDecision.PRODUCT_COMPATIBLE:
            errors.append(f"{model.model}: non-product inputs {leaked}")
        if model.required_rate_hz > 200:
            errors.append(f"{model.model}: rate above 200 Hz")
        if not model.decision_reasons:
            errors.append(f"{model.model}: missing decision reasons")
        if model.declared_decision is CompatibilityDecision.PRODUCT_COMPATIBLE:
            unresolved = ("unknown", "unclear", "research-only")
            if any(marker in model.weight_license.lower() for marker in unresolved):
                errors.append(f"{model.model}: product-compatible with unresolved weights")
            if model.required_rate_hz > 100:
                errors.append(f"{model.model}: product-compatible above target rate")
    return tuple(errors)
