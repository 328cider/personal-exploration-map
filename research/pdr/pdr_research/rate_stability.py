"""Truth-free ranking and validation gates for step-rate stability."""

from __future__ import annotations

from dataclasses import dataclass

from .step_detection import StepDetectionSummary


@dataclass(frozen=True)
class RatePairResult:
    config_id: str
    at_50_hz: StepDetectionSummary
    at_100_hz: StepDetectionSummary
    batch_invariant: bool

    @property
    def relative_count_disagreement(self) -> float:
        return relative_disagreement(
            float(self.at_50_hz.event_count), float(self.at_100_hz.event_count)
        )

    @property
    def relative_amplitude_score_disagreement(self) -> float:
        return relative_disagreement(
            self.at_50_hz.amplitude_quarter_power_sum,
            self.at_100_hz.amplitude_quarter_power_sum,
        )

    @property
    def eligible(self) -> bool:
        summaries = (self.at_50_hz, self.at_100_hz)
        return (
            self.batch_invariant
            and all(summary.event_count >= 20 for summary in summaries)
            and all(summary.future_sample_violations == 0 for summary in summaries)
            and all(
                summary.median_interval_s is not None
                and 0.25 <= summary.median_interval_s <= 1.25
                for summary in summaries
            )
        )


def relative_disagreement(left: float, right: float) -> float:
    denominator = max(abs(left), abs(right))
    return abs(left - right) / denominator if denominator else 0.0


def rank_development_pairs(
    pairs: tuple[RatePairResult, ...],
) -> tuple[RatePairResult, ...]:
    """Apply the preregistered truth-free deterministic ordering."""

    return tuple(
        sorted(
            pairs,
            key=lambda pair: (
                not pair.eligible,
                pair.relative_count_disagreement,
                pair.relative_amplitude_score_disagreement,
                pair.config_id,
            ),
        )
    )


def passes_validation_gate(pair: RatePairResult) -> bool:
    return (
        pair.eligible
        and pair.relative_count_disagreement <= 0.01
        and pair.relative_amplitude_score_disagreement <= 0.02
    )
