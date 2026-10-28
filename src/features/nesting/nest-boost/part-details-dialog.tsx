"use client";
import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { snText, type Group } from "./engine";
import { partDetails, STEEL_KG_PER_M2_MM } from "./part-details";

const n0 = (v: number) => Math.round(v).toLocaleString();
const n2 = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n3 = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const kgText = (v: number | null) => (v === null ? "—" : `${n2(v)} kg`);

function Row({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-0.5 border-b border-border/60 py-1.5 last:border-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div>
        <div className="text-sm font-medium tabular-nums">{value}</div>
        {note && <div className="text-[11px] leading-snug text-muted-foreground">{note}</div>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border p-3">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** "Details" popup of a part row: size, area, weight and how each number is worked out. */
export function PartDetailsDialog({
  group, placed, left, onOpenChange,
}: {
  group: Group | null;
  /** How many pieces of this part are on sheets right now. */
  placed: number;
  /** How many pieces are still to place. */
  left: number;
  onOpenChange: (open: boolean) => void;
}) {
  const g = group;
  const d = g ? partDetails(g, placed, left) : null;
  return (
    <Dialog open={!!g} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        {g && d && (
          <>
            <DialogHeader>
              <DialogTitle>Part #{snText(g)} — details</DialogTitle>
              <DialogDescription className="break-all">{g.name}</DialogDescription>
            </DialogHeader>

            <Section title="Size">
              <Row label="Length × Width" value={`${n2(g.w)} × ${n2(g.h)} mm`} note="Bounding rectangle of the outline." />
              <Row label="Thickness" value={d.thickness > 0 ? `${d.thickness} mm` : "not entered"} />
              <Row label="Material" value={g.material || "not entered"} />
              <Row label="Holes" value={d.holeCount} />
              <Row label="Cut length" value={`${n0(d.perimeterMm)} mm`} note="Outline + the outline of every hole." />
            </Section>

            <Section title="Area">
              <Row
                label="Net area (1 piece)"
                value={`${n0(d.netMm2)} mm²  =  ${n3(d.netM2)} m²`}
                note={
                  <>
                    Net area = outline area − holes area
                    <br />
                    {n0(d.outlineMm2)} − {n0(d.holesMm2)} = {n0(d.netMm2)} mm²
                    <br />
                    (outline area from the drawing points, shoelace formula; mm² ÷ 1,000,000 = m²)
                  </>
                }
              />
              <Row
                label="Rectangle area"
                value={`${n0(d.boxMm2)} mm²`}
                note={`Length × Width = ${n2(g.w)} × ${n2(g.h)}. The part fills ${d.fillPct.toFixed(1)}% of it.`}
              />
            </Section>

            <Section title="Weight">
              <Row
                label="Weight (1 piece)"
                value={kgText(d.unitKg)}
                note={
                  d.unitKg === null ? (
                    "Enter the thickness (mm) to get the weight."
                  ) : (
                    <>
                      Weight = area (m²) × thickness (mm) × {STEEL_KG_PER_M2_MM}
                      <br />
                      {n3(d.netM2)} × {d.thickness} × {STEEL_KG_PER_M2_MM} = {n2(d.unitKg)} kg
                      <br />
                      ({STEEL_KG_PER_M2_MM} = steel density 7,850 kg/m³ per mm of thickness)
                    </>
                  )
                }
              />
              <Row
                label="Total weight"
                value={kgText(d.totalKg)}
                note={d.unitKg === null ? undefined : `${n2(d.unitKg)} kg × ${d.qty} pcs`}
              />
            </Section>

            <Section title="Quantity">
              <Row label="Required" value={`${d.qty} pcs`} />
              <Row label="Placed on sheets" value={`${d.placed} pcs`} note={d.unitKg === null ? undefined : `${kgText(d.placedKg)}`} />
              <Row
                label="Left to place"
                value={`${d.left} pcs`}
                note={
                  g.seg?.role === "parent"
                    ? "A segmented original has nothing to place — its pieces are placed instead."
                    : d.unitKg === null
                      ? undefined
                      : `${kgText(d.leftKg)}  (Left = Required − Placed)`
                }
              />
              {g.seg?.role === "child" && (
                <Row label="Segment" value={`Piece ${snText(g)}`} note="Quantity, thickness and material come from the original part." />
              )}
            </Section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
