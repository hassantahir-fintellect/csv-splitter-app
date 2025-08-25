/* eslint-disable @typescript-eslint/no-explicit-any */
// app/api/send-split/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs'; // ensure Node runtime (not Edge)

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20MB safety cap (Brevo hard limit is larger, but stay safe)

export async function POST(req: NextRequest) {
  try {
    // Validate env
    const apiKey = process.env.BREVO_API_KEY;
    const fromEmail = process.env.FROM_EMAIL;
    const fromName = process.env.FROM_NAME || 'CSV Splitter';

    if (!apiKey || !fromEmail) {
      return NextResponse.json(
        { error: 'Missing BREVO_API_KEY or FROM_EMAIL env variable.' },
        { status: 500 }
      );
    }

    const form = await req.formData();
    const email = String(form.get('email') || '').trim();
    let filename = String(form.get('filename') || 'split.csv').trim();
    const file = form.get('file');

    if (!EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: 'Invalid email.' }, { status: 400 });
    }
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'File is required.' }, { status: 400 });
    }
    if (!filename) filename = 'split.csv';

    // Convert CSV Blob -> base64 for Brevo attachment
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.byteLength > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json(
        { error: `Attachment too large (${Math.round(buf.byteLength / 1024 / 1024)}MB).` },
        { status: 400 }
      );
    }
    const base64 = buf.toString('base64');

    // Build Brevo payload
    const payload = {
      sender: { email: fromEmail, name: fromName },
      to: [{ email }],
      subject: `Your split file: ${filename}`,
      htmlContent: `
        <p>Hi,</p>
        <p>Attached is your split CSV file: <strong>${filename}</strong>.</p>
        <p>— ${fromName}</p>
      `,
      attachment: [
        {
          content: base64,
          name: filename,
        },
      ],
    };

    // Send via Brevo SMTP email API
    const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!brevoRes.ok) {
      const text = await brevoRes.text();
      return NextResponse.json(
        { error: `Brevo error: ${text || brevoRes.statusText}` },
        { status: 502 }
      );
    }

    const data = await brevoRes.json();
    return NextResponse.json({ ok: true, data });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
  }
}
