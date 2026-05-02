import { NextRequest } from "next/server";

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const HOST = "aerodatabox.p.rapidapi.com";

async function aeroFetch(path: string): Promise<unknown> {
  const res = await fetch(`https://${HOST}${path}`, {
    headers: { "X-RapidAPI-Key": RAPIDAPI_KEY!, "X-RapidAPI-Host": HOST },
    cache: "no-store",
  });
  if (res.status === 429) return Response.json({ error: "rate_limited" }, { status: 429 });
  if (!res.ok || res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function formatAMPM(local: string): string {
  const m = local.match(/(\d{2}):(\d{2})/);
  if (!m) return local;
  let h = parseInt(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
}

export async function POST(request: NextRequest) {
  const { number, date } = await request.json();
  if (!number || !date) return Response.json({ error: "Missing number or date" }, { status: 400 });

  const num = (number as string).replace(/\s+/g, "");
  const raw = await aeroFetch(`/flights/number/${num}/${date}`) as Array<{
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
  }> | null;

  if (!raw || !Array.isArray(raw)) return Response.json(null);

  const parsed = raw
    .filter((f) => !f.isCargo)
    .map((f) => ({
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
        utc: f.departure.revisedTime?.utc ?? f.departure.scheduledTime?.utc ?? null,
        terminal: f.departure.terminal ?? null,
        gate: f.departure.gate ?? null,
      },
      arrival: {
        iata: f.arrival.airport.iata ?? null,
        city: f.arrival.airport.municipalityName ?? f.arrival.airport.name ?? null,
        scheduledTime: f.arrival.scheduledTime ? formatAMPM(f.arrival.scheduledTime.local) : null,
        revisedTime: f.arrival.revisedTime ? formatAMPM(f.arrival.revisedTime.local) : null,
        utc: f.arrival.revisedTime?.utc ?? f.arrival.scheduledTime?.utc ?? null,
        terminal: f.arrival.terminal ?? null,
        gate: f.arrival.gate ?? null,
        baggageBelt: f.arrival.baggageBelt ?? null,
      },
    }));

  return Response.json(parsed[0] ?? null);
}
