import { LegalPage } from "../legal-page";

export const metadata = { title: "Privacy notice" };
export const revalidate = 60;

export default function Privacy() {
  return <LegalPage which="privacyNotice" title="Privacy notice" />;
}
