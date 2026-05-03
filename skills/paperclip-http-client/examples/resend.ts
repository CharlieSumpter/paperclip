import { apiKey } from "../scripts/api-key.ts";

/**
 * Resend — Bearer auth, JSON body.
 *
 * Register the secret once:
 *   POST /api/companies/:companyId/secrets { name: "RESEND_API_KEY", value: "re_..." }
 */
export const resend = apiKey({
  baseUrl: "https://api.resend.com",
  secretName: "RESEND_API_KEY",
  scheme: "bearer",
});

export type SendEmailInput = {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string;
  cc?: string | string[];
  bcc?: string | string[];
  tags?: { name: string; value: string }[];
};

export type SendEmailResult = {
  id: string;
};

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  return resend.post<SendEmailResult>("/emails", input);
}

export async function getEmail(id: string) {
  return resend.get(`/emails/${id}`);
}
