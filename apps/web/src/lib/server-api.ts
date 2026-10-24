import "server-only";

const API = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

export type PublicEvent = {
  event: {
    name: string;
    edition: string;
    theme: string;
    description: string;
    venue: string | null;
    startsAt: string | null;
    endsAt: string | null;
    timezone: string;
    registration: { open: boolean; reason: string | null; opensAt: string | null; closesAt: string | null };
    support: { email: string | null; phone: string | null };
    faqs: { q: string; a: string }[];
    contacts: { role: string; name: string; phone: string | null }[];
  };
  options: Record<"patrol" | "designation" | "meal_friday" | "meal_saturday", { id: string; label: string }[]>;
  categories: {
    id: string;
    code: string;
    name: string;
    description: string;
    fee_minor: string;
    currency: string;
    requires_identity_check: boolean;
  }[];
  programme: {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string | null;
    location: string | null;
    description: string;
  }[];
  announcements: {
    id: string;
    title: string;
    body: string;
    kind: string;
    url: string | null;
    published_at: string;
    visibility: "PUBLIC";
  }[];
};

export async function getPublicEvent(): Promise<PublicEvent | null> {
  try {
    const res = await fetch(`${API}/api/v1/public/event`, { next: { revalidate: 30 } });
    if (!res.ok) return null;
    return (await res.json()) as PublicEvent;
  } catch {
    return null;
  }
}

export async function getLegal(): Promise<{ privacyNotice: string; terms: string } | null> {
  try {
    const res = await fetch(`${API}/api/v1/public/legal`, { next: { revalidate: 60 } });
    return res.ok ? ((await res.json()) as { privacyNotice: string; terms: string }) : null;
  } catch {
    return null;
  }
}
