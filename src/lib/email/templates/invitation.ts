// Phase 5 Stream E — invitation email template (plain-text only per D15.4).
//
// Plain-text only because: (1) SMTP relay portability — no HTML rendering
// dependencies; (2) phishing-conscious recipients trust plain-text more
// than HTML; (3) the magic link must be obviously visible + copyable in
// any mail client, no "click this rendered button" indirection. Renders a
// short prose message + the link + a 15-min expiry note.

export function renderInvitationEmail(args: {
  inviterName: string;
  role: "PUBLISHER" | "SUBSCRIBER";
  magicLink: string;
  recipientEmail: string;
}): { subject: string; text: string } {
  const roleLabel = args.role === "PUBLISHER" ? "publisher" : "subscriber";
  const subject = `You've been invited to bkstr as a ${roleLabel}`;
  const text = [
    `Hi,`,
    ``,
    `${args.inviterName} has invited you to join bkstr as a ${roleLabel}.`,
    ``,
    `bkstr is a marketplace for compressed knowledge artifacts — buy and sell`,
    `books that AI agents can consume directly.`,
    ``,
    `To accept this invitation, sign in with your Google account at the email`,
    `address ${args.recipientEmail} via the link below:`,
    ``,
    `  ${args.magicLink}`,
    ``,
    `This link will set a short-lived cookie on your browser and redirect you`,
    `to the Google sign-in flow. Once you complete sign-in, your account will`,
    `be promoted to the ${args.role} role automatically.`,
    ``,
    `If you sign in with a different email address than the one this invitation`,
    `was sent to, the invitation will remain pending and your account will keep`,
    `its default role. Ask the admin who sent this invitation to reissue it to`,
    `the email you intend to sign in with.`,
    ``,
    `If you did not expect this invitation, you can safely ignore this email.`,
    ``,
    `— bkstr`,
  ].join("\n");
  return { subject, text };
}
