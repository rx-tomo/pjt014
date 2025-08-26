import PgBoss from 'pg-boss';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const BodySchema = z.object({
  accessToken: z.string().min(10),
  locationName: z.string().regex(/^accounts\/\d+\/locations\//, 'invalid locationName'),
  updateMask: z.string().min(1), // comma-separated
  data: z.record(z.any())
});

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid body', details: parsed.error.flatten() },
        { status: 422 }
      );
    }
    const { accessToken, locationName, updateMask, data } = parsed.data;

    if (!process.env.SUPABASE_DB_URL) {
      return NextResponse.json({ error: 'SUPABASE_DB_URL not set' }, { status: 500 });
    }
    const boss = new PgBoss(process.env.SUPABASE_DB_URL);
    await boss.start();
    const jobId = await boss.publish('gbp.patch', {
      accessToken,
      locationName,
      updateMask,
      body: data
    });
    await boss.stop();
    return NextResponse.json({ ok: true, jobId });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'unknown error' }, { status: 500 });
  }
}
