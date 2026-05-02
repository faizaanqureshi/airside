import OpenAI from "openai";
import { NextRequest } from "next/server";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const HOST = "aerodatabox.p.rapidapi.com";

const SYSTEM_PROMPT = `You are an intelligent flight search assistant with access to real-time aviation data tools. Today is 2026-05-02.

You already know the IATA codes for all major airports. Use them directly — do NOT call search_airport for well-known cities:
Toronto=YYZ, Miami=MIA, New York=JFK, Los Angeles=LAX, London=LHR, Paris=CDG, Amsterdam=AMS, Frankfurt=FRA, Dubai=DXB, Singapore=SIN, Tokyo=NRT, Sydney=SYD, Chicago=ORD, San Francisco=SFO, Boston=BOS, Vancouver=YVR, Montreal=YUL, Calgary=YYC, Mexico City=MEX, Cancun=CUN, Rome=FCO, Madrid=MAD, Barcelona=BCN, Zurich=ZRH, Vienna=VIE, Istanbul=IST, Bangkok=BKK, Hong Kong=HKG, Seoul=ICN.

Only call search_airport for genuinely obscure cities or when the user explicitly asks "what airports are near X".

## Direction rules — read carefully
- "flights TO [city]" or "flights heading to [city]" or "flights otw to [city]" = the city is the DESTINATION = call search_arrivals([city])
- "flights FROM [city]" or "flights departing [city]" or "flights leaving [city]" = the city is the ORIGIN = call search_departures([city])
- "flights from A to B" = call search_departures(A, date, B)

Never confuse origin and destination. "otw to Dubai" means Dubai is where they are going — search_arrivals(DXB), NOT search_departures(DXB).

## Examples
- "Flights from Toronto to Miami" → search_departures(YYZ, date, destination=MIA)
- "Flights arriving in Miami today" → search_arrivals(MIA, date)
- "Flights arriving in Miami from Chicago" → search_arrivals(MIA, date, origin=ORD)
- "Flights otw to Dubai right now" → search_arrivals(DXB, date, active_only=true)
- "What's currently in the air to JFK?" → search_arrivals(JFK, date, active_only=true)
- "Flights currently departing LAX" → search_departures(LAX, date, active_only=true)
- "Is AA100 on time today?" → get_flight_status(AA100, date)
- "Are there delays at Heathrow?" → get_airport_delays(LHR)
- "Is AA100 usually on time?" → get_flight_delays(AA100)
- "How often is BA256 delayed?" → get_flight_delays(BA256)
- "How delayed is UA1358 on the ORD→MIA route?" → get_flight_delays(UA1358, origin_icao=KORD, destination_icao=KMIA)

When calling get_flight_delays in the context of a known route (e.g. after searching ORD→MIA departures), always pass origin_icao and destination_icao so only the relevant leg is shown. ICAO codes for common airports: KORD=ORD, KMIA=MIA, KJFK=JFK, KLAX=LAX, KDEN=DEN, KSFO=SFO, KBOS=BOS, KEWR=EWR, KDFW=DFW, KIAH=IAH, KATL=ATL, KLAS=LAS, KLGA=LGA, EGLL=LHR, LFPG=CDG, EHAM=AMS, EDDF=FRA, OMDB=DXB, WSSS=SIN, RJTT=NRT, YSSY=SYD.
- "What airports are near London?" → search_airport("London")

Use active_only=true whenever the user implies flights currently in the air ("right now", "currently", "otw", "in the air", "en route", "at this moment").

After gathering all needed data, write a brief 1–2 sentence plain-English summary. Do NOT list the flights or repeat the data — the UI already shows that. Instead give context: how many options there are, whether things look on time, any notable observations, or a helpful tip.`;

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_departures",
      description: "Search for flights departing from an airport on a given date, optionally filtered to a destination airport.",
      parameters: {
        type: "object",
        properties: {
          origin_iata: { type: "string", description: "IATA code of the departure airport (e.g. YYZ, JFK, LHR)" },
          date:        { type: "string", description: "Date in YYYY-MM-DD format" },
          destination_iata: { type: "string", description: "IATA code of destination airport to filter by (optional)" },
          active_only: { type: "boolean", description: "If true, exclude already-landed/arrived flights. Use for 'right now', 'currently', 'otw' queries." },
        },
        required: ["origin_iata", "date"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_arrivals",
      description: "Search for flights arriving at an airport on a given date, optionally filtered by origin airport.",
      parameters: {
        type: "object",
        properties: {
          destination_iata: { type: "string", description: "IATA code of the arrival airport (e.g. MIA, JFK, LHR)" },
          date:             { type: "string", description: "Date in YYYY-MM-DD format" },
          origin_iata:      { type: "string", description: "IATA code of origin airport to filter by (optional)" },
          active_only: { type: "boolean", description: "If true, exclude already-landed/arrived flights. Use for 'right now', 'currently', 'otw' queries." },
        },
        required: ["destination_iata", "date"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_flight_status",
      description: "Get the real-time status of a specific flight by its flight number and date. Returns departure/arrival times, delays, gate info, baggage belt.",
      parameters: {
        type: "object",
        properties: {
          flight_number: { type: "string", description: "Flight number e.g. AA100, BA256, AC1020 (spaces optional)" },
          date:          { type: "string", description: "Date in YYYY-MM-DD format" },
        },
        required: ["flight_number", "date"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_airport",
      description: "Find airports by city name, airport name, or code. Use this to resolve city names to IATA codes before calling other tools.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "City name, airport name, or IATA/ICAO code" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_airport_delays",
      description: "Get current delay statistics and delay index for an airport.",
      parameters: {
        type: "object",
        properties: {
          iata_code: { type: "string", description: "IATA airport code (e.g. JFK, LHR, YYZ)" },
        },
        required: ["iata_code"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_flight_delays",
      description: "Get historical delay statistics for a specific flight number — how often it is delayed, by how much on average, and the distribution of delays. Use when the user asks how reliable or punctual a specific flight is. If the conversation already established a specific route (origin → destination), pass the ICAO codes to filter to that route only.",
      parameters: {
        type: "object",
        properties: {
          flight_number: { type: "string", description: "Flight number e.g. AA100, BA256, KL1395 (spaces optional)" },
          origin_icao:      { type: "string", description: "ICAO code of the departure airport to filter results (e.g. KORD, EGLL, LFPG). Pass this when the origin is known from conversation context." },
          destination_icao: { type: "string", description: "ICAO code of the arrival airport to filter results (e.g. KMIA, EGLL, OMDB). Pass this when the destination is known from conversation context." },
        },
        required: ["flight_number"],
        additionalProperties: false,
      },
    },
  },
];

// ─── AeroDataBox helpers ─────────────────────────────────────────────────────

async function aeroFetch(path: string): Promise<unknown> {
  const url = `https://${HOST}${path}`;
  console.log("[aero] →", url);
  const res = await fetch(url, {
    headers: { "X-RapidAPI-Key": RAPIDAPI_KEY!, "X-RapidAPI-Host": HOST },
    cache: "no-store",
  });
  console.log("[aero] ←", res.status);
  if (res.status === 429) throw new Error("RATE_LIMITED");
  if (!res.ok || res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

type RawFlight = {
  number: string;
  status: string;
  codeshareStatus: string;
  isCargo: boolean;
  airline?: { name: string; iata?: string };
  aircraft?: { model: string };
  movement: {
    airport: { iata?: string; icao?: string; name?: string; municipalityName?: string };
    scheduledTime?: { utc: string; local: string };
    revisedTime?: { utc: string; local: string };
    terminal?: string;
    gate?: string;
  };
};

function formatAMPM(local: string): string {
  const m = local.match(/(\d{2}):(\d{2})/);
  if (!m) return local;
  let h = parseInt(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
}

function formatFlights(raw: RawFlight[], direction: "departure" | "arrival" = "departure", date = "") {
  const seen = new Set<string>();
  return raw
    .filter((f) => {
      if (f.isCargo) return false;
      if (f.codeshareStatus === "IsCodeshared") return false;
      if (seen.has(f.number)) return false;
      seen.add(f.number);
      return true;
    })
    .sort((a, b) =>
      (a.movement.scheduledTime?.utc ?? "").localeCompare(b.movement.scheduledTime?.utc ?? "")
    )
    .slice(0, 20)
    .map((f) => ({
      number: f.number,
      date,
      direction,
      airline: f.airline?.name ?? null,
      destination: f.movement.airport.iata ?? f.movement.airport.name ?? "",
      destinationCity: f.movement.airport.municipalityName ?? f.movement.airport.name ?? "",
      departureTime: f.movement.scheduledTime ? formatAMPM(f.movement.scheduledTime.local) : null,
      revisedTime: f.movement.revisedTime ? formatAMPM(f.movement.revisedTime.local) : null,
      terminal: f.movement.terminal ?? null,
      gate: f.movement.gate ?? null,
      aircraft: f.aircraft?.model ?? null,
      status: f.status,
    }));
}

function isArrivalInPast(flight: RawFlight) {
  const utc = flight.movement.revisedTime?.utc ?? flight.movement.scheduledTime?.utc;
  if (!utc) return false;
  return new Date(utc).getTime() <= Date.now();
}

// ─── Tool implementations ────────────────────────────────────────────────────

const ACTIVE_STATUSES = new Set(["EnRoute", "Expected", "Scheduled", "Delayed", "Departed"]);

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTimeWindows(date: string): Array<{ from: string; to: string }> {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;

  if (date === todayUtc) {
    const now = new Date();
    return [{
      from: fmt(new Date(now.getTime() - 6 * 3600_000)),
      to:   fmt(new Date(now.getTime() + 6 * 3600_000)),
    }];
  }

  return [
    { from: `${date}T00:00:00`, to: `${date}T11:59:59` },
    { from: `${date}T12:00:00`, to: `${date}T23:59:59` },
  ];
}

async function toolSearchDepartures(origin_iata: string, date: string, destination_iata?: string, active_only?: boolean) {
  const windows = getTimeWindows(date);
  const results: RawFlight[] = [];

  for (const [index, window] of windows.entries()) {
    const data = await aeroFetch(
      `/flights/airports/iata/${origin_iata}/${window.from}/${window.to}?direction=Departure&withAircraftImage=false&withLocation=false`
    ) as { departures?: RawFlight[] } | null;
    results.push(...(data?.departures ?? []));
    if (index < windows.length - 1) await delay(1200);
  }

  let all = results;
  if (active_only) all = all.filter((f) => ACTIVE_STATUSES.has(f.status));
  const filtered = destination_iata
    ? all.filter((f) => {
        const apt = f.movement.airport;
        return (
          apt.iata === destination_iata ||
          apt.name?.toLowerCase().includes(destination_iata.toLowerCase())
        );
      })
    : all;

  return formatFlights(filtered, "departure", date);
}

async function toolSearchArrivals(destination_iata: string, date: string, origin_iata?: string, active_only?: boolean) {
  const windows = getTimeWindows(date);
  const results: RawFlight[] = [];

  for (const [index, window] of windows.entries()) {
    const data = await aeroFetch(
      `/flights/airports/iata/${destination_iata}/${window.from}/${window.to}?direction=Arrival&withAircraftImage=false&withLocation=false`
    ) as { arrivals?: RawFlight[] } | null;
    results.push(...(data?.arrivals ?? []));
    if (index < windows.length - 1) await delay(1200);
  }

  let all = results;
  if (active_only) {
    all = all.filter((f) => ACTIVE_STATUSES.has(f.status) && !isArrivalInPast(f));
  }
  const filtered = origin_iata
    ? all.filter((f) => {
        const apt = f.movement.airport;
        return (
          apt.iata === origin_iata ||
          apt.name?.toLowerCase().includes(origin_iata.toLowerCase())
        );
      })
    : all;

  return formatFlights(filtered, "arrival", date);
}

async function toolGetFlightStatus(flight_number: string, date: string) {
  const num = flight_number.replace(/\s+/g, "");
  const raw = await aeroFetch(`/flights/number/${num}/${date}`) as RawStatusFlight[] | null;
  if (!raw || !Array.isArray(raw)) return null;
  return raw.map(parseFlightStatus).filter(Boolean);
}

type RawStatusFlight = {
  number: string;
  status: string;
  isCargo: boolean;
  airline?: { name: string };
  aircraft?: { model: string; reg: string };
  departure: {
    airport: { iata?: string; name?: string; municipalityName?: string };
    scheduledTime?: { local: string };
    revisedTime?: { local: string };
    terminal?: string;
    gate?: string;
  };
  arrival: {
    airport: { iata?: string; name?: string; municipalityName?: string };
    scheduledTime?: { local: string };
    revisedTime?: { local: string };
    terminal?: string;
    gate?: string;
    baggageBelt?: string;
  };
};

function parseFlightStatus(f: RawStatusFlight) {
  if (f.isCargo) return null;
  return {
    number: f.number,
    status: f.status,
    airline: f.airline?.name ?? null,
    aircraft: f.aircraft?.model ?? null,
    registration: f.aircraft?.reg ?? null,
    departure: {
      iata: f.departure.airport.iata ?? null,
      city: f.departure.airport.municipalityName ?? f.departure.airport.name ?? null,
      scheduledTime: f.departure.scheduledTime ? formatAMPM(f.departure.scheduledTime.local) : null,
      revisedTime: f.departure.revisedTime ? formatAMPM(f.departure.revisedTime.local) : null,
      terminal: f.departure.terminal ?? null,
      gate: f.departure.gate ?? null,
    },
    arrival: {
      iata: f.arrival.airport.iata ?? null,
      city: f.arrival.airport.municipalityName ?? f.arrival.airport.name ?? null,
      scheduledTime: f.arrival.scheduledTime ? formatAMPM(f.arrival.scheduledTime.local) : null,
      revisedTime: f.arrival.revisedTime ? formatAMPM(f.arrival.revisedTime.local) : null,
      terminal: f.arrival.terminal ?? null,
      gate: f.arrival.gate ?? null,
      baggageBelt: f.arrival.baggageBelt ?? null,
    },
  };
}

async function toolSearchAirport(query: string) {
  const data = await aeroFetch(
    `/airports/search/term?q=${encodeURIComponent(query)}&limit=5&withFlightInfoOnly=true`
  ) as { items?: unknown[] } | null;
  return data?.items ?? [];
}

async function toolGetAirportDelays(iata_code: string) {
  return await aeroFetch(`/airports/iata/${iata_code}/stats/delays`);
}

type RawDelayLeg = {
  airportIcao: string;
  class: "Flight" | "FlightAndHour";
  medianDelay: string;
  numConsideredFlights: number;
  numFlightsDelayedBrackets: { delayFrom: string; delayTo: string | null; numFlights: number }[];
};

async function toolGetFlightDelays(flight_number: string, origin_icao?: string, destination_icao?: string) {
  const num = flight_number.replace(/\s+/g, "");
  const raw = await aeroFetch(`/flights/${num}/delays`) as { number: string; origins?: RawDelayLeg[]; destinations?: RawDelayLeg[] } | null;
  if (!raw) return null;

  // Prefer "Flight" aggregate entries; if none exist, fall back to "FlightAndHour"
  // and deduplicate per airport, keeping the entry with the most considered flights.
  // If an ICAO filter is provided, restrict to matching airports only.
  const bestPerAirport = (legs: RawDelayLeg[] | null | undefined, icaoFilter?: string): RawDelayLeg[] => {
    const all = legs ?? [];
    const aggregates = all.filter((l) => l.class === "Flight");
    const source = aggregates.length > 0 ? aggregates : all;
    const byAirport = new Map<string, RawDelayLeg>();
    for (const l of source) {
      const existing = byAirport.get(l.airportIcao);
      if (!existing || l.numConsideredFlights > existing.numConsideredFlights) {
        byAirport.set(l.airportIcao, l);
      }
    }
    let results = Array.from(byAirport.values());
    if (icaoFilter) {
      const filtered = results.filter((l) => l.airportIcao.toUpperCase() === icaoFilter.toUpperCase());
      if (filtered.length > 0) results = filtered;
    }
    return results;
  };

  return {
    number: raw.number,
    origins: bestPerAirport(raw.origins, origin_icao),
    destinations: bestPerAirport(raw.destinations, destination_icao),
  };
}

async function executeTool(name: string, args: Record<string, string>): Promise<unknown> {
  console.log("[tool]", name, args);
  switch (name) {
    case "search_departures":
      return toolSearchDepartures(args.origin_iata, args.date, args.destination_iata, args.active_only === "true" || (args.active_only as unknown) === true);
    case "search_arrivals":
      return toolSearchArrivals(args.destination_iata, args.date, args.origin_iata, args.active_only === "true" || (args.active_only as unknown) === true);
    case "get_flight_status":
      return toolGetFlightStatus(args.flight_number, args.date);
    case "search_airport":
      return toolSearchAirport(args.query);
    case "get_airport_delays":
      return toolGetAirportDelays(args.iata_code);
    case "get_flight_delays":
      return toolGetFlightDelays(args.flight_number, args.origin_icao, args.destination_icao);
    default:
      return { error: "unknown tool" };
  }
}

function toolLabel(name: string, args: Record<string, string>): string {
  switch (name) {
    case "search_departures":
      return args.destination_iata
        ? `Searching flights ${args.origin_iata} → ${args.destination_iata}`
        : `Searching departures from ${args.origin_iata}`;
    case "search_arrivals":
      return args.origin_iata
        ? `Searching arrivals at ${args.destination_iata} from ${args.origin_iata}`
        : `Searching arrivals at ${args.destination_iata}`;
    case "get_flight_status":
      return `Checking ${args.flight_number}`;
    case "search_airport":
      return `Looking up ${args.query}`;
    case "get_airport_delays":
      return `Checking delays at ${args.iata_code}`;
    case "get_flight_delays":
      return `Fetching delay history for ${args.flight_number}`;
    default:
      return name;
  }
}

// ─── Agent loop ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { messages: history } = await request.json() as { messages: { role: string; content: string }[] };
  if (!history?.length) return Response.json({ error: "Messages required" }, { status: 400 });

  const encoder = new TextEncoder();
  let stepId = 0;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...(history as OpenAI.Chat.ChatCompletionMessageParam[]),
      ];

      const toolResults: { tool: string; args: Record<string, string>; result: unknown }[] = [];

      try {
        for (let i = 0; i < 5; i++) {
          const completion = await openai.chat.completions.create({
            model: "gpt-5.4-mini",
            messages,
            tools: TOOLS,
            tool_choice: "auto",
          });

          const msg = completion.choices[0].message;
          messages.push(msg);

          if (!msg.tool_calls || msg.tool_calls.length === 0) break;

          for (let j = 0; j < msg.tool_calls.length; j++) {
            if (j > 0) await new Promise((r) => setTimeout(r, 2000));
            const call = msg.tool_calls[j];
            if (call.type !== "function") continue;
            const args = JSON.parse(call.function.arguments) as Record<string, string>;
            const id = stepId++;

            send({ type: "tool_start", id, tool: call.function.name, label: toolLabel(call.function.name, args) });
            const result = await executeTool(call.function.name, args);
            send({ type: "tool_end", id });

            toolResults.push({ tool: call.function.name, args, result });
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(result),
            });
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message === "RATE_LIMITED") {
          send({ type: "error", code: "rate_limited" });
          controller.close();
          return;
        }
        send({ type: "error", code: "unknown" });
        controller.close();
        return;
      }

      const lastMessage = messages.findLast((m) => m.role === "assistant");
      const summary = typeof lastMessage?.content === "string" ? lastMessage.content : "";

      const flights = toolResults.find((r) => r.tool === "search_departures")?.result ?? null;
      const arrivals = toolResults.find((r) => r.tool === "search_arrivals")?.result ?? null;
      const flightStatus = toolResults.find((r) => r.tool === "get_flight_status")?.result ?? null;
      const airports = toolResults.find((r) => r.tool === "search_airport")?.result ?? null;
      const delays = toolResults.find((r) => r.tool === "get_airport_delays")?.result ?? null;
      const flightDelays = toolResults.find((r) => r.tool === "get_flight_delays")?.result ?? null;

      send({ type: "result", data: { summary, flights, arrivals, flightStatus, airports, delays, flightDelays, toolResults, rawMessages: messages.slice(1) } });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}
