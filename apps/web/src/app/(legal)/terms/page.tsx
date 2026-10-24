import { LegalPage } from "../legal-page";

export const metadata = { title: "Terms" };
export const revalidate = 60;

export default function Terms() {
  return <LegalPage which="terms" title="Registration terms" />;
}
