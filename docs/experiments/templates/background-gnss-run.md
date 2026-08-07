# Background GNSS Run

> Copy this file for each real-device run. Do not paste raw coordinates, map/session ids, map names, marker text, or screenshots containing identifiable places into a public Issue. Fields that identify local records may be kept only in the private working copy.

## Identity

- Run id:
- Date / local time:
- Tester:
- Git commit:
- APK / build artifact:
- PersonalMap id (private working copy only):
- ExplorationSession id (private working copy only):

## Device

- Manufacturer / model:
- Android version:
- OEM build:
- Battery saver: ON / OFF
- App battery setting: unrestricted / optimized / restricted
- Location setting:
- Network: online / offline
- Other navigation or logger app running:

## Condition

- [ ] Foreground, screen ON
- [ ] Background, screen OFF, phone in pocket
- [ ] Background with one marker interruption
- [ ] Notification return
- [ ] Process recreation / app relaunch
- [ ] Permission changed during run
- [ ] Recents dismissal
- [ ] Battery saver comparison

- Planned duration:
- Actual duration:
- Route description without exact address:
- Open sky / building edge / short indoor passage:
- Reference logger / route, if any:

## Battery

Battery is recorded manually in M0 to avoid adding a platform dependency before the sampling behavior is understood.

- Battery at start:
- Battery at end:
- Elapsed minutes:
- Percentage points per hour:
- Device temperature / unusual heat:
- Charging during run: yes / no

## Permission and lifecycle

- Foreground permission before start:
- Background permission before start:
- Number of permission prompts:
- Foreground service notification appeared:
- Notification remained visible:
- Notification returned to correct session:
- App was relaunched:
- Session recovered:
- OS / OEM intervention observed:

## Coordinate-free diagnostic summary

In a development build, open PersonalMap Review and press `座標なし集計を共有`.

The generated text intentionally excludes coordinates, map names, marker text, record ids, images, and absolute timestamps. Review the OS share sheet before sending it.

- [ ] Generated from the app
- [ ] Reviewed before sharing
- [ ] No identifying information added manually

Paste the aggregate text below when useful:

```text

```

## In-app diagnostic report

The shared aggregate can fill most values below. Keep the explicit checklist because battery, permissions, route recognizability, and user observation are not inferred from app diagnostics.

### Samples and quality

- Raw samples:
- Accepted samples:
- Rejected samples:
- Acceptance rate:
- Rejection reasons:
- Horizontal accuracy median / p95 / max:

### Continuity

- Sample gap median / p95 / max:
- Gaps >= 30 seconds:
- Gaps >= 60 seconds:
- Gaps >= 120 seconds:
- Callback batches:
- Failed callback batches:
- Received / persisted / duplicate samples:

### Lifecycle

- Provider start requested / started:
- App background transition:
- App foreground transition:
- Session recovery:
- Provider stop requested / stopped:
- Last error and relative offset:

### Interruption cost

- Marker inputs completed / cancelled:
- Marker input median / p95:
- Did the user need to check recording state? Why:

## Map review

- Route shape recognizable without basemap: yes / partly / no
- Start / end plausible:
- Missing section visible:
- False jump visible in derived route:
- Marker appears at intended part of route:
- Multiple sessions remain separate segments:
- Screenshot stored privately at:

## User observation

- Start-to-pocket felt clear:
- Walking attention was interrupted:
- Marker interaction felt acceptable:
- End / review flow was clear:
- What caused uncertainty or mistrust:

## Decision impact

- [ ] Go evidence
- [ ] Narrow evidence
- [ ] Stop / redesign evidence

Reason:

Follow-up Issue / change:
