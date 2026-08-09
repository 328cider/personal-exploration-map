"""Declared Android capability profiles used by every benchmark result."""

from .contracts import CaptureCapabilityProfile


IMU6 = CaptureCapabilityProfile(
    name="imu6",
    required_sensor_types=frozenset(
        {"TYPE_ACCELEROMETER", "TYPE_GYROSCOPE"}
    ),
    optional_sensor_types=frozenset(
        {"TYPE_ACCELEROMETER_UNCALIBRATED", "TYPE_GYROSCOPE_UNCALIBRATED"}
    ),
    target_rates_hz={"TYPE_ACCELEROMETER": 100.0, "TYPE_GYROSCOPE": 100.0},
)

PLATFORM_FUSED = CaptureCapabilityProfile(
    name="platform-fused",
    required_sensor_types=IMU6.required_sensor_types,
    optional_sensor_types=IMU6.optional_sensor_types
    | frozenset(
        {
            "TYPE_ROTATION_VECTOR",
            "TYPE_GAME_ROTATION_VECTOR",
            "TYPE_GRAVITY",
            "TYPE_LINEAR_ACCELERATION",
            "TYPE_MAGNETIC_FIELD",
            "TYPE_MAGNETIC_FIELD_UNCALIBRATED",
        }
    ),
    target_rates_hz={
        **IMU6.target_rates_hz,
        "TYPE_ROTATION_VECTOR": 50.0,
        "TYPE_GAME_ROTATION_VECTOR": 50.0,
        "TYPE_MAGNETIC_FIELD": 25.0,
    },
)

STEP_ENABLED = CaptureCapabilityProfile(
    name="step-enabled",
    required_sensor_types=IMU6.required_sensor_types,
    optional_sensor_types=PLATFORM_FUSED.optional_sensor_types
    | frozenset({"TYPE_STEP_DETECTOR", "TYPE_STEP_COUNTER"}),
    target_rates_hz=PLATFORM_FUSED.target_rates_hz,
    permissions=frozenset({"android.permission.ACTIVITY_RECOGNITION"}),
)

ENRICHED = CaptureCapabilityProfile(
    name="enriched-with-pressure/GNSS",
    required_sensor_types=IMU6.required_sensor_types,
    optional_sensor_types=STEP_ENABLED.optional_sensor_types
    | frozenset({"TYPE_PRESSURE", "LOCATION"}),
    target_rates_hz={**STEP_ENABLED.target_rates_hz, "TYPE_PRESSURE": 5.0, "LOCATION": 1.0},
    permissions=STEP_ENABLED.permissions
    | frozenset(
        {
            "android.permission.ACCESS_FINE_LOCATION",
            "android.permission.FOREGROUND_SERVICE_LOCATION",
        }
    ),
)

PROFILES = {profile.name: profile for profile in (IMU6, PLATFORM_FUSED, STEP_ENABLED, ENRICHED)}
