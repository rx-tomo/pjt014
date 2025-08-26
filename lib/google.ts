import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';

export const oauth2Client = new OAuth2Client({
  clientId: process.env.GOOGLE_OAUTH_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
  redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI!
});

export function gbpClient(accessToken: string) {
  const auth = new OAuth2Client();
  auth.setCredentials({ access_token: accessToken });
  return google.mybusinessbusinessinformation({ version: 'v1', auth });
}

