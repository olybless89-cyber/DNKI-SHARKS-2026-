import { formatMoney } from "@dnki/shared";

const SIGN_OFF =
  "\n\n— DNKI Converge 2026 · SHARKS 2026 Delegates Accreditation\nThis is an automated message. Do not share codes or passes with anyone.";

export const templates = {
  emailVerification: (name: string, code: string) => ({
    subject: "Your DNKI SHARKS verification code",
    text: `Hello ${name},\n\nYour email verification code is ${code}. It expires in 15 minutes.${SIGN_OFF}`,
  }),
  membershipContactCode: (code: string) => ({
    subject: "DNKI SHARKS membership verification code",
    text: `A request was made to link this membership record to a DNKI SHARKS registration account.\n\nYour membership verification code is ${code}. It expires in 15 minutes.\n\nIf you did not request this, ignore this message and inform your chapter secretary.${SIGN_OFF}`,
  }),
  passwordReset: (name: string, link: string) => ({
    subject: "Reset your DNKI SHARKS password",
    text: `Hello ${name},\n\nUse this link within 30 minutes to reset your password:\n${link}\n\nIf you did not request this, you can ignore this message.${SIGN_OFF}`,
  }),
  passwordChanged: (name: string) => ({
    subject: "Your DNKI SHARKS password was changed",
    text: `Hello ${name},\n\nYour password was just changed and all other sessions were signed out. If this was not you, contact support immediately.${SIGN_OFF}`,
  }),
  membershipDecision: (name: string, approved: boolean) => ({
    subject: approved ? "Membership verified" : "Membership verification update",
    text: approved
      ? `Hello ${name},\n\nYour membership has been verified. You can now complete your paid registration.${SIGN_OFF}`
      : `Hello ${name},\n\nWe could not verify your membership with the information provided. Please contact your chapter or the accreditation support desk.${SIGN_OFF}`,
  }),
  registrationCreated: (name: string, ref: string, amountMinor: string, currency: string) => ({
    subject: `Registration ${ref} created — payment required`,
    text: `Hello ${name},\n\nYour registration ${ref} has been created. Complete payment of ${formatMoney(amountMinor, currency)} to receive your accreditation.${SIGN_OFF}`,
  }),
  paymentConfirmed: (name: string, ref: string, payRef: string, amountMinor: string, currency: string) => ({
    subject: `Payment receipt — ${payRef}`,
    text: `Hello ${name},\n\nPayment received and verified.\n\nRegistration: ${ref}\nPayment reference: ${payRef}\nAmount: ${formatMoney(amountMinor, currency)}${SIGN_OFF}`,
  }),
  invitation: (name: string, accreditationId: string, portalUrl: string, eventName: string) => ({
    subject: `Your ${eventName} digital invitation`,
    text: `Hello ${name},\n\nYou are accredited for ${eventName}.\n\nAccreditation ID: ${accreditationId}\n\nSign in to view and download your digital pass (QR code):\n${portalUrl}\n\nYour QR pass is personal. Gate staff may ask you to confirm your identity.${SIGN_OFF}`,
  }),
  credentialReissued: (name: string, accreditationId: string, portalUrl: string) => ({
    subject: "Your accreditation pass was reissued",
    text: `Hello ${name},\n\nYour accreditation pass was reissued. Your previous QR code no longer works.\n\nNew accreditation ID: ${accreditationId}\nView your new pass: ${portalUrl}${SIGN_OFF}`,
  }),
  credentialRevoked: (name: string) => ({
    subject: "Your accreditation has been revoked",
    text: `Hello ${name},\n\nYour accreditation credential has been revoked and can no longer be used for entry. Contact the accreditation desk for assistance.${SIGN_OFF}`,
  }),
  refundCompleted: (name: string, ref: string, amountMinor: string, currency: string) => ({
    subject: `Refund processed — ${ref}`,
    text: `Hello ${name},\n\nA refund of ${formatMoney(amountMinor, currency)} for registration ${ref} has been processed. Your accreditation has been cancelled.${SIGN_OFF}`,
  }),
};
