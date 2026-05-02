"use client";

import { useState, useRef, useEffect } from "react";

const EXAMPLES = [
  "Flights from Chicago to Miami today",
  "Is AA100 on time today?",
  "Flights arriving at JFK right now",
  "Flights otw to Dubai right now",
];

// ─── Types ────────────────────────────────────────────────────────────────────

type Flight = {
  number: string;
  date: string;
  direction: "departure" | "arrival";
  airline: string | null;
  destination: string;
  destinationCity: string;
  departureTime: string | null;
  revisedTime: string | null;
  terminal: string | null;
  gate: string | null;
  aircraft: string | null;
  status: string;
};

type FlightStatusInfo = {
  number: string;
  status: string;
  airline: string | null;
  aircraft: string | null;
  registration: string | null;
  departure: {
    iata: string | null;
    city: string | null;
    scheduledTime: string | null;
    revisedTime: string | null;
    utc: string | null;
    terminal: string | null;
    gate: string | null;
  };
  arrival: {
    iata: string | null;
    city: string | null;
    scheduledTime: string | null;
    revisedTime: string | null;
    utc: string | null;
    terminal: string | null;
    gate: string | null;
    baggageBelt: string | null;
  };
};

type AirportItem = {
  iata?: string;
  icao?: string;
  name?: string;
  shortName?: string;
  municipalityName?: string;
  countryCode?: string;
  timeZone?: string;
};

type DelayBracket = {
  delayFrom: string;
  delayTo: string | null;
  numFlights: number;
};

type FlightDelayLeg = {
  airportIcao: string;
  medianDelay: string;
  numConsideredFlights: number;
  numFlightsDelayedBrackets: DelayBracket[];
};

type FlightDelayStats = {
  number: string;
  origins: FlightDelayLeg[] | null;
  destinations: FlightDelayLeg[] | null;
};

type AgentResult = {
  summary: string;
  flights: Flight[] | null;
  arrivals: Flight[] | null;
  flightStatus: FlightStatusInfo[] | null;
  airports: AirportItem[] | null;
  delays: unknown | null;
  flightDelays: FlightDelayStats | null;
  toolResults: { tool: string; args: Record<string, string>; result: unknown }[];
  rawMessages: unknown[];
};

type ThinkingStep = {
  id: number;
  label: string;
  done: boolean;
};

type ConvMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking: ThinkingStep[];
  result: AgentResult | null;
  loading: boolean;
  error: string | null;
};

let _id = 0;
const genId = () => String(++_id);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function airlineCode(flightNumber: string): string {
  return flightNumber.replace(/\s+/g, "").match(/^[A-Z]{2}/)?.[0] ?? "";
}

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("delay")) return "#92400e";
  if (s.includes("cancel")) return "#991b1b";
  if (s.includes("land") || s.includes("arriv") || s.includes("on time")) return "#166534";
  return "#9a9a96";
}

function formatStatus(status: string): string {
  return status.replace(/([a-z])([A-Z])/g, "$1 $2");
}

// ─── Flight progress bar ──────────────────────────────────────────────────────

function FlightProgress({ detail }: { detail: FlightStatusInfo }) {
  const depUtc = detail.departure.utc;
  const arrUtc = detail.arrival.utc;
  if (!depUtc || !arrUtc) return null;
  if (detail.status.toLowerCase().includes("cancel")) return null;

  const dep = new Date(depUtc).getTime();
  const arr = new Date(arrUtc).getTime();
  const now = Date.now();
  const pct = Math.min(100, Math.max(0, ((now - dep) / (arr - dep)) * 100));
  const enRoute = now > dep && now < arr;
  const landed = now >= arr;

  return (
    <div style={{ paddingTop: "0.25rem" }}>
      <div style={{ position: "relative", height: "2px", background: "rgba(0,0,0,0.07)", borderRadius: "2px", margin: "0.5rem 0" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, background: "#1A1A1A", borderRadius: "2px", transition: "width 0.6s ease" }} />
        {(enRoute || landed) && (
          <div style={{ position: "absolute", top: "50%", left: landed ? "calc(100% - 7px)" : `${pct}%`, transform: "translate(-50%, -50%)", pointerEvents: "none" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#1A1A1A" style={{ transform: "rotate(90deg)" }}>
              <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
            </svg>
          </div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.65rem", color: "#9a9a96" }}>
          {detail.departure.iata} · {detail.departure.revisedTime ?? detail.departure.scheduledTime}
        </span>
        {enRoute && (
          <span style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.62rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b6b68" }}>
            En route · {Math.round(pct)}%
          </span>
        )}
        {landed && (
          <span style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.62rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "#15803d" }}>
            Landed
          </span>
        )}
        <span style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.65rem", color: "#9a9a96" }}>
          {detail.arrival.iata} · {detail.arrival.revisedTime ?? detail.arrival.scheduledTime}
        </span>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AirlineTab({ label, code, active, onClick }: { label: string; code?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: "6px",
        padding: "4px 10px", borderRadius: "3px",
        background: active ? "rgba(0,0,0,0.05)" : "transparent",
        border: "none", cursor: "pointer",
        fontFamily: "var(--font-geist-sans)", fontSize: "0.72rem",
        color: active ? "#1A1A1A" : "#9a9a96",
        whiteSpace: "nowrap",
        transition: "color 0.15s, background 0.15s",
        letterSpacing: "0.02em",
      }}
    >
      {code && (
        <img
          src={`https://www.gstatic.com/flights/airline_logos/70px/${code}.png`}
          width={15} height={15} alt=""
          style={{ objectFit: "contain", borderRadius: "2px" }}
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
      )}
      {label}
    </button>
  );
}

function FlightCard({
  flight, expanded, loadingDetail, detail, onToggle,
}: {
  flight: Flight;
  expanded: boolean;
  loadingDetail: boolean;
  detail: FlightStatusInfo | null;
  onToggle: () => void;
}) {
  const isDelayed = flight.revisedTime && flight.revisedTime !== flight.departureTime;
  const isArrival = flight.direction === "arrival";

  return (
    <div onClick={onToggle} style={{ borderBottom: "1px solid rgba(0,0,0,0.06)", borderLeft: `3px solid ${statusColor(flight.status)}`, paddingLeft: "0.75rem", paddingRight: "1rem", cursor: "pointer", minWidth: 0 }} className="flight-row">
      <div style={{ display: "grid", gridTemplateColumns: "90px 1fr auto", alignItems: "center", gap: "0 1.25rem", padding: "1rem 0" }}>
        <div>
          <div style={{ fontFamily: "var(--font-playfair)", fontSize: "1.25rem", fontWeight: 400, color: "#1A1A1A", lineHeight: 1 }}>
            {isDelayed ? flight.revisedTime : flight.departureTime}
          </div>
          {isDelayed && (
            <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.65rem", color: "#9a9a96", textDecoration: "line-through", marginTop: "2px" }}>
              {flight.departureTime}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.62rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "#9a9a96" }}>
              {isArrival ? "from" : "to"}
            </span>
            <span style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.78rem", fontWeight: 500, color: "#1A1A1A", letterSpacing: "0.04em" }}>{flight.destination}</span>
            <span style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.78rem", color: "#6b6b68" }}>{flight.destinationCity}</span>
          </div>
          <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.72rem", color: "#C8C8C4", display: "flex", gap: "8px" }}>
            <span>{flight.number}</span>
            {flight.airline && <><span>·</span><span>{flight.airline}</span></>}
            {flight.aircraft && <><span>·</span><span>{flight.aircraft}</span></>}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
          {flight.terminal && (
            <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.62rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "#9a9a96" }}>
              T{flight.terminal}{flight.gate ? ` · ${flight.gate}` : ""}
            </div>
          )}
          {flight.status && flight.status !== "Unknown" && (
            <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.62rem", letterSpacing: "0.08em", textTransform: "uppercase", color: statusColor(flight.status) }}>
              {formatStatus(flight.status)}
            </div>
          )}
        </div>
      </div>

      <div
        style={{ display: "grid", gridTemplateRows: expanded ? "1fr" : "0fr", transition: "grid-template-rows 0.28s ease" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ overflow: "hidden" }}>
          <div style={{ paddingBottom: expanded ? "1rem" : 0, borderTop: expanded ? "1px solid rgba(0,0,0,0.04)" : "none" }}>
            {loadingDetail ? (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.75rem 0" }}>
                <span className="thinking-dot" />
                <span style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.72rem", color: "#9a9a96" }}>Loading flight details…</span>
              </div>
            ) : detail ? (
              <div style={{ paddingTop: "0.875rem", paddingRight: "1rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 24px 1fr", alignItems: "start", gap: "0 8px" }}>
                  <div>
                    <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.58rem", letterSpacing: "0.14em", textTransform: "uppercase", color: "#C8C8C4", marginBottom: "4px" }}>Departs</div>
                    <div style={{ fontFamily: "var(--font-playfair)", fontSize: "1.4rem", fontWeight: 400, color: "#1A1A1A", lineHeight: 1 }}>
                      {detail.departure.revisedTime ?? detail.departure.scheduledTime ?? "—"}
                    </div>
                    {detail.departure.revisedTime && detail.departure.revisedTime !== detail.departure.scheduledTime && (
                      <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.63rem", color: "#9a9a96", textDecoration: "line-through" }}>{detail.departure.scheduledTime}</div>
                    )}
                    <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.75rem", color: "#6b6b68", marginTop: "4px" }}>
                      {detail.departure.iata} {detail.departure.city}
                    </div>
                    {(detail.departure.terminal || detail.departure.gate) && (
                      <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.68rem", color: "#9a9a96", marginTop: "2px" }}>
                        {detail.departure.terminal ? `T${detail.departure.terminal}` : ""}
                        {detail.departure.terminal && detail.departure.gate ? " · " : ""}
                        {detail.departure.gate ? `Gate ${detail.departure.gate}` : ""}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", justifyContent: "center", paddingTop: "1.5rem" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M5 12h14M12 5l7 7-7 7" stroke="#C8C8C4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.58rem", letterSpacing: "0.14em", textTransform: "uppercase", color: "#C8C8C4", marginBottom: "4px" }}>Arrives</div>
                    <div style={{ fontFamily: "var(--font-playfair)", fontSize: "1.4rem", fontWeight: 400, color: "#1A1A1A", lineHeight: 1 }}>
                      {detail.arrival.revisedTime ?? detail.arrival.scheduledTime ?? "—"}
                    </div>
                    {detail.arrival.revisedTime && detail.arrival.revisedTime !== detail.arrival.scheduledTime && (
                      <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.63rem", color: "#9a9a96", textDecoration: "line-through" }}>{detail.arrival.scheduledTime}</div>
                    )}
                    <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.75rem", color: "#6b6b68", marginTop: "4px" }}>
                      {detail.arrival.iata} {detail.arrival.city}
                    </div>
                    {(detail.arrival.terminal || detail.arrival.gate || detail.arrival.baggageBelt) && (
                      <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.68rem", color: "#9a9a96", marginTop: "2px" }}>
                        {detail.arrival.terminal ? `T${detail.arrival.terminal}` : ""}
                        {detail.arrival.terminal && detail.arrival.gate ? " · " : ""}
                        {detail.arrival.gate ? `Gate ${detail.arrival.gate}` : ""}
                        {detail.arrival.baggageBelt ? ` · Baggage ${detail.arrival.baggageBelt}` : ""}
                      </div>
                    )}
                  </div>
                </div>

                <FlightProgress detail={detail} />

                <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                  {detail.status && detail.status !== "Unknown" && (
                    <div>
                      <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.58rem", letterSpacing: "0.14em", textTransform: "uppercase", color: "#C8C8C4", marginBottom: "2px" }}>Status</div>
                      <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.78rem", color: statusColor(detail.status) }}>{formatStatus(detail.status)}</div>
                    </div>
                  )}
                  {detail.aircraft && (
                    <div>
                      <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.58rem", letterSpacing: "0.14em", textTransform: "uppercase", color: "#C8C8C4", marginBottom: "2px" }}>Aircraft</div>
                      <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.78rem", color: "#6b6b68" }}>{detail.aircraft}</div>
                    </div>
                  )}
                  {detail.registration && (
                    <div>
                      <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.58rem", letterSpacing: "0.14em", textTransform: "uppercase", color: "#C8C8C4", marginBottom: "2px" }}>Tail</div>
                      <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.78rem", color: "#6b6b68" }}>{detail.registration}</div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.72rem", color: "#9a9a96", padding: "0.75rem 0" }}>Details unavailable.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FlightStatusCard({ info }: { info: FlightStatusInfo }) {
  const dep = info.departure;
  const arr = info.arrival;
  const depDelayed = dep.revisedTime && dep.revisedTime !== dep.scheduledTime;
  const arrDelayed = arr.revisedTime && arr.revisedTime !== arr.scheduledTime;

  return (
    <div style={{ padding: "1rem 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <img
            src={`https://www.gstatic.com/flights/airline_logos/70px/${airlineCode(info.number)}.png`}
            width={20} height={20} alt=""
            style={{ objectFit: "contain", borderRadius: "2px" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
          <span style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.82rem", fontWeight: 500, color: "#1A1A1A" }}>{info.number}</span>
          {info.airline && <span style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.75rem", color: "#9a9a96" }}>{info.airline}</span>}
        </div>
        {info.status && info.status !== "Unknown" && (
          <span style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.62rem", letterSpacing: "0.1em", textTransform: "uppercase", color: statusColor(info.status) }}>
            {formatStatus(info.status)}
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 32px 1fr", alignItems: "center", gap: "0 8px" }}>
        <div>
          <div style={{ fontFamily: "var(--font-playfair)", fontSize: "1.6rem", fontWeight: 400, color: "#1A1A1A", lineHeight: 1 }}>
            {depDelayed ? dep.revisedTime : dep.scheduledTime ?? "—"}
          </div>
          {depDelayed && (
            <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.65rem", color: "#9a9a96", textDecoration: "line-through" }}>{dep.scheduledTime}</div>
          )}
          <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.82rem", fontWeight: 500, color: "#1A1A1A", marginTop: "4px" }}>
            {dep.iata ?? "—"} <span style={{ fontWeight: 400, color: "#6b6b68" }}>{dep.city}</span>
          </div>
          <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.68rem", color: "#9a9a96", marginTop: "3px" }}>
            {dep.terminal ? `Terminal ${dep.terminal}` : ""}
            {dep.terminal && dep.gate ? " · " : ""}
            {dep.gate ? `Gate ${dep.gate}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M5 12h14M12 5l7 7-7 7" stroke="#C8C8C4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "var(--font-playfair)", fontSize: "1.6rem", fontWeight: 400, color: "#1A1A1A", lineHeight: 1 }}>
            {arrDelayed ? arr.revisedTime : arr.scheduledTime ?? "—"}
          </div>
          {arrDelayed && (
            <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.65rem", color: "#9a9a96", textDecoration: "line-through" }}>{arr.scheduledTime}</div>
          )}
          <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.82rem", fontWeight: 500, color: "#1A1A1A", marginTop: "4px" }}>
            <span style={{ fontWeight: 400, color: "#6b6b68" }}>{arr.city}</span> {arr.iata ?? "—"}
          </div>
          <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.68rem", color: "#9a9a96", marginTop: "3px" }}>
            {arr.terminal ? `Terminal ${arr.terminal}` : ""}
            {arr.terminal && arr.gate ? " · " : ""}
            {arr.gate ? `Gate ${arr.gate}` : ""}
            {arr.baggageBelt ? ` · Baggage ${arr.baggageBelt}` : ""}
          </div>
        </div>
      </div>

      {info.aircraft && (
        <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.68rem", color: "#C8C8C4", marginTop: "10px" }}>
          {info.aircraft}{info.registration ? ` · ${info.registration}` : ""}
        </div>
      )}
    </div>
  );
}

function AirportCard({ airport }: { airport: AirportItem }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.875rem 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
        <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.82rem", fontWeight: 500, color: "#1A1A1A" }}>
          {airport.municipalityName ?? airport.name}
          {airport.shortName && airport.shortName !== airport.municipalityName && (
            <span style={{ fontWeight: 400, color: "#6b6b68", marginLeft: "6px" }}>{airport.shortName}</span>
          )}
        </div>
        <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.72rem", color: "#9a9a96", display: "flex", gap: "8px" }}>
          {airport.iata && <span>{airport.iata}</span>}
          {airport.icao && <><span>·</span><span>{airport.icao}</span></>}
          {airport.countryCode && <><span>·</span><span>{airport.countryCode.toUpperCase()}</span></>}
        </div>
      </div>
      {airport.timeZone && (
        <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.68rem", color: "#C8C8C4", letterSpacing: "0.06em" }}>
          {airport.timeZone.split("/")[1]?.replace("_", " ")}
        </div>
      )}
    </div>
  );
}

function DelayCard({ delays }: { delays: Record<string, unknown> }) {
  const entries = Object.entries(delays).filter(([, v]) => v !== null && typeof v !== "object");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem 1.5rem", padding: "1rem 0" }}>
      {entries.map(([k, v]) => (
        <div key={k}>
          <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.6rem", letterSpacing: "0.16em", textTransform: "uppercase", color: "#9a9a96", marginBottom: "2px" }}>
            {k.replace(/_/g, " ")}
          </div>
          <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.85rem", color: "#1A1A1A" }}>{String(v)}</div>
        </div>
      ))}
    </div>
  );
}

function parseDelayMinutes(span: string): number {
  const neg = span.startsWith("-");
  const m = span.replace("-", "").match(/(\d+):(\d+):(\d+)/);
  if (!m) return 0;
  const mins = parseInt(m[1]) * 60 + parseInt(m[2]);
  return neg ? -mins : mins;
}

function FlightDelayCard({ data }: { data: FlightDelayStats }) {
  const legs = [
    ...(data.origins ?? []).map((l) => ({ ...l, dir: "Departure" as const })),
    ...(data.destinations ?? []).map((l) => ({ ...l, dir: "Arrival" as const })),
  ];
  if (!legs.length) return null;

  return (
    <div style={{ padding: "1rem 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
      <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.6rem", letterSpacing: "0.16em", textTransform: "uppercase", color: "#9a9a96", marginBottom: "1rem" }}>
        {data.number} · Delay History
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {legs.map((leg, i) => {
          const medianMins = parseDelayMinutes(leg.medianDelay);
          const medianLabel = medianMins === 0
            ? "On time"
            : medianMins < 0
              ? `${Math.abs(medianMins)}m early`
              : `${medianMins}m late`;
          const medianColor = medianMins <= 0 ? "#15803d" : medianMins <= 15 ? "#b45309" : "#dc2626";
          const accentColor = medianMins <= 0 ? "#15803d" : medianMins <= 15 ? "#b45309" : "#dc2626";

          const totalFlights = leg.numFlightsDelayedBrackets?.reduce((s, b) => s + b.numFlights, 0) ?? 0;

          return (
            <div key={i} style={{ borderLeft: `3px solid ${accentColor}`, paddingLeft: "1rem" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
                <div style={{ paddingTop: "0.2rem" }}>
                  <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.58rem", letterSpacing: "0.14em", textTransform: "uppercase", color: "#C8C8C4", marginBottom: "3px" }}>{leg.dir}</div>
                  <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.82rem", color: "#6b6b68" }}>{leg.airportIcao}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontFamily: "var(--font-playfair)", fontSize: "2.5rem", lineHeight: 1, fontWeight: 400, color: medianColor }}>{medianLabel}</div>
                  <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.6rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "#9a9a96", marginTop: "4px" }}>median</div>
                </div>
              </div>
              {leg.numFlightsDelayedBrackets?.length > 0 && totalFlights > 0 && (
                <div style={{ display: "flex", gap: "2px", height: "22px", alignItems: "flex-end", marginTop: "0.625rem" }}>
                  {leg.numFlightsDelayedBrackets.map((b, j) => {
                    const pct = (b.numFlights / totalFlights) * 100;
                    const label = b.delayFrom === "0" || b.delayFrom === "00:00:00"
                      ? "On time"
                      : parseDelayMinutes(b.delayFrom) < 0
                        ? "Early"
                        : `+${parseDelayMinutes(b.delayFrom)}m`;
                    const barColor = parseDelayMinutes(b.delayFrom) <= 0
                      ? "#15803d"
                      : parseDelayMinutes(b.delayFrom) <= 15
                        ? "#b45309"
                        : "#dc2626";
                    return (
                      <div key={j} title={`${label}: ${b.numFlights} flights (${Math.round(pct)}%)`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                        <div style={{ width: "100%", height: `${Math.max(2, pct * 0.22)}px`, background: barColor, opacity: 0.6, borderRadius: "1px 1px 0 0" }} />
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.62rem", color: "#C8C8C4", marginTop: "5px" }}>
                Based on {leg.numConsideredFlights} flights
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToolPill({ tool }: { tool: string }) {
  const labels: Record<string, string> = {
    search_departures: "Departures",
    search_arrivals: "Arrivals",
    get_flight_status: "Flight status",
    search_airport: "Airport lookup",
    get_airport_delays: "Delay stats",
    get_flight_delays: "Delay history",
  };
  return (
    <span style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.58rem", letterSpacing: "0.2em", textTransform: "uppercase", color: "#9a9a96" }}>
      {labels[tool] ?? tool}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [hasStarted, setHasStarted] = useState(false);
  const [convMessages, setConvMessages] = useState<ConvMessage[]>([]);
  const [rawHistory, setRawHistory] = useState<unknown[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [selectedAirline, setSelectedAirline] = useState<string | null>(null);
  const [expandedFlight, setExpandedFlight] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);
  const [flightDetails, setFlightDetails] = useState<Record<string, FlightStatusInfo>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const landingInputRef = useRef<HTMLInputElement>(null);

  // Gate the max-width transition so it only fires after the first search,
  // not on initial page load (which would cause an animated layout shift).
  const [enableTransition, setEnableTransition] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [convMessages]);

  // Focus the landing input client-side only to avoid SSR hydration mismatch.
  useEffect(() => {
    landingInputRef.current?.focus();
  }, []);

  const activeResult = convMessages.find((m) => m.id === activeMessageId)?.result ?? null;

  async function handleSubmit(text?: string) {
    const userText = (text ?? input).trim();
    if (!userText || isLoading) return;

    setInput("");
    setEnableTransition(true);
    setHasStarted(true);
    setIsLoading(true);
    setSelectedAirline(null);
    setExpandedFlight(null);

    const assistantId = genId();

    const historyToSend = [
      ...rawHistory,
      { role: "user", content: userText },
    ];

    setConvMessages((prev) => [
      ...prev,
      { id: genId(), role: "user", content: userText, thinking: [], result: null, loading: false, error: null },
      { id: assistantId, role: "assistant", content: "", thinking: [], result: null, loading: true, error: null },
    ]);
    setActiveMessageId(assistantId);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: historyToSend }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { type: string; [k: string]: unknown };

          if (event.type === "tool_start") {
            setConvMessages((prev) => prev.map((m) =>
              m.id === assistantId
                ? { ...m, thinking: [...m.thinking, { id: event.id as number, label: event.label as string, done: false }] }
                : m
            ));
          } else if (event.type === "tool_end") {
            setConvMessages((prev) => prev.map((m) =>
              m.id === assistantId
                ? { ...m, thinking: m.thinking.map((s) => s.id === (event.id as number) ? { ...s, done: true } : s) }
                : m
            ));
          } else if (event.type === "result") {
            const data = event.data as AgentResult;
            setConvMessages((prev) => prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: data.summary, result: data, loading: false }
                : m
            ));
            setRawHistory(data.rawMessages ?? []);
            setIsLoading(false);
          } else if (event.type === "error") {
            const msg = (event.code as string) === "rate_limited"
              ? "Rate limit reached. Please wait a moment."
              : "Something went wrong.";
            setConvMessages((prev) => prev.map((m) =>
              m.id === assistantId ? { ...m, content: msg, loading: false, error: msg } : m
            ));
            setIsLoading(false);
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      setConvMessages((prev) => prev.map((m) =>
        m.id === assistantId ? { ...m, content: msg, loading: false, error: msg } : m
      ));
      setIsLoading(false);
    }
  }

  async function toggleFlight(flight: Flight) {
    const key = flight.number;
    if (expandedFlight === key) { setExpandedFlight(null); return; }
    setExpandedFlight(key);
    if (flightDetails[key]) return;
    setLoadingDetail(key);
    try {
      const res = await fetch("/api/flight-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: flight.number, date: flight.date }),
      });
      const data = await res.json() as FlightStatusInfo | null;
      if (data) setFlightDetails((prev) => ({ ...prev, [key]: data }));
    } finally {
      setLoadingDetail(null);
    }
  }

  const flightList = activeResult?.flights ?? activeResult?.arrivals ?? null;

  const airlines = flightList
    ? Array.from(
        flightList.reduce((map, f) => {
          const code = airlineCode(f.number);
          if (code && !map.has(code)) map.set(code, f.airline ?? code);
          return map;
        }, new Map<string, string>())
      ).map(([code, name]) => ({ code, name }))
    : [];

  const displayedFlights = flightList
    ? selectedAirline ? flightList.filter((f) => airlineCode(f.number) === selectedAirline) : flightList
    : null;

  const resetConversation = () => {
    setHasStarted(false);
    setConvMessages([]);
    setRawHistory([]);
    setActiveMessageId(null);
    setSelectedAirline(null);
    setExpandedFlight(null);
  };

  const resultsPanel = (
    <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
      {activeResult ? (
        <div style={{ padding: "1.5rem" }}>
          <div style={{ background: "rgba(249,249,247,0.9)", borderRadius: "8px", border: "1px solid rgba(138,132,124,0.18)", overflow: "hidden" }}>
            <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid rgba(138,132,124,0.14)", display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {activeResult.toolResults.map((t, i) => <ToolPill key={i} tool={t.tool} />)}
            </div>
            {flightList && airlines.length > 1 && (
              <div style={{ display: "flex", gap: "2px", padding: "0.6rem 1rem", borderBottom: "1px solid rgba(0,0,0,0.06)", overflowX: "auto" }}>
                <AirlineTab label="All" active={selectedAirline === null} onClick={() => setSelectedAirline(null)} />
                {airlines.map((a) => (
                  <AirlineTab key={a.code} label={a.name} code={a.code} active={selectedAirline === a.code} onClick={() => setSelectedAirline(a.code)} />
                ))}
              </div>
            )}
            <div style={{ padding: "0 1.25rem" }}>
              {activeResult.summary && (
                <p style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.82rem", color: "#6b6b68", padding: "0.875rem 0", borderBottom: "1px solid rgba(0,0,0,0.06)", lineHeight: 1.6 }}>
                  {activeResult.summary}
                </p>
              )}
              {activeResult.flightStatus && activeResult.flightStatus.length > 0 &&
                activeResult.flightStatus.map((f) => <FlightStatusCard key={f.number} info={f} />)
              }
              {displayedFlights && displayedFlights.length > 0
                ? displayedFlights.map((f) => (
                    <FlightCard key={f.number} flight={f} expanded={expandedFlight === f.number} loadingDetail={loadingDetail === f.number} detail={flightDetails[f.number] ?? null} onToggle={() => toggleFlight(f)} />
                  ))
                : null}
              {displayedFlights && displayedFlights.length === 0 && (
                <p style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.8rem", color: "#9a9a96", padding: "1.5rem 0", textAlign: "center" }}>
                  {selectedAirline ? "No flights for this airline." : "No flights found."}
                </p>
              )}
              {activeResult.airports && (activeResult.airports as AirportItem[]).length > 0 && (
                <>
                  <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.6rem", letterSpacing: "0.16em", textTransform: "uppercase", color: "#9a9a96", paddingTop: "0.875rem" }}>Airports</div>
                  {(activeResult.airports as AirportItem[]).map((a) => <AirportCard key={a.iata ?? a.name} airport={a} />)}
                </>
              )}
              {activeResult.delays != null && typeof activeResult.delays === "object" && !Array.isArray(activeResult.delays) && (
                <>
                  <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.6rem", letterSpacing: "0.16em", textTransform: "uppercase", color: "#9a9a96", paddingTop: "0.875rem" }}>Delay Statistics</div>
                  <DelayCard delays={activeResult.delays as Record<string, unknown>} />
                </>
              )}
              {activeResult.flightDelays != null && (
                <FlightDelayCard data={activeResult.flightDelays as FlightDelayStats} />
              )}
            </div>
            {(() => {
              const searchArgs = activeResult.toolResults.find((t) => t.tool === "search_departures" || t.tool === "search_arrivals")?.args;
              if (!searchArgs) return null;
              if (searchArgs.active_only === "true" || (searchArgs.active_only as unknown) === true) return null;
              const origin = searchArgs.origin_iata ?? searchArgs.destination_iata;
              const dest = searchArgs.destination_iata ?? searchArgs.origin_iata;
              const date = searchArgs.date;
              if (!origin || !dest || !date) return null;
              const skDate = date.replace(/-/g, "").slice(2);
              const links = [
                { label: "Kayak", domain: "kayak.com", href: `https://www.kayak.com/flights/${origin}-${dest}/${date}` },
                { label: "Skyscanner", domain: "skyscanner.com", href: `https://www.skyscanner.com/transport/flights/${origin}/${dest}/${skDate}/` },
                { label: "Expedia", domain: "expedia.com", href: `https://www.expedia.com/go/flight/search/OneWay/${date}/${date}?load=1&FromAirport=${origin}&ToAirport=${dest}` },
              ];
              return (
                <div style={{ borderTop: "1px solid rgba(0,0,0,0.06)", padding: "0.875rem 1.25rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.62rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "#C8C8C4", marginRight: "0.5rem" }}>Book on</span>
                  {links.map(({ label, domain, href }) => (
                    <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="booking-link"
                      style={{ display: "flex", alignItems: "center", gap: "5px", padding: "4px 10px", borderRadius: "3px", border: "1px solid rgba(0,0,0,0.08)", textDecoration: "none", transition: "border-color 0.15s, background 0.15s" }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0,0,0,0.18)"; e.currentTarget.style.background = "rgba(0,0,0,0.02)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(0,0,0,0.08)"; e.currentTarget.style.background = "transparent"; }}
                    >
                      <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`} width={13} height={13} alt="" style={{ borderRadius: "2px" }} className="booking-favicon" />
                      <span style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.72rem", color: "#6b6b68" }}>{label}</span>
                    </a>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      ) : (
        <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontFamily: "var(--font-playfair)", fontSize: "3rem", color: "#1A1A1A", opacity: 0.06 }}>airside</span>
        </div>
      )}
    </div>
  );

  const chatPanel = (
    <>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem 0", minHeight: 0 }}>
        {convMessages.map((msg) => {
          const isClickable = msg.role === "assistant" && !!msg.result;
          const isActive = msg.id === activeMessageId;
          const isHovered = msg.id === hoveredMessageId;
          return (
            <div
              key={msg.id}
              onClick={isClickable ? () => { setActiveMessageId(msg.id); setSelectedAirline(null); setExpandedFlight(null); } : undefined}
              onMouseEnter={isClickable ? () => setHoveredMessageId(msg.id) : undefined}
              onMouseLeave={isClickable ? () => setHoveredMessageId(null) : undefined}
              style={{
                padding: "0.75rem 1.25rem",
                cursor: isClickable ? "pointer" : "default",
                background: isActive ? "rgba(0,0,0,0.025)" : isHovered ? "rgba(0,0,0,0.012)" : "transparent",
                boxShadow: isActive ? "inset 2px 0 0 #1A1A1A" : isHovered ? "inset 2px 0 0 rgba(0,0,0,0.15)" : "inset 2px 0 0 transparent",
                transition: "background 0.15s, box-shadow 0.15s",
              }}
            >
              {msg.role === "user" ? (
                <div>
                  <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.44rem", letterSpacing: "0.28em", textTransform: "uppercase", color: "rgba(0,0,0,0.18)", marginBottom: "4px" }}>You</div>
                  <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.85rem", color: "#1A1A1A", lineHeight: 1.5 }}>{msg.content}</div>
                </div>
              ) : (
                <div>
                  <div style={{ fontFamily: "var(--font-playfair)", fontSize: "0.72rem", letterSpacing: "0.04em", color: isActive ? "rgba(0,0,0,0.65)" : "rgba(0,0,0,0.2)", marginBottom: "4px", transition: "color 0.15s" }}>Airside</div>
                  {msg.loading ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                      {msg.thinking.length === 0 ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span className="thinking-dot" />
                          <span style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.75rem", color: "#9a9a96" }}>Thinking…</span>
                        </div>
                      ) : (
                        msg.thinking.map((step) => (
                          <div key={step.id} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            {step.done ? (
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
                                <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="#C8C8C4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            ) : <span className="thinking-dot" style={{ flexShrink: 0 }} />}
                            <span style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.75rem", color: step.done ? "#C8C8C4" : "#6b6b68" }}>{step.label}</span>
                          </div>
                        ))
                      )}
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.82rem", color: msg.error ? "#dc2626" : "#6b6b68", lineHeight: 1.6 }}>{msg.content}</div>
                      {msg.result && (
                        <div style={{ display: "flex", gap: "4px", marginTop: "8px", flexWrap: "wrap" }}>
                          {msg.result.toolResults.map((t, i) => <ToolPill key={i} tool={t.tool} />)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
      {/* Input */}
      <div style={{ padding: "0.625rem 1rem", borderTop: "1px solid rgba(0,0,0,0.06)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "rgba(249,249,247,0.9)", border: "1px solid rgba(138,132,124,0.18)", borderRadius: "4px", padding: "0.45rem 0.75rem", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55)" }}>
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSubmit()} placeholder="Ask a follow-up…" style={{ flex: 1, background: "transparent", outline: "none", color: "#1A1A1A", fontSize: "0.85rem", fontFamily: "var(--font-geist-sans)" }} />
          <button onClick={() => handleSubmit()} disabled={isLoading || !input.trim()} style={{ color: input.trim() && !isLoading ? "#1A1A1A" : "#C8C8C4", transition: "color 0.15s", lineHeight: 1, background: "none", border: "none", cursor: "pointer" }}>
            {isLoading
              ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ animation: "spin 1s linear infinite" }}><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10" strokeLinecap="round" /></svg>
              : <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            }
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="page-shell" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: hasStarted ? "2.2rem 1.5rem 3rem" : "4rem 1.5rem", background: "#F9F9F7", position: "relative", overflow: "hidden", transition: enableTransition ? "padding 0.4s ease" : "none" }}>
      <div aria-hidden="true" style={{ position: "fixed", inset: 0, backgroundImage: "url(/terrain.jpg)", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.07, filter: "grayscale(100%) contrast(1.1)", pointerEvents: "none", userSelect: "none" }} />

      <div className="content-root" style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: hasStarted ? "2.5rem" : "3.5rem", width: "100%", maxWidth: hasStarted ? "1280px" : "36rem", transition: enableTransition ? "max-width 0.4s ease, gap 0.4s ease" : "none" }}>

        {/* Wordmark — always present */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
              <path d="M2.5 19.5l6.5-2.5 2-2.5 6.5-2.5-6-1.5-2-2.5 1-1 5.5 1.5L18 5l1.5 1.5-3 5 1.5 2.5 3.5 1.5-1 1.5-6-1-2 2-4 1.5Z" fill="#1A1A1A" opacity="0.85" />
            </svg>
            <h1 style={{ fontFamily: "var(--font-playfair)", fontSize: "5.5rem", fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1, color: "#1A1A1A" }}>airside</h1>
          </div>
          <p style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.68rem", fontWeight: 400, letterSpacing: "0.22em", textTransform: "uppercase", color: "#9a9a96" }}>Search flights in plain English</p>
        </div>

        {/* Content area */}
        <div style={{ width: "100%", position: "relative" }}>

          {/* Before: single column input + examples */}
          <div style={{ opacity: hasStarted ? 0 : 1, pointerEvents: hasStarted ? "none" : "auto", transition: "opacity 0.3s ease", position: hasStarted ? "absolute" : "relative", inset: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              <div className="search-launch" style={{ display: "flex", alignItems: "center", gap: "10px", background: "rgba(249,249,247,0.9)", border: "1px solid rgba(138,132,124,0.18)", borderRadius: "4px", padding: "0.875rem 1rem" }}>
                <input ref={landingInputRef} type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSubmit()} placeholder="Find me flights from Toronto to Miami tomorrow" style={{ flex: 1, background: "transparent", outline: "none", color: "#1A1A1A", fontSize: "0.9rem", fontFamily: "var(--font-geist-sans)" }} />
                <button onClick={() => handleSubmit()} disabled={isLoading} style={{ color: input.trim() && !isLoading ? "#1A1A1A" : "#C8C8C4", transition: "color 0.15s", lineHeight: 1, background: "none", border: "none", cursor: "pointer" }}>
                  {isLoading
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ animation: "spin 1s linear infinite" }}><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10" strokeLinecap="round" /></svg>
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  }
                </button>
              </div>
              <div style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }}>
                {EXAMPLES.map((ex) => (
                  <button key={ex} onClick={() => handleSubmit(ex)} className="prompt-row" style={{ display: "flex", width: "100%", textAlign: "left", alignItems: "center", justifyContent: "space-between", background: "transparent", border: "none", borderBottom: "1px solid rgba(0,0,0,0.08)", cursor: "pointer", padding: "0.875rem 2px" }}>
                    <span className="prompt-text" style={{ fontFamily: "var(--font-geist-sans)", fontSize: "0.82rem" }}>{ex}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="prompt-arrow"><path d="M7 17L17 7M17 7H7M17 7v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* After: split box */}
          <div style={{ opacity: hasStarted ? 1 : 0, pointerEvents: hasStarted ? "auto" : "none", transition: "opacity 0.3s ease", position: hasStarted ? "relative" : "absolute", inset: 0 }}>
            <div className="split-area" style={{ display: "flex", height: "calc(100vh - 240px)", minHeight: "520px", overflow: "hidden", transition: enableTransition ? "height 0.4s ease" : "none" }}>

              {/* Left: conversation */}
              <div className="sidebar-pane" style={{ width: "300px", flexShrink: 0, display: "flex", flexDirection: "column", background: "rgba(249,249,247,0.9)", borderRight: "1px solid rgba(138,132,124,0.18)" }}>
                <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "flex-end", flexShrink: 0 }}>
                  <button onClick={resetConversation} style={{ color: "#C8C8C4", lineHeight: 1, background: "none", border: "none", cursor: "pointer", transition: "color 0.15s", padding: "2px" }} onMouseEnter={(e) => (e.currentTarget.style.color = "#6b6b68")} onMouseLeave={(e) => (e.currentTarget.style.color = "#C8C8C4")} title="New conversation">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  </button>
                </div>
                {chatPanel}
              </div>

              {/* Right: results */}
              <div className="results-pane" style={{ flex: 1, display: "flex", flexDirection: "column", background: "#F9F9F7", minWidth: 0 }}>
                {resultsPanel}
              </div>

            </div>
          </div>

        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
        .thinking-dot {
          width: 5px; height: 5px; border-radius: 50%;
          background: #6b6b68; display: inline-block;
          animation: pulse 1.4s ease-in-out infinite;
        }
        .booking-favicon { filter: grayscale(1); opacity: 0.5; transition: filter 0.2s, opacity 0.2s; }
        .booking-link:hover .booking-favicon { filter: grayscale(0); opacity: 1; }

        .page-shell {
          width: 100%;
        }

        .content-root {
          width: 100%;
        }

        .search-launch input {
          min-width: 0;
        }

        .split-area {
          width: 100%;
        }

        .sidebar-pane {
          min-width: 0;
        }

        @media (max-width: 980px) {
          .page-shell {
            padding: 2rem 1rem 2.5rem;
          }

          .content-root {
            gap: 2rem;
            max-width: 100%;
          }

          .search-launch {
            flex-direction: column;
            align-items: stretch;
            gap: 0.75rem;
          }

          .search-launch input {
            width: 100%;
          }

          .split-area {
            flex-direction: column;
            height: auto !important;
            min-height: auto !important;
          }

          .sidebar-pane {
            width: 100% !important;
            border-right: none !important;
            border-bottom: 1px solid rgba(138,132,124,0.18);
          }

          .results-pane {
            width: 100%;
          }

          .content-root h1 {
            font-size: 4rem;
          }

          .page-shell p {
            font-size: 0.75rem;
          }
        }

        @media (max-width: 640px) {
          .page-shell {
            padding: 1.5rem 0.85rem 2rem;
          }

          .content-root {
            gap: 1.5rem;
          }

          .search-launch {
            padding: 0.75rem 0.85rem;
          }

          .search-launch input {
            font-size: 0.9rem;
          }

          .prompt-row {
            padding: 0.75rem 1rem;
          }

          .sidebar-pane {
            border-bottom-width: 1px;
          }
        }
      `}</style>
    </div>
  );
}
