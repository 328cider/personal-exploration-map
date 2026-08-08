#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  buildExploredSpaceGeometry,
  type ExploredSpaceBounds,
  type ExploredSpaceGeometry,
  type ExploredSpacePoint,
  type ExploredSpaceSegment,
  type MapDisplayMode,
} from "../apps/mobile/src/components/exploredSpaceGeometry.ts";

const PANEL_WIDTH = 390;
const PANEL_HEIGHT = 292;
const MAP_WIDTH = 350;
const MAP_HEIGHT = 214;
const OUTER_PADDING = 24;
const MODES: readonly MapDisplayMode[] = ["corridor", "cells", "track"];

interface Fixture {
  readonly id: string;
  readonly title: string;
  readonly question: string;
  readonly segments: readonly ExploredSpaceSegment[];
}

interface FixtureModeResult {
  readonly fixtureId: string;
  readonly fixtureTitle: string;
  readonly mode: MapDisplayMode;
  readonly pointCount: number;
  readonly renderedPointCount: number;
  readonly corridors: number;
  readonly cells: number;
  readonly cellSizeMeters: number | null;
  readonly maximumCellVisits: number;
}

function point(
  sampleId: string,
  xMeters: number,
  yMeters: number,
  options: {
    readonly accuracy?: number;
    readonly confidence?: number;
    readonly source?: string;
  } = {},
): ExploredSpacePoint {
  return {
    sampleId,
    xMeters,
    yMeters,
    confidence: options.confidence ?? 0.9,
    source: options.source ?? "gnss",
    ...(options.accuracy === undefined
      ? {}
      : { horizontalAccuracyMeters: options.accuracy }),
  };
}

function interpolatePolyline(
  idPrefix: string,
  vertices: readonly { readonly x: number; readonly y: number }[],
  spacingMeters: number,
  options: {
    readonly accuracy?: number;
    readonly confidence?: number;
  } = {},
): readonly ExploredSpacePoint[] {
  const output: ExploredSpacePoint[] = [];
  let sequence = 0;
  for (let edgeIndex = 0; edgeIndex < vertices.length - 1; edgeIndex += 1) {
    const start = vertices[edgeIndex]!;
    const end = vertices[edgeIndex + 1]!;
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(1, Math.ceil(distance / spacingMeters));
    for (let step = edgeIndex === 0 ? 0 : 1; step <= steps; step += 1) {
      const ratio = step / steps;
      output.push(
        point(
          `${idPrefix}-${sequence}`,
          start.x + (end.x - start.x) * ratio,
          start.y + (end.y - start.y) * ratio,
          options,
        ),
      );
      sequence += 1;
    }
  }
  return output;
}

function rectangleFixture(): Fixture {
  const points = interpolatePolyline(
    "rectangle",
    [
      { x: 0, y: 0 },
      { x: 90, y: 0 },
      { x: 90, y: 60 },
      { x: 0, y: 60 },
      { x: 0, y: 0 },
    ],
    10,
    { accuracy: 6 },
  );
  return {
    id: "rectangle-loop",
    title: "Rectangle loop",
    question: "Are four turns and start=end topology legible?",
    segments: [{ id: "rectangle-session", points }],
  };
}

function outAndBackFixture(): Fixture {
  const outbound = Array.from({ length: 11 }, (_, index) =>
    point(`out-${index}`, index * 10, 0, { accuracy: 7 }),
  );
  const inbound = Array.from({ length: 10 }, (_, index) =>
    point(`back-${index}`, 90 - index * 10, 1.5, {
      accuracy: 7,
      confidence: 0.86,
    }),
  );
  return {
    id: "out-and-back",
    title: "Out and back",
    question: "Does overlap read as revisiting rather than a wider road?",
    segments: [{ id: "out-and-back-session", points: [...outbound, ...inbound] }],
  };
}

function plazaSweepFixture(): Fixture {
  const vertices: { x: number; y: number }[] = [];
  for (let row = 0; row < 6; row += 1) {
    const y = row * 18;
    if (row % 2 === 0) {
      vertices.push({ x: 0, y }, { x: 110, y });
    } else {
      vertices.push({ x: 110, y }, { x: 0, y });
    }
  }
  return {
    id: "plaza-sweep",
    title: "Open-area sweep",
    question: "Does walking around a space become area rather than only lines?",
    segments: [
      {
        id: "plaza-session",
        points: interpolatePolyline("plaza", vertices, 9, { accuracy: 8 }),
      },
    ],
  };
}

function sparseMixedAccuracyFixture(): Fixture {
  return {
    id: "sparse-mixed-accuracy",
    title: "Sparse / mixed accuracy",
    question: "Is uncertainty visible without implying a confirmed boundary?",
    segments: [
      {
        id: "sparse-session",
        points: [
          point("sparse-0", 0, 0, { accuracy: 4, confidence: 0.95 }),
          point("sparse-1", 30, 4, { accuracy: 6, confidence: 0.9 }),
          point("sparse-2", 65, 22, { accuracy: 24, confidence: 0.62 }),
          point("sparse-3", 100, 18, { accuracy: 30, confidence: 0.48 }),
          point("sparse-4", 135, 45, { accuracy: 8, confidence: 0.88 }),
        ],
      },
    ],
  };
}

function separatedSessionsFixture(): Fixture {
  return {
    id: "separated-sessions",
    title: "Separated sessions",
    question: "Are independent sessions shown without a fake bridge?",
    segments: [
      {
        id: "west-session",
        points: interpolatePolyline(
          "west",
          [
            { x: 0, y: 0 },
            { x: 55, y: 0 },
            { x: 55, y: 30 },
          ],
          8,
          { accuracy: 6 },
        ),
      },
      {
        id: "east-session",
        points: interpolatePolyline(
          "east",
          [
            { x: 135, y: 75 },
            { x: 185, y: 75 },
            { x: 185, y: 110 },
          ],
          8,
          { accuracy: 6, confidence: 0.84 },
        ),
      },
    ],
  };
}

function overlappingSessionsFixture(): Fixture {
  const first = Array.from({ length: 13 }, (_, index) =>
    point(`visit-one-${index}`, index * 9, Math.sin(index / 2) * 2, {
      accuracy: 7,
      confidence: 0.9,
    }),
  );
  const second = Array.from({ length: 13 }, (_, index) =>
    point(`visit-two-${index}`, index * 9, 2 + Math.sin(index / 2) * 2, {
      accuracy: 7,
      confidence: 0.82,
    }),
  );
  return {
    id: "overlapping-sessions",
    title: "Revisited path",
    question: "Does a second observation strengthen evidence without being required?",
    segments: [
      { id: "visit-one", points: first },
      { id: "visit-two", points: second },
    ],
  };
}

const FIXTURES: readonly Fixture[] = [
  rectangleFixture(),
  outAndBackFixture(),
  plazaSweepFixture(),
  sparseMixedAccuracyFixture(),
  separatedSessionsFixture(),
  overlappingSessionsFixture(),
];

function boundsFor(segments: readonly ExploredSpaceSegment[]): ExploredSpaceBounds {
  const points = segments.flatMap((segment) => segment.points);
  const first = points[0];
  if (first === undefined) {
    throw new Error("Fixture must contain at least one point.");
  }
  return points.slice(1).reduce<ExploredSpaceBounds>(
    (bounds, item) => ({
      minX: Math.min(bounds.minX, item.xMeters),
      minY: Math.min(bounds.minY, item.yMeters),
      maxX: Math.max(bounds.maxX, item.xMeters),
      maxY: Math.max(bounds.maxY, item.yMeters),
    }),
    {
      minX: first.xMeters,
      minY: first.yMeters,
      maxX: first.xMeters,
      maxY: first.yMeters,
    },
  );
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function polylinePoints(points: readonly { readonly x: number; readonly y: number }[]): string {
  return points.map((item) => `${item.x.toFixed(2)},${item.y.toFixed(2)}`).join(" ");
}

function renderGrid(): string {
  const lines: string[] = [];
  for (let step = 1; step < 5; step += 1) {
    const x = (MAP_WIDTH * step) / 5;
    const y = (MAP_HEIGHT * step) / 5;
    lines.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${MAP_HEIGHT}" stroke="#dce2dd" stroke-width="1" opacity="0.55"/>`,
      `<line x1="0" y1="${y}" x2="${MAP_WIDTH}" y2="${y}" stroke="#dce2dd" stroke-width="1" opacity="0.55"/>`,
    );
  }
  return lines.join("");
}

function renderCorridors(geometry: ExploredSpaceGeometry): string {
  return geometry.corridors
    .map((corridor) => {
      const centerX = corridor.left + corridor.length / 2;
      const centerY = corridor.top + corridor.width / 2;
      const degrees = (corridor.angleRadians * 180) / Math.PI;
      return `<rect x="${corridor.left.toFixed(2)}" y="${corridor.top.toFixed(2)}" width="${corridor.length.toFixed(2)}" height="${corridor.width.toFixed(2)}" rx="${(corridor.width / 2).toFixed(2)}" fill="#206a4d" opacity="${corridor.opacity.toFixed(3)}" transform="rotate(${degrees.toFixed(3)} ${centerX.toFixed(2)} ${centerY.toFixed(2)})"/>`;
    })
    .join("");
}

function renderCells(geometry: ExploredSpaceGeometry): string {
  return geometry.cells
    .map(
      (cell) =>
        `<rect x="${cell.left.toFixed(2)}" y="${cell.top.toFixed(2)}" width="${cell.size.toFixed(2)}" height="${cell.size.toFixed(2)}" fill="#206a4d" stroke="#206a4d" stroke-width="0.7" opacity="${cell.opacity.toFixed(3)}"/>`,
    )
    .join("");
}

function renderTracks(geometry: ExploredSpaceGeometry): string {
  return geometry.segments
    .filter((segment) => segment.points.length > 0)
    .map((segment) => {
      const points = polylinePoints(segment.points);
      const first = segment.points[0]!;
      const last = segment.points.at(-1)!;
      return [
        `<polyline points="${points}" fill="none" stroke="#1c5b43" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`,
        `<circle cx="${first.x.toFixed(2)}" cy="${first.y.toFixed(2)}" r="5" fill="#ffffff" stroke="#1c5b43" stroke-width="3"/>`,
        `<circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="6" fill="#1c5b43" stroke="#ffffff" stroke-width="2"/>`,
      ].join("");
    })
    .join("");
}

function renderPanel(
  fixture: Fixture,
  mode: MapDisplayMode,
  column: number,
  row: number,
): { readonly svg: string; readonly result: FixtureModeResult } {
  const geometry = buildExploredSpaceGeometry({
    segments: fixture.segments,
    bounds: boundsFor(fixture.segments),
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    padding: 24,
  });
  const offsetX = OUTER_PADDING + column * PANEL_WIDTH;
  const offsetY = 94 + row * PANEL_HEIGHT;
  const renderedPointCount = geometry.segments.reduce(
    (sum, segment) => sum + segment.points.length,
    0,
  );
  const maximumCellVisits = geometry.cells.reduce(
    (maximum, cell) => Math.max(maximum, cell.visits),
    0,
  );

  const modeLabel =
    mode === "corridor" ? "Explored corridor" : mode === "cells" ? "Coverage cells" : "Thin track";
  const layer =
    mode === "corridor"
      ? renderCorridors(geometry)
      : mode === "cells"
        ? renderCells(geometry)
        : "";
  const metric =
    mode === "corridor"
      ? `${geometry.corridors.length} corridor primitives`
      : mode === "cells"
        ? `${geometry.cells.length} cells · ${Math.round(geometry.cellSizeMeters ?? 0)}m`
        : `${renderedPointCount} rendered points`;

  const svg = `<g transform="translate(${offsetX} ${offsetY})">
    <rect x="0" y="0" width="${PANEL_WIDTH - 18}" height="${PANEL_HEIGHT - 16}" rx="18" fill="#ffffff" stroke="#dce2dd"/>
    <text x="16" y="25" font-family="sans-serif" font-size="14" font-weight="700" fill="#17201d">${escapeXml(modeLabel)}</text>
    <text x="16" y="45" font-family="sans-serif" font-size="11" fill="#5b6963">${escapeXml(metric)}</text>
    <g transform="translate(11 54)">
      <rect x="0" y="0" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" rx="13" fill="#f8faf7" stroke="#dce2dd"/>
      ${renderGrid()}
      ${layer}
      ${renderTracks(geometry)}
    </g>
  </g>`;

  return {
    svg,
    result: {
      fixtureId: fixture.id,
      fixtureTitle: fixture.title,
      mode,
      pointCount: geometry.pointCount,
      renderedPointCount,
      corridors: geometry.corridors.length,
      cells: geometry.cells.length,
      cellSizeMeters: geometry.cellSizeMeters,
      maximumCellVisits,
    },
  };
}

function validateMatrix(results: readonly FixtureModeResult[]): void {
  for (const result of results) {
    if (result.pointCount <= 0 || result.renderedPointCount <= 0) {
      throw new Error(`${result.fixtureId}/${result.mode} produced an empty map.`);
    }
    if (result.cells > 1_400 || result.renderedPointCount > 1_201) {
      throw new Error(`${result.fixtureId}/${result.mode} exceeded renderer bounds.`);
    }
  }

  const separated = FIXTURES.find((fixture) => fixture.id === "separated-sessions")!;
  const expectedCorridors = separated.segments.reduce(
    (sum, segment) => sum + Math.max(0, segment.points.length - 1),
    0,
  );
  const separatedResult = results.find(
    (result) => result.fixtureId === separated.id && result.mode === "corridor",
  );
  if (separatedResult?.corridors !== expectedCorridors) {
    throw new Error(
      `Separated sessions should have ${expectedCorridors} corridors without a bridge; got ${separatedResult?.corridors}.`,
    );
  }

  const revisit = results.find(
    (result) => result.fixtureId === "overlapping-sessions" && result.mode === "cells",
  );
  if (revisit === undefined || revisit.maximumCellVisits < 2) {
    throw new Error("Revisited observations did not strengthen any coverage cell.");
  }

  const sparseFixture = FIXTURES.find(
    (fixture) => fixture.id === "sparse-mixed-accuracy",
  )!;
  const sparseGeometry = buildExploredSpaceGeometry({
    segments: sparseFixture.segments,
    bounds: boundsFor(sparseFixture.segments),
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    padding: 24,
  });
  const corridorWidths = new Set(
    sparseGeometry.corridors.map((corridor) => corridor.width.toFixed(1)),
  );
  if (corridorWidths.size < 2) {
    throw new Error("Mixed accuracy did not produce visibly different corridor widths.");
  }
}

function renderMatrix(): {
  readonly svg: string;
  readonly results: readonly FixtureModeResult[];
} {
  const width = OUTER_PADDING * 2 + PANEL_WIDTH * MODES.length;
  const height = 116 + PANEL_HEIGHT * FIXTURES.length;
  const panels: string[] = [];
  const results: FixtureModeResult[] = [];

  for (let row = 0; row < FIXTURES.length; row += 1) {
    const fixture = FIXTURES[row]!;
    const rowY = 94 + row * PANEL_HEIGHT;
    panels.push(
      `<text x="${OUTER_PADDING}" y="${rowY - 36}" font-family="sans-serif" font-size="18" font-weight="800" fill="#17201d">${escapeXml(fixture.title)}</text>`,
      `<text x="${OUTER_PADDING}" y="${rowY - 16}" font-family="sans-serif" font-size="12" fill="#5b6963">${escapeXml(fixture.question)}</text>`,
    );
    for (let column = 0; column < MODES.length; column += 1) {
      const panel = renderPanel(fixture, MODES[column]!, column, row);
      panels.push(panel.svg);
      results.push(panel.result);
    }
  }

  validateMatrix(results);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#f4f5f1"/>
  <text x="${OUTER_PADDING}" y="34" font-family="sans-serif" font-size="24" font-weight="900" fill="#17201d">Explored-space fixture matrix</text>
  <text x="${OUTER_PADDING}" y="58" font-family="sans-serif" font-size="13" fill="#5b6963">Deterministic renderer evidence — not canonical map truth</text>
  ${panels.join("\n")}
</svg>
`;
  return { svg, results };
}

async function main(): Promise<void> {
  const outputDirectory = resolve(process.argv[2] ?? "artifacts/explored-space-fixtures");
  await mkdir(outputDirectory, { recursive: true });
  const matrix = renderMatrix();
  await writeFile(resolve(outputDirectory, "fixture-matrix.svg"), matrix.svg, "utf8");
  await writeFile(
    resolve(outputDirectory, "fixture-matrix.json"),
    JSON.stringify(
      {
        generatedAt: "deterministic",
        fixtureCount: FIXTURES.length,
        modes: MODES,
        results: matrix.results,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log(
    JSON.stringify({
      outputDirectory,
      fixtures: FIXTURES.length,
      panels: matrix.results.length,
    }),
  );
}

await main();
