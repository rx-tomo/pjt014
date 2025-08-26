import { NextResponse } from 'next/server';
import { oauth2Client } from '@/lib/google';

export async function GET() {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/business.manage'
    ],
    prompt: 'consent'
  });
  return NextResponse.redirect(url);
}

