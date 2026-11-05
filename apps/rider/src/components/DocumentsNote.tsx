/**
 * Shown instead of the document uploads while "Riders upload documents in the
 * app" is off (owner, 2026-10-11). Blynk gives no phone or WhatsApp number
 * (owner, 2026-11-05), so the note only says that Blynk makes the contact.
 */
export function DocumentsNote() {
  return (
    <p className="wa-docs" role="note">
      Documents are not uploaded in the app. Blynk will contact you to collect them.
    </p>
  );
}
